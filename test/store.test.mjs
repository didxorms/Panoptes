import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.mjs';
import { setup, temporary, artifact } from './helpers.mjs';

test('v0.0.0 databases receive additive engine and provider-error columns', (t) => {
  const path = join(temporary(t), 'legacy.sqlite');
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE problems(id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,mode TEXT NOT NULL,status TEXT NOT NULL,root_id TEXT,environment TEXT NOT NULL,bounty_cents INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
    CREATE TABLE calls(id TEXT PRIMARY KEY,problem_id TEXT NOT NULL,task_id TEXT NOT NULL,run_token TEXT NOT NULL,funding_id TEXT NOT NULL,reserved_micros INTEGER NOT NULL,cost_micros INTEGER,status TEXT NOT NULL,provider_id TEXT,created_at TEXT NOT NULL);
  `);
  legacy.close();
  const store = new Store(path);
  try {
    assert.ok(store.all('PRAGMA table_info(problems)').some((row) => row.name === 'engine'));
    assert.ok(store.all('PRAGMA table_info(calls)').some((row) => row.name === 'error'));
  } finally {
    store.close();
  }
});

test('reservations prevent concurrent workers from spending the same remaining budget', (t) => {
  const { store, problem } = setup(t);
  const funding = store.addFunding(problem.id, { name: 'Sponsor', budgetMicros: 100 });
  const a = store.claim(problem.id, 'a'),
    b = store.claim(problem.id, 'b');
  const call = store.reserve(a, funding, 70);
  assert.throws(() => store.reserve(b, funding, 40), /Insufficient/);
  store.settle(call, 30, 'receipt');
  store.settle(call, 30, 'receipt');
  const call2 = store.reserve(b, funding, 70);
  store.settle(call2, 70, 'receipt2');
  const record = store.snapshot(problem.id).funding[0];
  assert.equal(record.spent_micros, 100);
  assert.equal(record.reserved_micros, 0);
});

test('provider overruns are recorded in full and pause further scheduling', (t) => {
  const { store, problem } = setup(t);
  const f = store.addFunding(problem.id, { name: 'Sponsor', budgetMicros: 100 });
  const task = store.claim(problem.id, 'a');
  store.settle(store.reserve(task, f, 80), 120, 'receipt');
  assert.equal(store.snapshot(problem.id).funding[0].spent_micros, 120);
  assert.equal(store.problem(problem.id).status, 'paused');
  assert.equal(store.claim(problem.id, 'b'), null);
});

test('OpenProver projects get one durable coordinator task and rejected calls release funds', (t) => {
  const store = new Store();
  t.after(() => store.close());
  const problem = store.createProblem({
    title: 'Parallel research',
    description: 'Use a planner and workers.',
    statement: 'True',
    mode: 'live',
    engine: 'openprover',
  });
  assert.equal(problem.engine, 'openprover');
  assert.deepEqual(
    store.all('SELECT kind FROM tasks WHERE problem_id=?', problem.id).map((row) => row.kind),
    ['openprover'],
  );
  store.addFunding(
    problem.id,
    { name: 'Sponsor', model: 'fixture', budgetMicros: 100 },
    'encrypted',
  );
  store.setStatus(problem.id, 'running');
  const task = store.claim(problem.id, 'OpenProver');
  const call = store.reserve(task, store.snapshot(problem.id).funding[0].id, 80);
  store.fail(call, 'Provider rejected the call with HTTP 402.');
  const snapshot = store.snapshot(problem.id);
  assert.equal(snapshot.calls[0].status, 'failed');
  assert.equal(snapshot.calls[0].error, 'Provider rejected the call with HTTP 402.');
  assert.equal(snapshot.funding[0].reserved_micros, 0);
  assert.equal(store.allocation(problem.id).unsettledCalls, 0);
});

test('expired leases are fenced across a database reopen', (t) => {
  let store;
  t.after(() => store?.close());
  const directory = temporary(t),
    path = join(directory, 'test.sqlite');
  store = new Store(path);
  const p = store.createProblem({ title: 'Durable research', statement: 'True' });
  store.setStatus(p.id, 'running');
  const old = store.claim(p.id, 'old');
  store.run("UPDATE tasks SET lease_until=0,checkpoint='Remember the lemma' WHERE id=?", old.id);
  store.close();
  store = new Store(path);
  const recovered = store.claim(p.id, 'new');
  assert.notEqual(recovered.token, old.token);
  assert.throws(() => store.finish(old, { done: true }), /no longer valid/);
  assert.equal(
    store.one('SELECT checkpoint FROM tasks WHERE id=?', old.id).checkpoint,
    'Remember the lemma',
  );
  assert.ok(store.snapshot(p.id).events.some((e) => e.kind === 'task.recovered'));
});

test('crash recovery retains an in-flight cost reservation and pauses the project', (t) => {
  const { store, problem } = setup(t);
  const f = store.addFunding(problem.id, { name: 'Sponsor', budgetMicros: 100 });
  const task = store.claim(problem.id, 'old');
  store.reserve(task, f, 80);
  store.run('UPDATE tasks SET lease_until=0 WHERE id=?', task.id);
  assert.equal(store.claim(problem.id, 'new'), null);
  const snapshot = store.snapshot(problem.id);
  assert.equal(snapshot.problem.status, 'paused');
  assert.equal(snapshot.calls[0].status, 'uncertain');
  assert.equal(snapshot.funding[0].reserved_micros, 80);
});

test('stopping fences results but still allows billing for an already started call', (t) => {
  const { store, problem } = setup(t);
  const f = store.addFunding(problem.id, { name: 'Sponsor', budgetMicros: 100 });
  const task = store.claim(problem.id, 'old');
  const call = store.reserve(task, f, 80);
  store.setStatus(problem.id, 'stopped');
  store.settle(call, 20);
  assert.throws(() => artifact(store, task), /no longer valid/);
  assert.equal(store.problem(problem.id).status, 'stopped');
  assert.equal(store.snapshot(problem.id).funding[0].spent_micros, 20);
});

test('allocation uses confirmed resource cost and exact integer cents, never transfers money', (t) => {
  const { store, problem } = setup(t, 'live');
  store.run('UPDATE problems SET bounty_cents=101 WHERE id=?', problem.id);
  const task = store.claim(problem.id, 'worker');
  for (const [name, cost] of [
    ['A', 1],
    ['B', 2],
    ['C', 3],
  ]) {
    const f = store.addFunding(
      problem.id,
      { name, budgetMicros: 100, model: 'fixture' },
      'encrypted-fixture',
    );
    store.settle(store.reserve(task, f, 10), cost);
  }
  assert.equal(store.allocation(problem.id).eligible, false);
  store.completeGoal(task, artifact(store, task, 'True', 'proof', 'live'));
  const allocation = store.allocation(problem.id);
  assert.equal(allocation.eligible, true);
  assert.equal(allocation.payoutStatus, 'not_implemented');
  assert.equal(
    allocation.shares.reduce((sum, s) => sum + s.cents, 0),
    101,
  );
  assert.deepEqual(
    allocation.shares.map((s) => s.cents).sort((a, b) => a - b),
    [17, 34, 50],
  );
});

test('uncertain calls exclude a solved project from allocation', (t) => {
  const { store, problem } = setup(t, 'live');
  const f = store.addFunding(problem.id, { name: 'A', budgetMicros: 100 }, 'fixture');
  const task = store.claim(problem.id, 'worker');
  store.uncertain(store.reserve(task, f, 50));
  store.completeGoal(task, artifact(store, task, 'True', 'proof', 'live'));
  assert.equal(store.allocation(problem.id).eligible, false);
  assert.equal(store.allocation(problem.id).unsettledCalls, 1);
});
