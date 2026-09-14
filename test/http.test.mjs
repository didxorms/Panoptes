import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.mjs';
import { createHttpServer } from '../src/server.mjs';
import { temporary } from './helpers.mjs';

async function serverFixture(t) {
  let server, app;
  t.after(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    app?.store.close();
  });
  const directory = temporary(t);
  app = createApp({
    directory,
    token: 'test-token-'.repeat(5),
    liveVerifier: { verify: async () => ({ status: 'rejected' }) },
  });
  server = createHttpServer(app, { background: false });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, body, headers = {}) =>
    fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers:
        body === undefined
          ? headers
          : {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${app.token}`,
              ...headers,
            },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { app, request, base };
}

test('read-only dashboard is public; mutations require a token and same-origin access', async (t) => {
  const { app, request } = await serverFixture(t);
  assert.equal((await request('/')).status, 200);
  const health = await request('/api/health');
  assert.equal((await health.json()).ok, true);
  assert.match(health.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await request('/api/demo', {}, { Authorization: '' })).status, 401);
  assert.equal(
    (await request('/api/demo', {}, { Authorization: 'Bearer ' + 'é'.repeat(app.token.length) }))
      .status,
    401,
  );
  assert.equal(
    (await request('/api/demo', {}, { Origin: 'https://attacker.example' })).status,
    403,
  );
  assert.equal((await request('/api/demo', {})).status, 201);
  assert.equal((await request('/api/problems')).status, 200);
  assert.equal((await request('/.panoptes/master.key')).status, 404);
});

test('encrypted provider keys never appear in API snapshots; failed Lean preflight uses no budget', async (t) => {
  const { app, request } = await serverFixture(t);
  const created = await request('/api/problems', {
    title: 'Small real theorem',
    statement: 'True',
    mode: 'live',
  });
  assert.equal(created.status, 201);
  const p = await created.json();
  const apiKey = 'test-openrouter-key-never-sent';
  const contribution = await request(`/api/problems/${p.id}/funding`, {
    name: 'Resource owner',
    model: 'provider/model',
    budgetMicros: 100000,
    apiKey,
  });
  assert.equal(contribution.status, 201);
  const snapshot = await (await request(`/api/problems/${p.id}`)).json();
  assert.equal(snapshot.funding.length, 1);
  assert.ok(!JSON.stringify(snapshot).includes(apiKey));
  assert.ok(!Object.hasOwn(snapshot.funding[0], 'secret'));
  assert.ok(snapshot.tasks.every((task) => !Object.hasOwn(task, 'token')));
  const row = app.store.one('SELECT secret FROM funding WHERE problem_id=?', p.id);
  assert.notEqual(row.secret, apiKey);
  assert.equal(app.vault.open(row.secret), apiKey);
  assert.equal((await request(`/api/problems/${p.id}/start`, {})).status, 503);
  assert.equal(app.store.snapshot(p.id).calls.length, 0);
  assert.equal(app.store.problem(p.id).status, 'draft');
});

test('invalid statements, budgets, modes and content types are rejected without mutation', async (t) => {
  const { app, request } = await serverFixture(t);
  assert.equal((await request('/api/problems', null)).status, 400);
  assert.equal((await request('/api/problems', [])).status, 400);
  assert.equal(
    (
      await request('/api/problems', {
        title: 'Injection',
        mode: 'live',
        statement: 'True\naxiom bad : False',
      })
    ).status,
    400,
  );
  assert.equal(
    (await request('/api/problems', { title: 'Unknown', mode: 'demo', statement: 'True' })).status,
    400,
  );
  assert.equal((await request('/api/demo', {}, { 'Content-Type': 'text/plain' })).status, 415);
  const demo = await (await request('/api/demo', {})).json();
  assert.equal(
    (await request(`/api/problems/${demo.id}/funding`, { name: 'Negative', budgetMicros: -1 }))
      .status,
    400,
  );
  assert.equal(app.store.snapshot(demo.id).funding.length, 3);
});
