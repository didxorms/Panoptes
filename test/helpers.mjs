import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { Engine } from '../src/engine.mjs';
import { DemoProvider } from '../src/providers.mjs';
import { DemoVerifier, ENVIRONMENT } from '../src/lean.mjs';

export function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), 'panoptes-test-'));
  t.after(() => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('panoptes-test-'));
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}
export function setup(t, mode = 'demo', target = 'True') {
  const store = new Store();
  t.after(() => store.close());
  const problem = store.createProblem({
    title: 'Test research',
    statement: target,
    mode,
    engine: 'native',
  });
  store.setStatus(problem.id, 'running');
  const engine = new Engine(store, {
    demoProvider: new DemoProvider(),
    demoVerifier: new DemoVerifier(),
    liveProvider: null,
    liveVerifier: null,
  });
  return { store, problem, engine };
}
export const accepted = (mode = 'demo') => ({
  status: mode === 'demo' ? 'simulated' : 'verified',
  environment: ENVIRONMENT,
  diagnostics: 'Injected test fixture, not a real verification.',
});
export function artifact(store, task, target = 'True', kind = 'proof', mode = 'demo') {
  return store.saveArtifact(
    task,
    { kind, statement: target, proof: [{ tactic: 'exact', term: 'True.intro' }] },
    accepted(mode),
  );
}
