import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';
import { seedDemo } from './engine.mjs';
import { assert, AppError } from './util.mjs';

const version = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
).version;
const publicFiles = new Map([
  ['/', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);
function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}
async function body(req) {
  assert(
    req.headers['content-type']?.split(';')[0] === 'application/json',
    'Use application/json.',
    415,
  );
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64000) throw new AppError('Request body is too large.', 413);
    chunks.push(chunk);
  }
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new AppError('Invalid JSON.');
  }
  assert(input && typeof input === 'object' && !Array.isArray(input), 'Expected a JSON object.');
  return input;
}
export function createHttpServer(app, { background = true } = {}) {
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method !== 'GET') {
        assert(req.method === 'POST', 'Method not allowed.', 405);
        const supplied = req.headers.authorization?.replace(/^Bearer /, '') || '';
        const received = Buffer.from(supplied),
          expected = Buffer.from(app.token);
        assert(
          received.length === expected.length && timingSafeEqual(received, expected),
          'A valid control token is required.',
          401,
        );
        if (req.headers.origin) {
          const origin = new URL(req.headers.origin);
          assert(origin.host === req.headers.host, 'Cross-origin changes are blocked.', 403);
        }
      }
      if (req.method === 'GET' && url.pathname === '/api/health')
        return send(res, 200, { ok: true, version });
      if (req.method === 'GET' && url.pathname === '/api/problems')
        return send(res, 200, {
          version,
          problems: app.store.all('SELECT * FROM problems ORDER BY created_at DESC'),
        });
      const match = url.pathname.match(
        /^\/api\/problems\/([a-f0-9-]{36})(?:\/(start|pause|stop|funding|allocation))?$/,
      );
      if (match) {
        const [, problemId, action] = match;
        const p = app.store.problem(problemId);
        if (req.method === 'GET' && !action) return send(res, 200, app.store.snapshot(problemId));
        if (req.method === 'GET' && action === 'allocation')
          return send(res, 200, app.store.allocation(problemId));
        if (req.method === 'POST') {
          const input = await body(req);
          if (action === 'start') {
            if (p.mode === 'live') {
              const check = await app.liveVerifier.verify('True', [
                { tactic: 'exact', term: 'True.intro' },
              ]);
              assert(
                check.status === 'verified',
                'Live research requires a working Lean Docker image. No AI budget has been used.',
                503,
              );
            }
            app.store.setStatus(problemId, 'running');
            return send(res, 200, { status: 'running' });
          }
          if (action === 'pause' || action === 'stop') {
            app.store.setStatus(problemId, action === 'pause' ? 'paused' : 'stopped');
            return send(res, 200, { ok: true });
          }
          if (action === 'funding') {
            assert(
              p.mode !== 'live' ||
                (typeof input.apiKey === 'string' &&
                  input.apiKey.length >= 16 &&
                  input.apiKey.length <= 500),
              'Provide an OpenRouter API key.',
            );
            const secret = p.mode === 'live' ? app.vault.seal(input.apiKey) : null;
            const fundingId = app.store.addFunding(problemId, input, secret);
            return send(res, 201, { id: fundingId });
          }
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/demo') {
        await body(req);
        const p = seedDemo(app.store);
        app.store.setStatus(p.id, 'running');
        return send(res, 201, { id: p.id });
      }
      if (req.method === 'POST' && url.pathname === '/api/problems') {
        const input = await body(req);
        assert(input.mode === 'live', 'Use the sample endpoint for simulations.');
        return send(res, 201, app.store.createProblem(input));
      }
      if (req.method === 'GET' && publicFiles.has(url.pathname)) {
        const [file, type] = publicFiles.get(url.pathname);
        res.writeHead(200, {
          'Content-Type': type + '; charset=utf-8',
          'Cache-Control': 'no-cache',
        });
        res.end(await readFile(new URL('../public/' + file, import.meta.url)));
        return;
      }
      send(res, 404, { error: 'Not found.' });
    } catch (error) {
      send(res, error.status || 500, {
        error: error.status ? error.message : 'The request could not be completed.',
      });
    }
  });
  let timer;
  if (background) {
    timer = setInterval(() => {
      for (const p of app.store.all("SELECT id FROM problems WHERE status='running'"))
        app.engine.tick(p.id).catch(() => {});
    }, 500);
    timer.unref();
  }
  server.on('close', () => clearInterval(timer));
  return server;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const app = createApp();
  const server = createHttpServer(app);
  const host = process.env.PANOPTES_HOST || '127.0.0.1',
    port = Number(process.env.PANOPTES_PORT || 3100);
  server.listen(port, host, () => {
    console.log(`Panoptes v${version} — http://${host}:${port}`);
    console.log(`Control token file: ${app.tokenFile}`);
    console.log('This development server is intended for trusted, local operation.');
  });
  const shutdown = () => {
    server.close();
    const waiting = setInterval(() => {
      if (!app.engine.busy.size) {
        clearInterval(waiting);
        app.store.close();
        process.exit(0);
      }
    }, 100);
    waiting.unref();
    setTimeout(() => process.exit(0), 65000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
