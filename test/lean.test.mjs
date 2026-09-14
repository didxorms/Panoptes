import test from 'node:test';
import assert from 'node:assert/strict';
import {
  statement,
  renderSteps,
  sourceFor,
  inspectAxioms,
  DemoVerifier,
  LeanVerifier,
  ENVIRONMENT,
} from '../src/lean.mjs';

test('statement input cannot introduce commands, comments, executable code, or new axioms', () => {
  for (const value of [
    'True\naxiom bad : False',
    'True := by sorry',
    'True -- text',
    'True /-',
    'True; #eval 1',
    '(by exact True)',
    '(let x := True; x)',
    '"True"',
    'True)\n#exit',
    'True\n',
  ])
    assert.throws(() => statement(value), undefined, value);
  assert.equal(statement('∀ (a : Nat), a + 0 = a'), '∀ (a : Nat), a + 0 = a');
});
test('structured proof surface rejects escape hatches', () => {
  for (const step of [
    { tactic: 'run_tac', term: 'IO.println 1' },
    { tactic: 'exact', term: 'sorry' },
    { tactic: 'exact', term: 'True.intro\naxiom x : False' },
    { tactic: 'intro', names: ['x\n#eval'] },
    { tactic: 'exact', term: '(True.intro' },
  ]) {
    assert.throws(() => renderSteps([step]));
  }
  assert.throws(() => renderSteps([{ tactic: 'constructor', branches: [[]] }]));
  assert.throws(
    () =>
      sourceFor(
        'True',
        [{ tactic: 'exact', term: 'True.intro' }],
        [{ id: 'injected\ntheorem', statement: 'True', proof: [] }],
      ),
    /ID/,
  );
});
test('axiom policy rejects sorryAx and other additional assumptions', () => {
  assert.deepEqual(inspectAxioms("'candidate' does not depend on any axioms"), []);
  assert.deepEqual(
    inspectAxioms("'candidate' depends on axioms: [propext, Classical.choice, Quot.sound]"),
    ['propext', 'Classical.choice', 'Quot.sound'],
  );
  assert.throws(() => inspectAxioms("'candidate' depends on axioms: [sorryAx]"), /unapproved/);
  assert.throws(
    () => inspectAxioms("'candidate' depends on axioms: [Lean.ofReduceBool]"),
    /unapproved/,
  );
  assert.throws(() => inspectAxioms('no report'), /axiom report/);
});
test('demo is explicitly simulated even for nonsense; failed kernel replay never verifies', async () => {
  assert.equal(
    (await new DemoVerifier().verify('False', [{ tactic: 'exact', term: 'True.intro' }])).status,
    'simulated',
  );
  const verifier = new LeanVerifier({
    localBin: 'fixture',
    run: async (_cmd, args) =>
      args[0] === '-o'
        ? { code: 0, output: "'candidate' does not depend on any axioms" }
        : { code: 1, output: 'Replay failed' },
  });
  const result = await verifier.verify('True', [{ tactic: 'exact', term: 'True.intro' }]);
  assert.equal(result.status, 'rejected');
  assert.equal(result.environment, ENVIRONMENT);
});
test('Docker verification uses isolation controls, demands replay marker, and removes its container', async () => {
  const calls = [];
  const verifier = new LeanVerifier({
    run: async (command, args) => {
      calls.push({ command, args });
      return { code: 0, output: "'candidate' does not depend on any axioms" };
    },
  });
  assert.equal(
    (await verifier.verify('True', [{ tactic: 'exact', term: 'True.intro' }])).status,
    'rejected',
  );
  assert.ok(calls[0].args.includes('--network=none'));
  assert.ok(calls[0].args.includes('--read-only'));
  assert.ok(calls[0].args.includes('--cap-drop=ALL'));
  assert.deepEqual(calls[1].args.slice(0, 2), ['rm', '-f']);
});
