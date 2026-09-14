import { join, resolve } from 'node:path';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Store } from './store.mjs';
import { Vault } from './vault.mjs';
import { Engine } from './engine.mjs';
import { DemoProvider, OpenRouterProvider } from './providers.mjs';
import { DemoVerifier, LeanVerifier, RawLeanVerifier } from './lean.mjs';
import { OpenProverRunner } from './openprover.mjs';
import { assert } from './util.mjs';

export function createApp({
  directory = resolve(process.env.PANOPTES_DATA_DIR || '.panoptes'),
  token = process.env.PANOPTES_ADMIN_TOKEN,
  store,
  liveVerifier,
  rawVerifier,
  openProverRunner,
} = {}) {
  mkdirSync(directory, { recursive: true });
  const tokenFile = join(directory, 'admin.token');
  if (!token) {
    if (!existsSync(tokenFile))
      writeFileSync(tokenFile, randomBytes(24).toString('hex'), { flag: 'wx', mode: 0o600 });
    token = readFileSync(tokenFile, 'utf8').trim();
  }
  assert(token.length >= 32, 'Admin token must contain at least 32 characters.');
  const vault = new Vault(directory),
    database = store || new Store(join(directory, 'research.sqlite'));
  const liveProvider = new OpenRouterProvider({ vault });
  const verifiers = {
    demoVerifier: new DemoVerifier(),
    liveVerifier: liveVerifier || new LeanVerifier({ image: process.env.PANOPTES_LEAN_IMAGE }),
    rawVerifier: rawVerifier || new RawLeanVerifier({ image: process.env.PANOPTES_LEAN_IMAGE }),
  };
  const researchRunner =
    openProverRunner ||
    new OpenProverRunner({
      store: database,
      provider: liveProvider,
      verifier: verifiers.rawVerifier,
      directory,
      image: process.env.PANOPTES_OPENPROVER_IMAGE,
    });
  const engine = new Engine(database, {
    ...verifiers,
    demoProvider: new DemoProvider(),
    liveProvider,
    openProverRunner: researchRunner,
  });
  return {
    store: database,
    vault,
    engine,
    token,
    tokenFile,
    directory,
    liveProvider,
    openProverRunner: researchRunner,
    ...verifiers,
  };
}
