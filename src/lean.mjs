import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { assert, hash } from './util.mjs';

export const ENVIRONMENT = 'leanprover/lean4:v4.28.0;imports=Std;panoptes-proof-v1';
const forbidden =
  /\b(?:sorry|admit|axiom|unsafe|native_decide|run_tac|elab|macro|syntax|initialize|builtin_initialize|set_option|import|namespace|section|end|theorem|def|instance|attribute|where|opaque|partial|implemented_by)\b/;
export function statement(value) {
  assert(
    typeof value === 'string' && value.length > 0 && value.length <= 2000,
    'Invalid Lean statement.',
  );
  assert(
    !/[\r\n#"'`$;]/.test(value) &&
      !value.includes(':=') &&
      !value.includes('--') &&
      !value.includes('/-') &&
      !value.includes('-/') &&
      !/\b(?:by|let|do)\b/.test(value) &&
      !forbidden.test(value),
    'Statements must be a single Lean type expression, without commands or executable blocks.',
  );
  assert(
    /^[\w\s.,:(){}\[\]+*\/<>=!?|&^%@\-∀∃→↔∧∨¬≠≤≥ℕℤℚℝ∈∉⊆∅×]+$/u.test(value),
    'Unsupported character in statement.',
  );
  const stack = [];
  const closing = { ')': '(', ']': '[', '}': '{' };
  for (const c of value) {
    if ('([{'.includes(c)) stack.push(c);
    else if (closing[c]) assert(stack.pop() === closing[c], 'Unbalanced statement.');
  }
  assert(!stack.length, 'Unbalanced statement.');
  return value.trim().replace(/\s+/g, ' ');
}
const name = (value) => {
  assert(
    typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) && !forbidden.test(value),
    'Invalid binder.',
  );
  return value;
};
const term = (value) => {
  assert(
    typeof value === 'string' &&
      value.length < 2000 &&
      /^[A-Za-z0-9_.()\s]+$/.test(value) &&
      !/[\r\n]/.test(value) &&
      !forbidden.test(value) &&
      !/\b(?:by|let|do|match|fun)\b/.test(value),
    'Use a constant, hypothesis, or parenthesized application as the proof term.',
  );
  let depth = 0;
  for (const c of value) {
    if (c === '(') depth++;
    if (c === ')') assert(--depth >= 0, 'Unbalanced proof term.');
  }
  assert(depth === 0, 'Unbalanced proof term.');
  return value;
};
export function renderSteps(steps, indent = 2, depth = 0) {
  assert(
    Array.isArray(steps) && steps.length > 0 && steps.length <= 40 && depth < 8,
    'Expected 1–40 structured proof steps.',
  );
  const pad = ' '.repeat(indent);
  return steps
    .map((step) => {
      assert(step && typeof step === 'object', 'Invalid proof step.');
      switch (step.tactic) {
        case 'intro':
          assert(
            Array.isArray(step.names) && step.names.length > 0 && step.names.length <= 20,
            'Invalid intro names.',
          );
          return pad + 'intro ' + step.names.map(name).join(' ');
        case 'exact':
        case 'apply':
          return pad + step.tactic + ' ' + term(step.term);
        case 'rfl':
        case 'assumption':
        case 'simp':
        case 'omega':
        case 'decide':
        case 'left':
        case 'right':
          return pad + step.tactic;
        case 'constructor': {
          if (!step.branches) return pad + 'constructor';
          assert(
            Array.isArray(step.branches) && step.branches.length === 2,
            'Constructor needs two branches.',
          );
          return (
            pad +
            'constructor\n' +
            step.branches
              .map((branch) => pad + '·\n' + renderSteps(branch, indent + 2, depth + 1))
              .join('\n')
          );
        }
        default:
          throw new Error(`Unsupported tactic: ${String(step.tactic).slice(0, 40)}`);
      }
    })
    .join('\n');
}
export const alias = (artifactId) => 'lemma_' + artifactId.replaceAll('-', '');
export function sourceFor(target, proof, dependencies = []) {
  assert(dependencies.length <= 48, 'Too many dependencies.');
  let source = 'import Std\nset_option autoImplicit false\nset_option maxHeartbeats 200000\n';
  for (const dep of dependencies) {
    assert(/^[a-f0-9-]{36}$/.test(dep.id), 'Invalid dependency ID.');
    source += `\ntheorem ${alias(dep.id)} : (${statement(dep.statement)}) := by\n${renderSteps(dep.proof)}\n`;
  }
  source += `\ntheorem candidate : (${statement(target)}) := by\n${renderSteps(proof)}\n\n#print axioms candidate\n`;
  assert(source.length <= 100_000, 'Proof source is too large.');
  return source;
}
export async function processResult(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, ...options });
    let output = '',
      settled = false,
      failure;
    const finish = (result) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ ...result, output });
      }
    };
    const timer = setTimeout(() => {
      failure = 'Verification timed out.';
      child.kill('SIGKILL');
    }, 60_000);
    const capture = (data) => {
      if (failure) return;
      output += data.toString();
      if (output.length > 200_000) {
        output = output.slice(0, 200_000);
        failure = 'Verification output limit reached.';
        child.kill('SIGKILL');
      }
    };
    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);
    child.on('error', (error) =>
      finish({ code: -1, error: error.code || 'Unable to start verifier.' }),
    );
    child.on('close', (code) => finish({ code: failure ? -1 : code, error: failure }));
  });
}
export function inspectAxioms(output, theorem = 'candidate') {
  assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(theorem), 'Invalid theorem name.');
  if (output.includes(`'${theorem}' does not depend on any axioms`)) return [];
  const match = output.match(new RegExp(`'${theorem}' depends on axioms:\\s*\\[([^\\]]*)\\]`));
  assert(match, 'Lean did not produce an axiom report.');
  const axioms = match[1]
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  assert(
    axioms.every((x) => ['propext', 'Classical.choice', 'Quot.sound'].includes(x)),
    'Proof depends on an unapproved axiom.',
  );
  return axioms;
}
export class DemoVerifier {
  mode = 'demo';
  async verify(target, proof, dependencies = []) {
    const source = sourceFor(target, proof, dependencies);
    return {
      status: 'simulated',
      environment: ENVIRONMENT,
      sourceHash: hash(source),
      diagnostics: 'Simulation only. No Lean process was executed.',
      axioms: null,
    };
  }
}
export class LeanVerifier {
  mode = 'live';
  constructor({ image = 'panoptes-lean:4.28.0', localBin = null, run = processResult } = {}) {
    this.image = image;
    this.localBin = localBin;
    this.run = run;
  }
  async verifyFiles(files, source, axiomTheorem) {
    let directory;
    try {
      directory = await mkdtemp(join(tmpdir(), 'panoptes-lean-'));
      // Docker's unprivileged user must be able to read the bind-mounted input.
      await chmod(directory, 0o755);
      for (const [filename, contents] of Object.entries(files))
        await writeFile(join(directory, filename), contents, { mode: 0o644 });
      let compilation, replay;
      if (this.localBin) {
        // Explicitly used by trusted integration fixtures, never exposed through HTTP.
        const opts = { cwd: directory, env: { ...process.env, LEAN_PATH: directory } };
        const outputs = [];
        for (const filename of Object.keys(files)) {
          const module = filename.slice(0, -5);
          const item = await this.run(
            join(this.localBin, process.platform === 'win32' ? 'lean.exe' : 'lean'),
            ['-o', `${module}.olean`, filename],
            opts,
          );
          outputs.push(item.output || '');
          if (item.code !== 0) throw new Error(item.error || item.output);
        }
        compilation = { code: 0, output: outputs.join('\n') };
        const finalModule = Object.keys(files).at(-1).slice(0, -5);
        replay = await this.run(
          join(this.localBin, process.platform === 'win32' ? 'leanchecker.exe' : 'leanchecker'),
          [finalModule],
          opts,
        );
      } else {
        const container = 'panoptes-' + hash(directory).slice(0, 16);
        compilation = await this.run('docker', [
          'run',
          '--name',
          container,
          '--rm',
          '--pull=never',
          '--network=none',
          '--cpus=1',
          '--memory=768m',
          '--pids-limit=64',
          '--read-only',
          '--cap-drop=ALL',
          '--security-opt=no-new-privileges',
          '--user=1000:1000',
          '--tmpfs',
          '/work:rw,nosuid,nodev,size=64m,mode=1777',
          '--mount',
          `type=bind,source=${directory},target=/input,readonly`,
          this.image,
        ]);
        // Killing the docker client does not stop the container; always clean up by ID.
        await this.run('docker', ['rm', '-f', container]);
        if (compilation.code !== 0) throw new Error(compilation.error || compilation.output);
        assert(
          compilation.output.includes('PANOPTES_KERNEL_REPLAY_OK'),
          'Kernel replay did not finish.',
        );
        replay = { code: 0 };
      }
      assert(replay.code === 0, replay.error || replay.output || 'Kernel replay failed.');
      const axioms = axiomTheorem ? inspectAxioms(compilation.output, axiomTheorem) : [];
      return {
        status: 'verified',
        environment: ENVIRONMENT,
        sourceHash: hash(source),
        axioms,
        diagnostics: compilation.output.slice(-12_000),
      };
    } catch (error) {
      return {
        status: 'rejected',
        environment: ENVIRONMENT,
        diagnostics: String(error.message).slice(-12_000),
      };
    } finally {
      if (directory) {
        assert(
          dirname(resolve(directory)) === resolve(tmpdir()) &&
            basename(directory).startsWith('panoptes-lean-'),
          'Unexpected verifier cleanup path.',
        );
        await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
    }
  }
  async verify(target, proof, dependencies = []) {
    const source = sourceFor(target, proof, dependencies);
    return this.verifyFiles({ 'Candidate.lean': source }, source, 'candidate');
  }
}

export function openProverTemplate(target) {
  return `import Std\nset_option autoImplicit false\nset_option maxHeartbeats 200000\n\ntheorem panoptes_target : (${statement(target)}) := by\n  sorry\n`;
}

export class RawLeanVerifier extends LeanVerifier {
  async checkSource(candidate) {
    try {
      assert(
        typeof candidate === 'string' && candidate.length > 0 && candidate.length <= 100_000,
        'Lean candidate must contain 1–100000 characters.',
      );
      assert(!candidate.includes('\0'), 'Lean candidate contains an invalid byte.');
      return await this.verifyFiles({ 'Candidate.lean': candidate }, candidate, null);
    } catch (error) {
      return {
        status: 'rejected',
        environment: ENVIRONMENT,
        diagnostics: String(error.message).slice(-12_000),
      };
    }
  }
  async verifySource(target, candidate) {
    try {
      target = statement(target);
      assert(
        typeof candidate === 'string' && candidate.length > 0 && candidate.length <= 100_000,
        'Lean candidate must contain 1–100000 characters.',
      );
      assert(!candidate.includes('\0'), 'Lean candidate contains an invalid byte.');
      const final = `import Candidate\n\ntheorem panoptes_exact_target : (${target}) := panoptes_target\n\n#print axioms panoptes_exact_target\n`;
      return await this.verifyFiles(
        { 'Candidate.lean': candidate, 'Final.lean': final },
        `${candidate}\n${final}`,
        'panoptes_exact_target',
      );
    } catch (error) {
      return {
        status: 'rejected',
        environment: ENVIRONMENT,
        diagnostics: String(error.message).slice(-12_000),
      };
    }
  }
}
