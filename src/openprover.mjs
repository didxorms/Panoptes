import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assert, hash } from './util.mjs';
import { openProverTemplate, processResult } from './lean.mjs';

export class OpenProverRunner {
  constructor({
    store,
    provider,
    verifier,
    directory,
    image = 'panoptes-openprover:1.0.1',
    run = processResult,
  }) {
    Object.assign(this, { store, provider, verifier, image, run });
    this.directory = resolve(directory, 'openprover');
    this.active = new Map();
    mkdirSync(this.directory, { recursive: true });
  }
  async ready() {
    const result = await this.run('docker', ['image', 'inspect', this.image]);
    return result.code === 0;
  }
  async stop(problemId) {
    const active = this.active.get(problemId);
    if (active) await this.run('docker', ['rm', '-f', active.container]);
  }
  async modelCall(task, params) {
    const encoded = JSON.stringify(params);
    assert(encoded.length <= 1_500_000, 'OpenProver model request is too large.');
    assert(Array.isArray(params.messages) && params.messages.length > 0, 'Invalid model request.');
    const maxTokens = Math.min(Math.max(Number(params.maxTokens) || 8192, 1), 8192);
    const candidates = this.store.all(
      'SELECT * FROM funding WHERE problem_id=? AND active=1 AND budget_micros>spent_micros+reserved_micros ORDER BY spent_micros+reserved_micros,id',
      task.problem_id,
    );
    let lastError = 'No active contribution has enough available budget.';
    for (const funding of candidates) {
      let quote;
      try {
        quote = await this.provider.quoteChat(funding, {
          messages: params.messages,
          maxTokens,
        });
      } catch (error) {
        lastError = error.message;
        continue;
      }
      if (quote > funding.budget_micros - funding.spent_micros - funding.reserved_micros) {
        lastError = 'The remaining contribution cannot cover the next model call.';
        continue;
      }
      let callId;
      try {
        callId = this.store.reserve(task, funding.id, quote);
      } catch (error) {
        lastError = error.message;
        continue;
      }
      try {
        const response = await this.provider.complete({
          funding,
          messages: params.messages,
          tools: Array.isArray(params.tools) ? params.tools : [],
          maxTokens,
          label: params.label,
        });
        this.store.settle(callId, response.costMicros, response.providerId);
        return response;
      } catch (error) {
        if (error.chargeState === 'none') {
          this.store.fail(callId, error.message);
          throw new Error(`Spending limit: ${error.message}`);
        }
        this.store.uncertain(callId);
        throw error;
      }
    }
    throw new Error(`Spending limit reached: ${lastError}`);
  }
  async handleRequest(task, message, state) {
    if (message.method === 'model.call') return this.modelCall(task, message.params || {});
    const code = message.params?.code;
    assert(typeof code === 'string', 'Lean source is required.');
    if (message.method === 'lean.check') return this.verifier.checkSource(code);
    if (message.method === 'lean.final') {
      const target = this.store.goal(task.goal_id).statement;
      const result = await this.verifier.verifySource(target, code);
      if (result.status === 'verified') state.finalVerification = result;
      return result;
    }
    throw new Error('Unknown OpenProver request.');
  }
  async runTask(task) {
    assert(!this.active.has(task.problem_id), 'OpenProver is already running for this problem.');
    const problem = this.store.problem(task.problem_id);
    const goal = this.store.goal(task.goal_id);
    const runDirectory = join(this.directory, problem.id);
    mkdirSync(runDirectory, { recursive: true });
    writeFileSync(
      join(runDirectory, 'config.json'),
      JSON.stringify({
        description: problem.description,
        statement: goal.statement,
        template: openProverTemplate(goal.statement),
        maxWorkers: 3,
        timeLimitSeconds: 900,
      }),
      { mode: 0o600 },
    );
    const container = 'panoptes-openprover-' + hash([problem.id, task.token]).slice(0, 16);
    const args = [
      'run',
      '--interactive',
      '--name',
      container,
      '--rm',
      '--pull=never',
      '--network=none',
      '--cpus=2',
      '--memory=1536m',
      '--pids-limit=160',
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--user=1000:1000',
      '--tmpfs',
      '/tmp:rw,nosuid,nodev,size=128m,mode=1777',
      '--mount',
      `type=bind,source=${runDirectory},target=/run`,
      this.image,
    ];
    const child = spawn('docker', args, {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const state = { container, finalVerification: null, complete: null, fatal: null, logs: '' };
    this.active.set(problem.id, state);
    const send = (value) => {
      if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(value) + '\n');
    };
    const output = createInterface({ input: child.stdout });
    output.on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        state.logs = (state.logs + '\n' + line).slice(-12_000);
        return;
      }
      if (message.event === 'request') {
        void this.handleRequest(task, message, state).then(
          (result) => send({ requestId: message.requestId, ok: true, result }),
          (error) =>
            send({
              requestId: message.requestId,
              ok: false,
              error: String(error.message).slice(0, 1000),
            }),
        );
      } else if (message.event === 'complete') state.complete = message;
      else if (message.event === 'fatal') state.fatal = message.error;
    });
    child.stderr.on('data', (chunk) => {
      state.logs = (state.logs + chunk.toString()).slice(-12_000);
    });
    const exit = await new Promise((resolveExit) => {
      const timer = setTimeout(() => void this.run('docker', ['rm', '-f', container]), 20 * 60_000);
      timer.unref();
      child.on('error', (error) => {
        clearTimeout(timer);
        resolveExit({ code: -1, error: error.message });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolveExit({ code });
      });
    });
    this.active.delete(problem.id);
    await this.run('docker', ['rm', '-f', container]);
    if (exit.code !== 0)
      throw new Error(
        state.fatal || exit.error || state.logs || 'OpenProver stopped unexpectedly.',
      );
    assert(state.complete, 'OpenProver did not return a completion record.');
    if (state.complete.proof) {
      const proof = String(state.complete.proof);
      const verification =
        state.finalVerification || (await this.verifier.verifySource(goal.statement, proof));
      return {
        proof,
        verification,
        summary: String(state.complete.discussion || 'OpenProver produced a Lean proof.').slice(
          0,
          2000,
        ),
        checkpoint: String(state.complete.checkpoint || '').slice(0, 3000),
      };
    }
    return {
      proof: '',
      verification: null,
      summary: String(
        state.complete.discussion || state.logs || 'No proof was found in this session.',
      ).slice(-3000),
      checkpoint: String(state.complete.checkpoint || '').slice(-3000),
    };
  }
}
