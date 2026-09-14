import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, seedDemo } from '../src/engine.mjs';
import { SAMPLE } from '../src/providers.mjs';
import { Store, bridgeStatement } from '../src/store.mjs';
import { DemoVerifier, ENVIRONMENT } from '../src/lean.mjs';
import { setup, artifact } from './helpers.mjs';

test('three workers share two lemmas and assemble the original target; demo never becomes a real proof', async (t) => {
  const { store, engine } = setup(t);
  const p = seedDemo(store);
  store.setStatus(p.id, 'running');
  await engine.tick(p.id);
  let snapshot = store.snapshot(p.id);
  assert.equal(snapshot.routes.length, 1, 'duplicate route proposals are deduplicated');
  assert.equal(store.goal(p.root_id).status, 'open', 'a conditional bridge is not a target proof');
  assert.equal(snapshot.goals.length, 3);
  await engine.tick(p.id);
  assert.equal(store.goal(p.root_id).status, 'open', 'subgoal success still needs final assembly');
  assert.equal(
    store.all("SELECT id FROM tasks WHERE problem_id=? AND kind='integrate'", p.id).length,
    1,
  );
  await engine.tick(p.id);
  snapshot = store.snapshot(p.id);
  assert.equal(snapshot.problem.status, 'demo_completed');
  assert.equal(snapshot.routes[0].status, 'completed');
  assert.ok(snapshot.artifacts.every((a) => a.status === 'simulated'));
  const final = store.evidence(store.goal(p.root_id).artifact_id);
  assert.equal(final.statement, SAMPLE.statement);
  assert.equal(final.dependencies.length, 3);
  assert.equal(
    snapshot.funding.reduce((sum, f) => sum + f.spent_micros, 0),
    100,
  );
  assert.ok(snapshot.funding.every((f) => f.reserved_micros === 0));
  assert.equal(store.allocation(p.id).eligible, false);
  assert.ok(store.allocation(p.id).shares.every((s) => s.cents === 0));
});

test('a simulated verifier cannot promote live research', async (t) => {
  const { store, problem, engine } = setup(t, 'live');
  const task = store.claim(problem.id, 'worker');
  await assert.rejects(
    engine.submit(
      task,
      { type: 'prove', proof: [{ tactic: 'exact', term: 'True.intro' }] },
      new DemoVerifier(),
    ),
    /boundaries/,
  );
  assert.equal(store.goal(problem.root_id).status, 'open');
  assert.equal(store.snapshot(problem.id).artifacts.length, 0);
});

test('wrong targets and evidence from other problems cannot close a goal', (t) => {
  const { store, problem } = setup(t);
  const task = store.claim(problem.id, 'worker');
  const wrong = artifact(store, task, 'False');
  assert.throws(() => store.completeGoal(task, wrong), /wrong target/);
  const other = store.createProblem({ title: 'Other', statement: 'True' });
  store.setStatus(other.id, 'running');
  const otherTask = store.claim(other.id, 'other');
  const proof = artifact(store, otherTask);
  assert.throws(() => store.completeGoal(task, proof), /another goal/);
  assert.throws(() => store.dependencies(problem.id, [proof]), /from this problem/);
});

test('routes reject cycles and roll back newly created goals', (t) => {
  const { store, problem } = setup(t, 'demo', 'True ∧ True');
  const root = store.claim(problem.id, 'root');
  const bridge = artifact(store, root, bridgeStatement(['True'], 'True ∧ True'), 'bridge');
  store.addRoute(root, 'First route', ['True'], bridge);
  store.finish(root, { done: true });
  const child = store.claim(problem.id, 'child');
  assert.equal(store.goal(child.goal_id).statement, 'True');
  const cycle = artifact(store, child, bridgeStatement(['False', 'True ∧ True'], 'True'), 'bridge');
  assert.throws(
    () => store.addRoute(child, 'Circular route', ['False', 'True ∧ True'], cycle),
    /Circular/,
  );
  assert.equal(store.snapshot(problem.id).goals.length, 2);
});

