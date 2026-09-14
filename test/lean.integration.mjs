import test from 'node:test';
import assert from 'node:assert/strict';
import { LeanVerifier } from '../src/lean.mjs';
import { Store } from '../src/store.mjs';
import { Engine } from '../src/engine.mjs';
import { DemoProvider, SAMPLE } from '../src/providers.mjs';

const enabled = Boolean(
  process.env.PANOPTES_LEAN_BIN || process.env.PANOPTES_LEAN_TEST_DOCKER === '1',
);
const verifier = new LeanVerifier({ localBin: process.env.PANOPTES_LEAN_BIN || null });
const options = {
  skip: enabled
    ? false
    : 'Set PANOPTES_LEAN_BIN for trusted local fixtures or PANOPTES_LEAN_TEST_DOCKER=1.',
};

test('real Lean accepts a true theorem and rejects a false candidate', options, async () => {
  const valid = await verifier.verify('∀ (a b : Nat), a + b = b + a', [
    { tactic: 'intro', names: ['a', 'b'] },
    { tactic: 'exact', term: 'Nat.add_comm a b' },
  ]);
  assert.equal(valid.status, 'verified', valid.diagnostics);
  assert.ok(Array.isArray(valid.axioms));
  const invalid = await verifier.verify('False', [{ tactic: 'exact', term: 'True.intro' }]);
  assert.equal(invalid.status, 'rejected');
  assert.ok(invalid.diagnostics);
});

test(
  'real Lean replays the complete shared-lemma research workflow with scripted AI fixtures',
  options,
  async (t) => {
    const store = new Store();
    t.after(() => store.close());
    const p = store.createProblem({ ...SAMPLE, mode: 'live' });
    store.addFunding(
      p.id,
      { name: 'Fixture only', model: 'scripted-fixture', budgetMicros: 10000 },
      'fixture-never-sent',
    );
    store.setStatus(p.id, 'running');
    const engine = new Engine(store, { liveProvider: new DemoProvider(), liveVerifier: verifier });
    const result = await engine.drain(p.id, 8);
    assert.equal(
      result.problem.status,
      'solved',
      JSON.stringify(result.tasks.map((t) => t.feedback)),
    );
    assert.equal(result.goals.length, 3);
    assert.ok(result.artifacts.every((a) => a.status === 'verified'));
    const root = store.evidence(store.goal(p.root_id).artifact_id);
    assert.equal(root.dependencies.length, 3);
    assert.equal(root.statement, SAMPLE.statement);
    assert.ok(root.verification.sourceHash);
    assert.equal(store.allocation(p.id).payoutStatus, 'not_implemented');
  },
);
