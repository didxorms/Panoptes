import test from 'node:test';
import assert from 'node:assert/strict';
import { Vault } from '../src/vault.mjs';
import { OpenRouterProvider, ProviderError } from '../src/providers.mjs';
import { temporary } from './helpers.mjs';

test('vault persists its key, uses distinct nonces, and rejects modified ciphertext', (t) => {
  const directory = temporary(t),
    vault = new Vault(directory),
    ciphertext = vault.seal('fixture-secret');
  assert.notEqual(vault.seal('fixture-secret'), ciphertext);
  assert.equal(new Vault(directory).open(ciphertext), 'fixture-secret');
  const damaged = Buffer.from(ciphertext, 'base64');
  damaged[damaged.length - 1] ^= 1;
  assert.throws(() => vault.open(damaged.toString('base64')));
  assert.throws(() => new Vault(directory, Buffer.alloc(8).toString('base64')), /32 bytes/);
});

test('provider reserves from current prices and records actual cost receipts', async () => {
  const requests = [];
  const provider = new OpenRouterProvider({
    vault: { open: () => 'fixture-key' },
    fetcher: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () =>
          url.endsWith('/models')
            ? {
                data: [
                  {
                    id: 'vendor/model',
                    pricing: { prompt: '0.000001', completion: '0.000002', request: '0' },
                  },
                ],
              }
            : {
                id: 'receipt-id',
                usage: { cost: 0.00031 },
                choices: [{ message: { content: '{}' } }],
              },
      };
    },
  });
  const funding = { model: 'vendor/model', secret: 'encrypted' },
    context = { goal: 'True' };
  const quote = await provider.quote(funding, context);
  assert.ok(quote > 4800);
  assert.equal(await provider.quote(funding, context), quote);
  assert.equal(requests.length, 1);
  const generated = await provider.generate({ funding, context });
  assert.equal(generated.costMicros, 310);
  assert.equal(generated.providerId, 'receipt-id');
  const sent = JSON.parse(requests[1].options.body);
  assert.equal(sent.provider.allow_fallbacks, true);
  assert.equal(sent.max_tokens, 2400);
  assert.equal(sent.usage.include, true);
  assert.equal(requests[1].options.headers.Authorization, 'Bearer fixture-key');
  assert.ok(!requests[1].options.body.includes('fixture-key'));
});

test('missing cost receipts, unsupported BYOK, and HTTP errors cannot be reported as free calls', async () => {
  for (const result of [
    { ok: true, id: 'missing', usage: {} },
    { ok: true, id: 'byok', usage: { cost: 0, is_byok: true } },
    { ok: false, status: 429 },
  ]) {
    const provider = new OpenRouterProvider({
      vault: { open: () => 'fixture' },
      fetcher: async () => ({ ...result, json: async () => result }),
    });
    await assert.rejects(
      provider.generate({ funding: { model: 'fixture', secret: 'fixture' }, context: {} }),
    );
  }
});

test('explicit HTTP rejection is releasable while a lost receipt remains uncertain', async () => {
  const rejected = new OpenRouterProvider({
    vault: { open: () => 'fixture' },
    fetcher: async () => ({ ok: false, status: 402 }),
  });
  await assert.rejects(
    rejected.generate({ funding: { model: 'fixture', secret: 'fixture' }, context: {} }),
    (error) => error instanceof ProviderError && error.chargeState === 'none',
  );
  const missing = new OpenRouterProvider({
    vault: { open: () => 'fixture' },
    fetcher: async () => ({ ok: true, json: async () => ({ id: 'x', usage: {} }) }),
  });
  await assert.rejects(
    missing.generate({ funding: { model: 'fixture', secret: 'fixture' }, context: {} }),
    (error) => error instanceof ProviderError && error.chargeState === 'uncertain',
  );
});
