import { assert, json } from './util.mjs';
import { bridgeStatement } from './store.mjs';
import { alias, statement, renderSteps } from './lean.mjs';
import { SAMPLE } from './providers.mjs';

export function seedDemo(store) {
  const p = store.createProblem({ ...SAMPLE, mode: 'demo', bountyCents: 10000 });
  for (const name of ['Ada', 'Emmy', 'Sofia'])
    store.addFunding(p.id, { name, model: 'simulation', budgetMicros: 10000 });
  return p;
}
export class Engine {
  constructor(store, { demoProvider, liveProvider, demoVerifier, liveVerifier }) {
    this.store = store;
    Object.assign(this, { demoProvider, liveProvider, demoVerifier, liveVerifier });
    this.busy = new Set();
    this.round = 0;
  }
  context(task) {
    const snapshot = this.store.snapshot(task.problem_id);
    const evidence = snapshot.artifacts
      .filter((a) => ['verified', 'simulated'].includes(a.status))
      .slice(-24)
      .map((a) => ({
        id: a.id,
        alias: a.alias,
        statement: a.statement,
        kind: a.kind,
        status: a.status,
        summary: a.summary,
      }));
    return {
      approach:
        task.kind === 'explore'
          ? {
              Atlas: 'Try a direct proof using standard lemmas and simplification.',
              Iris: 'Look for reusable independent subgoals and prove their conditional bridge.',
              Themis:
                'Examine alternative approaches and possible obstructions. A failed search is not a disproof.',
            }[task.worker] || 'Explore a distinct approach to the target.'
          : 'Build on accepted shared evidence and the feedback for this task.',
      role:
        task.kind === 'explore'
          ? 'Explore an approach'
          : task.steps >= 3
            ? 'Review the stalled approach and revise or split it'
            : 'Prove the assigned goal',
      environment: snapshot.problem.environment,
      originalGoal: this.store.goal(snapshot.problem.root_id).statement,
      goal: this.store.goal(task.goal_id),
      task: { kind: task.kind, step: task.steps },
      evidence,
      routes: snapshot.routes,
      feedback: task.feedback,
      checkpoint: task.checkpoint,
      notes: snapshot.events
        .filter((e) => e.kind === 'research.note')
        .slice(0, 6)
        .map((e) => e.message),
    };
  }
  async runTask(task) {
    const s = this.store,
      p = s.problem(task.problem_id),
      verifier = p.mode === 'demo' ? this.demoVerifier : this.liveVerifier,
      provider = p.mode === 'demo' ? this.demoProvider : this.liveProvider;
    const heartbeat = setInterval(() => s.heartbeat(task.id, task.token), 20_000);
    heartbeat.unref();
    try {
      // Reuse a durable accepted candidate after a crash before goal promotion.
      const existing = s.one(
        'SELECT id FROM artifacts WHERE goal_id=? AND kind=? AND status=? ORDER BY created_at LIMIT 1',
        task.goal_id,
        'proof',
        p.mode === 'demo' ? 'simulated' : 'verified',
      );
      if (existing) {
        s.completeGoal(task, existing.id);
        return;
      }
      if (task.kind === 'integrate') {
        const route = s.one('SELECT * FROM routes WHERE id=?', task.route_id);
        assert(route?.status === 'active', 'The route is no longer active.');
        const ids = [
          route.bridge_id,
          ...json(route.requirements, []).map((g) => s.goal(g).artifact_id),
        ];
        await this.submit(
          task,
          {
            type: 'prove',
            proof: [{ tactic: 'exact', term: ids.map(alias).join(' ') }],
            dependencies: ids,
            summary: 'Assembled the conditional bridge and verified subgoal proofs.',
          },
          verifier,
        );
        return;
      }
      const context = this.context(task);
      let funding, amount;
      const candidates = s.all(
        'SELECT * FROM funding WHERE problem_id=? AND active=1 AND budget_micros>spent_micros+reserved_micros ORDER BY spent_micros+reserved_micros,id',
        p.id,
      );
      for (const candidate of candidates) {
        try {
          const quote = await provider.quote(candidate, context);
          if (
            quote <=
            candidate.budget_micros - candidate.spent_micros - candidate.reserved_micros
          ) {
            funding = candidate;
            amount = quote;
            break;
          }
        } catch {
          /* Try another explicitly configured model before parking. */
        }
      }
      if (!funding) {
        s.finish(task, {
          pause: true,
          checkpoint: task.checkpoint,
          feedback: 'No funded model can cover this call, or current prices are unavailable.',
        });
        s.event(p.id, 'task.waiting_budget', 'A task is waiting for available model budget.', {
          taskId: task.id,
        });
        return;
      }
      const callId = s.reserve(task, funding.id, amount);
      let response;
      try {
        response = await provider.generate({ funding, context });
        s.settle(callId, response.costMicros, response.providerId);
      } catch {
        s.uncertain(callId);
        s.finish(task, {
          pause: true,
          feedback: 'Provider call outcome is uncertain. Its budget reservation is retained.',
        });
        return;
      }
      s.owned(task.id, task.token);
      const clean = response.content
        .trim()
        .replace(/^```(?:json)?\s*/, '')
        .replace(/\s*```$/, '');
      assert(clean.length <= 30000, 'Model response is too large.');
      const action = json(clean);
      assert(action && typeof action === 'object', 'Return one JSON action object.');
      assert(
        typeof action.summary === 'string' && action.summary.length <= 2000,
        'Provide a short research summary.',
      );
      if (action.type === 'note' || action.type === 'defer') {
        s.event(p.id, 'research.note', action.summary, { taskId: task.id, worker: task.worker });
        s.finish(task, {
          checkpoint: action.summary,
          pause: action.type === 'defer',
          feedback:
            action.type === 'note'
              ? 'Note saved. Next produce a proof, route, or concrete test.'
              : '',
        });
        return;
      }
      await this.submit(task, action, verifier);
    } catch (error) {
      try {
        s.owned(task.id, task.token);
        s.finish(task, {
          feedback: String(error.message).slice(0, 3000),
          checkpoint: task.checkpoint,
        });
        s.event(p.id, 'task.feedback', 'A task received feedback for its next attempt.', {
          taskId: task.id,
        });
      } catch {
        /* Fenced or completed task; do not overwrite its successor. */
      }
    } finally {
      clearInterval(heartbeat);
    }
  }
  async submit(task, action, verifier) {
    const s = this.store,
      goal = s.goal(task.goal_id);
    assert(['prove', 'route', 'refute'].includes(action.type), 'Unknown research action.');
    renderSteps(action.proof);
    const dependencies = s.dependencies(task.problem_id, action.dependencies || []);
    let target = goal.statement,
      kind = 'proof';
    if (action.type === 'route') {
      assert(
        Array.isArray(action.subgoals) && action.subgoals.length > 0 && action.subgoals.length <= 4,
        'A route needs 1–4 subgoals.',
      );
      action.subgoals = action.subgoals.map(statement);
      assert(
        !action.subgoals.includes(goal.statement),
        'Do not restate the current goal as a subgoal.',
      );
      target = bridgeStatement(action.subgoals, goal.statement);
      kind = 'bridge';
    } else if (action.type === 'refute') {
      target = `¬ (${goal.statement})`;
      kind = 'refutation';
    }
    const result = await verifier.verify(target, action.proof, dependencies);
    s.owned(task.id, task.token);
    const artifactId = s.saveArtifact(
      task,
      {
        kind,
        statement: target,
        proof: action.proof,
        dependencies: action.dependencies || [],
        summary: action.summary,
      },
      result,
    );
    if (result.status === 'rejected') {
      s.finish(task, { feedback: result.diagnostics, checkpoint: action.summary });
      return;
    }
    if (action.type === 'route') {
      s.addRoute(task, action.label, action.subgoals, artifactId);
      s.finish(task, { done: true, checkpoint: action.summary });
      s.activateIntegrations(task.problem_id);
    } else {
      s.completeGoal(task, artifactId, action.type === 'refute');
    }
  }
  async tick(problemId) {
    if (this.busy.has(problemId)) return;
    this.busy.add(problemId);
    try {
      const names = ['Atlas', 'Iris', 'Themis'];
      const tasks = [];
      for (let i = 0; i < 3; i++) {
        const task = this.store.claim(problemId, names[this.round++ % 3]);
        if (task) tasks.push(task);
      }
      await Promise.all(tasks.map((task) => this.runTask(task)));
      const p = this.store.problem(problemId);
      if (
        p.status === 'running' &&
        !this.store.one(
          "SELECT id FROM tasks WHERE problem_id=? AND status IN ('queued','leased')",
          problemId,
        )
      ) {
        this.store.setStatus(problemId, 'paused');
        this.store.event(
          problemId,
          'research.stalled',
          'No runnable tasks remain. Research is saved and waiting for capacity or a new attempt.',
        );
      }
    } finally {
      this.busy.delete(problemId);
    }
  }
  async drain(problemId, maxRounds = 40) {
    for (let i = 0; i < maxRounds && this.store.problem(problemId).status === 'running'; i++)
      await this.tick(problemId);
    return this.store.snapshot(problemId);
  }
}
