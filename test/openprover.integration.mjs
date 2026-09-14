import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { RawLeanVerifier, openProverTemplate } from '../src/lean.mjs';
import { OpenProverRunner } from '../src/openprover.mjs';
import { temporary } from './helpers.mjs';

const enabled = process.env.PANOPTES_OPENPROVER_TEST_DOCKER === '1';
const proof = openProverTemplate('True').replace('sorry', 'exact True.intro');

test(
  'pinned OpenProver coordinates parallel workers and submits an exact Lean proof over RPC',
  { skip: enabled ? false : 'Set PANOPTES_OPENPROVER_TEST_DOCKER=1 after building both images.' },
  async (t) => {
    const store = new Store();
    t.after(() => store.close());
    const problem = store.createProblem({
      title: 'OpenProver fixture',
      description: 'Ask several workers to prove the fixed target.',
      statement: 'True',
      mode: 'live',
      engine: 'openprover',
    });
    store.addFunding(
      problem.id,
      { name: 'Scripted resource', model: 'fixture/model', budgetMicros: 100000 },
      'encrypted-fixture',
    );
    store.setStatus(problem.id, 'running');
    const labels = [];
    const provider = {
      quoteChat: async () => 10,
      complete: async ({ label }) => {
        labels.push(label);
        let content;
        if (label === 'planner_step_1')
          content = `<OPENPROVER_ACTION>\naction = "spawn"\n[[tasks]]\nsummary = "Direct proof"\ndescription = "Produce a complete Lean proof of True."\n[[tasks]]\nsummary = "Independent check"\ndescription = "Independently derive a Lean proof of True."\n[[tasks]]\nsummary = "Alternative check"\ndescription = "Check the exact theorem template and propose a proof."\n</OPENPROVER_ACTION>`;
        else if (label?.startsWith('worker_'))
          content = `A complete candidate is:\n\n\`\`\`lean\n${proof}\`\`\``;
        else if (label?.startsWith('verifier_'))
          content = 'The candidate proves the target.\nVERDICT: CORRECT';
        else if (label === 'planner_step_2')
          content = `<OPENPROVER_ACTION>\naction = "write_items"\nsummary = "Save the checked proofs"\n[[items]]\nslug = "informal-proof"\ncontent = """\nSummary: True is inhabited.\n\nThe constructor True.intro proves True.\n"""\n[[items]]\nslug = "final-proof"\nformat = "lean"\ncontent = """\n${proof}"""\n</OPENPROVER_ACTION>\n<OPENPROVER_ACTION>\naction = "submit_proof"\nsummary = "Submit the mathematical proof"\nproof_slug = "informal-proof"\n</OPENPROVER_ACTION>\n<OPENPROVER_ACTION>\naction = "submit_lean_proof"\nsummary = "Submit the exact Lean proof"\nlean_proof_slug = "final-proof"\n</OPENPROVER_ACTION>`;
        else if (label === 'discussion')
          content = 'The parallel workers agreed on a kernel-checked proof.';
        else throw new Error(`Unexpected scripted call: ${label}`);
        return {
          content,
          toolCalls: [],
          costMicros: 1,
          providerId: `fixture-${labels.length}`,
          finishReason: 'stop',
          usage: { prompt_tokens: 10, completion_tokens: 10 },
          model: 'fixture/model',
        };
      },
    };
    const runner = new OpenProverRunner({
      store,
      provider,
      verifier: new RawLeanVerifier(),
      directory: temporary(t),
    });
    assert.equal(await runner.ready(), true);
    const outcome = await runner.runTask(store.claim(problem.id, 'OpenProver'));
    assert.equal(outcome.proof, proof);
    assert.equal(outcome.verification.status, 'verified', outcome.verification.diagnostics);
    assert.equal(labels.filter((label) => label?.startsWith('worker_')).length, 3);
    assert.equal(labels.filter((label) => label?.startsWith('verifier_')).length, 3);
    assert.ok(store.snapshot(problem.id).calls.every((call) => call.status === 'confirmed'));
  },
);
