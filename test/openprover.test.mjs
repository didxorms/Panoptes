import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenProverRunner, openProverContainerUser } from '../src/openprover.mjs';
import { ProviderError } from '../src/providers.mjs';
import { temporary } from './helpers.mjs';

test('OpenProver uses the host identity for writable Linux bind mounts', () => {
  assert.equal(
    openProverContainerUser({ platform: 'linux', getuid: () => 1001, getgid: () => 127 }),
    '1001:127',
  );
  assert.equal(openProverContainerUser({ platform: 'win32' }), '1000:1000');
});

test('OpenProver skips a rejected contribution and uses the next available one', async (t) => {
  const failed = [],
    settled = [],
    attempts = [],
    funding = [
      { id: 'empty', model: 'paid', budget_micros: 1000, spent_micros: 0, reserved_micros: 0 },
      { id: 'working', model: 'free', budget_micros: 1000, spent_micros: 0, reserved_micros: 0 },
    ];
  const store = {
    all: () => funding,
    reserve: (_task, fundingId) => `call-${fundingId}`,
    fail: (callId, message) => failed.push({ callId, message }),
    settle: (callId, cost, providerId) => settled.push({ callId, cost, providerId }),
    uncertain: () => assert.fail('A definitive HTTP rejection is not uncertain.'),
  };
  const provider = {
    quoteChat: async () => 100,
    complete: async ({ funding: contribution }) => {
      attempts.push(contribution.id);
      if (contribution.id === 'empty')
        throw new ProviderError('HTTP 402: insufficient credits', {
          chargeState: 'none',
          status: 402,
        });
      return { content: 'ok', costMicros: 0, providerId: 'receipt-free' };
    },
  };
  const runner = new OpenProverRunner({
    store,
    provider,
    verifier: null,
    directory: temporary(t),
  });
  const rejected = new Set();
  const result = await runner.modelCall(
    { id: 'task', problem_id: 'problem', token: 'run' },
    { messages: [{ role: 'user', content: 'prove' }] },
    rejected,
  );

  assert.equal(result.content, 'ok');
  assert.deepEqual(attempts, ['empty', 'working']);
  assert.equal(failed[0].callId, 'call-empty');
  assert.deepEqual(settled, [{ callId: 'call-working', cost: 0, providerId: 'receipt-free' }]);
  assert.deepEqual([...rejected], ['empty']);
});
