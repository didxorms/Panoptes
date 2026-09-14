import { createApp } from './app.mjs';
import { seedDemo } from './engine.mjs';

const app = createApp();
try {
  if (process.argv[2] !== 'demo') throw new Error('Usage: npm run demo');
  const problem = seedDemo(app.store);
  app.store.setStatus(problem.id, 'running');
  const result = await app.engine.drain(problem.id);
  console.log(
    JSON.stringify(
      {
        mode: 'simulation',
        status: result.problem.status,
        problemId: problem.id,
        goals: result.goals.length,
        routes: result.routes.length,
        artifacts: result.artifacts.length,
        realProofs: 0,
        realPayouts: 0,
        dashboard: 'http://127.0.0.1:3100',
      },
      null,
      2,
    ),
  );
  if (result.problem.status !== 'demo_completed') process.exitCode = 1;
} finally {
  app.store.close();
}