test('refuting a necessary lemma refutes its route without claiming a disproof of the root', (t) => {
  const { store, problem } = setup(t, 'demo', 'True ∧ True');
  const task = store.claim(problem.id, 'root');
  const bridge = artifact(store, task, bridgeStatement(['False'], 'True ∧ True'), 'bridge');
  const routeId = store.addRoute(task, 'Impossible premise', ['False'], bridge);
  store.finish(task, { done: true });
  const child = store.claim(problem.id, 'child');
  const refutation = artifact(store, child, '¬ (False)', 'refutation');
  store.completeGoal(child, refutation, true);
  assert.equal(store.one('SELECT status FROM routes WHERE id=?', routeId).status, 'refuted');
  assert.equal(store.goal(problem.root_id).status, 'open');
  assert.equal(store.problem(problem.id).status, 'running');
  const next = store.claim(problem.id, 'root-2');
  const bridge2 = artifact(
    store,
    next,
    bridgeStatement(['False', 'True'], 'True ∧ True'),
    'bridge',
  );
  const route2 = store.addRoute(next, 'Already refuted premise', ['False', 'True'], bridge2);
  assert.equal(store.one('SELECT status FROM routes WHERE id=?', route2).status, 'refuted');
});

test('an accepted proof survives a crash before goal promotion and is reused without an AI call', async (t) => {
  const { store, problem, engine } = setup(t);
  const task = store.claim(problem.id, 'interrupted');
  const proof = artifact(store, task);
  store.run('UPDATE tasks SET lease_until=0 WHERE id=?', task.id);
  const recovered = store.claim(problem.id, 'replacement');
  await engine.runTask(recovered);
  assert.equal(store.goal(problem.root_id).artifact_id, proof);
  assert.equal(store.snapshot(problem.id).calls.length, 0);
});

test('malformed model output is charged once and retried with feedback', async (t) => {
  const { store, problem, engine } = setup(t);
  store.addFunding(problem.id, { name: 'Sponsor', budgetMicros: 1000 });
  engine.demoProvider = {
    quote: async () => 100,
    generate: async () => ({ content: 'not json', costMicros: 17, providerId: 'fixture' }),
  };
  await engine.runTask(store.claim(problem.id, 'worker'));
  const snapshot = store.snapshot(problem.id);
  assert.equal(snapshot.calls[0].status, 'confirmed');
  assert.equal(snapshot.funding[0].spent_micros, 17);
  assert.ok(snapshot.tasks.some((x) => x.feedback.includes('JSON')));
  assert.equal(snapshot.artifacts.length, 0);
});

test('provider timeouts pause research and retain an uncertain reservation', async (t) => {
  const { store, problem, engine } = setup(t);
  store.addFunding(problem.id, { name: 'Sponsor', budgetMicros: 1000 });
  engine.demoProvider = {
    quote: async () => 100,
    generate: async () => {
      throw new Error('timeout');
    },
  };
  await engine.runTask(store.claim(problem.id, 'worker'));
  const snapshot = store.snapshot(problem.id);
  assert.equal(snapshot.problem.status, 'paused');
  assert.equal(snapshot.calls[0].status, 'uncertain');
  assert.equal(snapshot.funding[0].reserved_micros, 100);
});

test('a verified OpenProver result is stored as full Lean source and closes only its fixed goal', async (t) => {
  const store = new Store();
  t.after(() => store.close());
  const problem = store.createProblem({
    title: 'OpenProver promotion',
    statement: 'True',
    mode: 'live',
    engine: 'openprover',
  });
  store.setStatus(problem.id, 'running');
  const proof = 'import Std\ntheorem panoptes_target : True := by exact True.intro\n';
  const engine = new Engine(store, {
    openProverRunner: {
      runTask: async () => ({
        proof,
        verification: {
          status: 'verified',
          environment: ENVIRONMENT,
          diagnostics: 'Exact target and kernel replay passed.',
          axioms: [],
        },
        summary: 'The planner and workers completed the proof.',
        checkpoint: 'Complete.',
      }),
    },
  });
  await engine.tick(problem.id);
  const snapshot = store.snapshot(problem.id);
  assert.equal(snapshot.problem.status, 'solved');
  assert.equal(snapshot.artifacts.length, 1);
  assert.equal(snapshot.artifacts[0].statement, 'True');
  assert.equal(snapshot.artifacts[0].proof, proof);
});
