import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { id, iso, hash, json, assert, text, integer } from './util.mjs';
import { ENVIRONMENT, statement, alias } from './lean.mjs';

export class Store {
  constructor(file = ':memory:') {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS problems(id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,mode TEXT NOT NULL,status TEXT NOT NULL,root_id TEXT,environment TEXT NOT NULL,bounty_cents INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS goals(id TEXT PRIMARY KEY,problem_id TEXT NOT NULL REFERENCES problems(id),statement TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',artifact_id TEXT,UNIQUE(problem_id,statement));
      CREATE TABLE IF NOT EXISTS routes(id TEXT PRIMARY KEY,problem_id TEXT NOT NULL REFERENCES problems(id),goal_id TEXT NOT NULL REFERENCES goals(id),label TEXT NOT NULL,requirements TEXT NOT NULL,bridge_id TEXT NOT NULL,status TEXT NOT NULL,route_key TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,problem_id TEXT NOT NULL REFERENCES problems(id),goal_id TEXT NOT NULL REFERENCES goals(id),route_id TEXT,kind TEXT NOT NULL,status TEXT NOT NULL,priority INTEGER NOT NULL,worker TEXT,token TEXT,lease_until INTEGER NOT NULL DEFAULT 0,steps INTEGER NOT NULL DEFAULT 0,feedback TEXT NOT NULL DEFAULT '',checkpoint TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY,problem_id TEXT NOT NULL REFERENCES problems(id),goal_id TEXT NOT NULL REFERENCES goals(id),task_id TEXT NOT NULL,kind TEXT NOT NULL,statement TEXT NOT NULL,proof TEXT NOT NULL,dependencies TEXT NOT NULL,verification TEXT NOT NULL,status TEXT NOT NULL,summary TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,problem_id TEXT NOT NULL REFERENCES problems(id),kind TEXT NOT NULL,message TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS funding(id TEXT PRIMARY KEY,problem_id TEXT NOT NULL REFERENCES problems(id),name TEXT NOT NULL,model TEXT NOT NULL,budget_micros INTEGER NOT NULL,spent_micros INTEGER NOT NULL DEFAULT 0,reserved_micros INTEGER NOT NULL DEFAULT 0,secret TEXT,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,problem_id TEXT NOT NULL REFERENCES problems(id),task_id TEXT NOT NULL,run_token TEXT NOT NULL,funding_id TEXT NOT NULL REFERENCES funding(id),reserved_micros INTEGER NOT NULL,cost_micros INTEGER,status TEXT NOT NULL,provider_id TEXT,created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS task_queue ON tasks(problem_id,status,priority);
      CREATE INDEX IF NOT EXISTS artifact_goal ON artifacts(goal_id,status);
      CREATE INDEX IF NOT EXISTS event_problem ON events(problem_id,seq);`);
  }
  close() {
    this.db.close();
  }
  run(sql, ...args) {
    return this.db.prepare(sql).run(...args);
  }
  one(sql, ...args) {
    return this.db.prepare(sql).get(...args);
  }
  all(sql, ...args) {
    return this.db.prepare(sql).all(...args);
  }
  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  event(problemId, kind, message, data = {}) {
    this.run(
      'INSERT INTO events(problem_id,kind,message,data,created_at) VALUES(?,?,?,?,?)',
      problemId,
      kind,
      message,
      JSON.stringify(data),
      iso(),
    );
  }
  problem(problemId) {
    const p = this.one('SELECT * FROM problems WHERE id=?', problemId);
    assert(p, 'Problem not found.', 404);
    return p;
  }
  goal(goalId) {
    const g = this.one('SELECT * FROM goals WHERE id=?', goalId);
    assert(g, 'Goal not found.', 404);
    return g;
  }
  addGoal(problemId, value) {
    value = statement(value);
    const old = this.one(
      'SELECT * FROM goals WHERE problem_id=? AND statement=?',
      problemId,
      value,
    );
    if (old) return old;
    const goalId = id();
    this.run('INSERT INTO goals(id,problem_id,statement) VALUES(?,?,?)', goalId, problemId, value);
    return this.goal(goalId);
  }
  addTask(problemId, goalId, kind = 'prove', priority = 50, routeId = null) {
    const taskId = id();
    this.run(
      'INSERT INTO tasks(id,problem_id,goal_id,route_id,kind,status,priority,created_at) VALUES(?,?,?,?,?,?,?,?)',
      taskId,
      problemId,
      goalId,
      routeId,
      kind,
      'queued',
      priority,
      iso(),
    );
    return taskId;
  }
  createProblem(input) {
    const title = text(input.title, 'Title', 120),
      description = text(input.description || 'An open research workspace.', 'Description', 2000),
      target = statement(input.statement);
    const mode = input.mode || 'demo';
    assert(['demo', 'live'].includes(mode), 'Invalid mode.');
    const bounty = integer(input.bountyCents ?? 0, 'Bounty cents', 0, 100_000_000);
    return this.tx(() => {
      const problemId = id();
      this.run(
        'INSERT INTO problems(id,title,description,mode,status,environment,bounty_cents,created_at) VALUES(?,?,?,?,?,?,?,?)',
        problemId,
        title,
        description,
        mode,
        'draft',
        ENVIRONMENT,
        bounty,
        iso(),
      );
      const goal = this.addGoal(problemId, target);
      this.run('UPDATE problems SET root_id=? WHERE id=?', goal.id, problemId);
      for (let i = 0; i < 3; i++) this.addTask(problemId, goal.id, 'explore', 20);
      this.event(problemId, 'problem.created', 'Research workspace created.', { mode });
      return this.problem(problemId);
    });
  }
  addFunding(problemId, input, secret = null) {
    const p = this.problem(problemId);
    const budget = integer(input.budgetMicros, 'Budget', 1, 1_000_000_000);
    const model = text(input.model || 'simulation', 'Model', 160);
    const display = text(input.name, 'Contributor name', 80);
    assert(!['solved', 'demo_completed', 'stopped'].includes(p.status), 'This research is closed.');
    assert(p.mode !== 'live' || secret, 'A live contribution needs an encrypted API key.');
    const fundingId = id();
    this.tx(() => {
      this.run(
        'INSERT INTO funding(id,problem_id,name,model,budget_micros,secret,created_at) VALUES(?,?,?,?,?,?,?)',
        fundingId,
        problemId,
        display,
        model,
        budget,
        secret,
        iso(),
      );
      this.event(problemId, 'funding.added', `${display} added research capacity.`, {
        fundingId,
        budgetMicros: budget,
        model,
      });
    });
    return fundingId;
  }
  setStatus(problemId, status) {
    const p = this.problem(problemId);
    assert(['running', 'paused', 'stopped'].includes(status), 'Invalid research state.');
    assert(!['solved', 'demo_completed', 'stopped'].includes(p.status), 'This research is closed.');
    this.tx(() => {
      this.run('UPDATE problems SET status=? WHERE id=?', status, problemId);
      if (status === 'running')
        this.run(
          "UPDATE tasks SET status='queued',steps=0 WHERE problem_id=? AND status='paused'",
          problemId,
        );
      if (status === 'stopped')
        this.run(
          "UPDATE tasks SET status='cancelled',token=NULL WHERE problem_id=? AND status IN ('queued','leased','paused')",
          problemId,
        );
      this.event(
        problemId,
        'research.' + status,
        status === 'running'
          ? 'Research started.'
          : status === 'paused'
            ? 'Research paused. Existing calls may finish.'
            : 'Research stopped.',
      );
    });
  }
  claim(problemId, worker, now = Date.now()) {
    return this.tx(() => {
      if (this.problem(problemId).status !== 'running') return null;
      const expired = this.all(
        "SELECT id,token FROM tasks WHERE problem_id=? AND status='leased' AND lease_until<=?",
        problemId,
        now,
      );
      let uncertain = false;
      for (const task of expired) {
        this.run("UPDATE tasks SET status='queued',token=NULL,worker=NULL WHERE id=?", task.id);
        const calls = this.run(
          "UPDATE calls SET status='uncertain' WHERE task_id=? AND run_token=? AND status='reserved'",
          task.id,
          task.token,
        );
        uncertain ||= calls.changes > 0;
        this.event(problemId, 'task.recovered', 'An interrupted task returned to the queue.', {
          taskId: task.id,
        });
      }
      if (uncertain) {
        this.run("UPDATE problems SET status='paused' WHERE id=?", problemId);
        this.event(
          problemId,
          'budget.uncertain',
          'An interrupted call has unconfirmed cost. Its reservation is retained.',
        );
        return null;
      }
      const task = this.one(
        "SELECT t.* FROM tasks t JOIN goals g ON g.id=t.goal_id WHERE t.problem_id=? AND t.status='queued' AND g.status='open' ORDER BY t.priority DESC,t.created_at,t.id LIMIT 1",
        problemId,
      );
      if (!task) return null;
      const token = id();
      this.run(
        "UPDATE tasks SET status='leased',token=?,worker=?,lease_until=? WHERE id=?",
        token,
        worker,
        now + 90_000,
        task.id,
      );
      this.event(
        problemId,
        'task.started',
        `${worker} started ${task.kind === 'integrate' ? 'assembling a proof' : task.kind === 'explore' ? 'an independent approach' : 'a proof task'}.`,
        { taskId: task.id, goalId: task.goal_id },
      );
      return { ...task, token, worker };
    });
  }
  owned(taskId, token) {
    const task = this.one(
      'SELECT * FROM tasks WHERE id=? AND token=? AND status=?',
      taskId,
      token,
      'leased',
    );
    assert(task && task.lease_until > Date.now(), 'This task lease is no longer valid.', 409);
    return task;
  }
  heartbeat(taskId, token) {
    this.run(
      "UPDATE tasks SET lease_until=? WHERE id=? AND token=? AND status='leased' AND lease_until>?",
      Date.now() + 90_000,
      taskId,
      token,
      Date.now(),
    );
  }
  finish(task, { feedback = '', checkpoint = '', done = false, pause = false } = {}) {
    this.owned(task.id, task.token);
    const latest = this.one('SELECT steps FROM tasks WHERE id=?', task.id);
    const steps = latest.steps + 1,
      status = done ? 'completed' : pause || steps >= 12 ? 'paused' : 'queued';
    this.run(
      'UPDATE tasks SET status=?,steps=?,feedback=?,checkpoint=?,token=NULL,lease_until=0 WHERE id=? AND token=?',
      status,
      steps,
      String(feedback).slice(-12000),
      String(checkpoint).slice(0, 3000),
      task.id,
      task.token,
    );
  }
  saveArtifact(task, value, result) {
    this.owned(task.id, task.token);
    const p = this.problem(task.problem_id);
    const expected = p.mode === 'demo' ? 'simulated' : 'verified';
    assert(result.environment === p.environment, 'Verifier environment mismatch.');
    assert(
      result.status === expected || result.status === 'rejected',
      'Verifier cannot cross simulation/live boundaries.',
    );
    const artifactId = id();
    this.run(
      'INSERT INTO artifacts VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      artifactId,
      p.id,
      task.goal_id,
      task.id,
      value.kind,
      value.statement,
      JSON.stringify(value.proof),
      JSON.stringify(value.dependencies || []),
      JSON.stringify(result),
      result.status,
      String(value.summary || '').slice(0, 2000),
      iso(),
    );
    this.event(
      p.id,
      'artifact.' + result.status,
      result.status === 'rejected'
        ? 'A proof candidate needs revision.'
        : p.mode === 'demo'
          ? 'A simulated research artifact was shared.'
          : 'A Lean-checked artifact was shared.',
      { artifactId, goalId: task.goal_id, kind: value.kind },
    );
    return artifactId;
  }
  evidence(artifactId) {
    const row = this.one('SELECT * FROM artifacts WHERE id=?', artifactId);
    assert(row, 'Artifact not found.', 404);
    return {
      ...row,
      proof: json(row.proof),
      dependencies: json(row.dependencies, []),
      verification: json(row.verification),
      alias: alias(row.id),
    };
  }
  dependencies(problemId, artifactIds) {
    assert(Array.isArray(artifactIds) && artifactIds.length <= 24, 'Invalid dependencies.');
    const p = this.problem(problemId),
      result = [],
      seen = new Set();
    const visit = (artifactId) => {
      if (seen.has(artifactId)) return;
      seen.add(artifactId);
      assert(seen.size <= 48, 'Dependency limit reached.');
      const item = this.evidence(artifactId);
      assert(
        item.problem_id === problemId &&
          item.status === (p.mode === 'demo' ? 'simulated' : 'verified'),
        'Only accepted evidence from this problem can be imported.',
      );
      item.dependencies.forEach(visit);
      result.push(item);
    };
    artifactIds.forEach(visit);
    return result;
  }
  completeGoal(task, artifactId, refutation = false) {
    this.tx(() => {
      this.owned(task.id, task.token);
      const evidence = this.evidence(artifactId),
        goal = this.goal(task.goal_id),
        p = this.problem(task.problem_id);
      assert(
        evidence.status === (p.mode === 'demo' ? 'simulated' : 'verified'),
        'Unverified evidence cannot close a goal.',
      );
      assert(
        evidence.problem_id === p.id &&
          evidence.goal_id === goal.id &&
          evidence.verification.environment === p.environment,
        'Evidence belongs to another goal or environment.',
      );
      assert(
        evidence.statement === (refutation ? `¬ (${goal.statement})` : goal.statement),
        'Evidence proves the wrong target.',
      );
      const status = refutation
        ? p.mode === 'demo'
          ? 'simulated_refuted'
          : 'disproved'
        : p.mode === 'demo'
          ? 'simulated'
          : 'proved';
      if (goal.status !== 'open') return;
      this.run('UPDATE goals SET status=?,artifact_id=? WHERE id=?', status, artifactId, goal.id);
      this.run("UPDATE tasks SET status='completed',token=NULL WHERE goal_id=?", goal.id);
      this.run(
        "UPDATE routes SET status=? WHERE goal_id=? AND status='active'",
        refutation ? 'refuted' : 'completed',
        goal.id,
      );
      if (refutation) {
        for (const route of this.all('SELECT * FROM routes WHERE problem_id=?', p.id)) {
          if (json(route.requirements, []).includes(goal.id)) {
            this.run("UPDATE routes SET status='refuted' WHERE id=?", route.id);
            this.run("UPDATE tasks SET status='cancelled',token=NULL WHERE route_id=?", route.id);
          }
        }
      }
      if (goal.id === p.root_id) {
        // v0.0.0 root contracts require a proof. A disproof is reported, never paid.
        const state = refutation ? 'stopped' : p.mode === 'demo' ? 'demo_completed' : 'solved';
        this.run('UPDATE problems SET status=? WHERE id=?', state, p.id);
        this.run(
          "UPDATE tasks SET status='cancelled',token=NULL WHERE problem_id=? AND status IN ('queued','leased','paused')",
          p.id,
        );
        this.event(
          p.id,
          'research.' + state,
          refutation
            ? 'The target was refuted; this proof-only contract has no reward.'
            : p.mode === 'demo'
              ? 'Simulation complete. No mathematical result or payout is claimed.'
              : 'The original target passed Lean and kernel replay.',
        );
      }
    });
    this.activateIntegrations(task.problem_id);
  }
  addRoute(task, label, subgoals, bridgeId) {
    return this.tx(() => {
      this.owned(task.id, task.token);
      const parent = this.goal(task.goal_id);
      assert(
        Array.isArray(subgoals) && subgoals.length >= 1 && subgoals.length <= 4,
        'A route needs 1–4 subgoals.',
      );
      subgoals = subgoals.map(statement);
      assert(!subgoals.includes(parent.statement), 'A route cannot require its own target.');
      assert(new Set(subgoals).size === subgoals.length, 'Duplicate subgoals.');
      const key = hash([parent.id, subgoals]);
      const old = this.one('SELECT * FROM routes WHERE route_key=?', key);
      if (old) return old.id;
      assert(
        this.one('SELECT COUNT(*) AS n FROM routes WHERE problem_id=?', task.problem_id).n < 12,
        'Route limit reached.',
      );
      assert(
        this.one('SELECT COUNT(*) AS n FROM goals WHERE problem_id=?', task.problem_id).n +
          subgoals.length <=
          24,
        'Goal limit reached.',
      );
      const requirements = subgoals.map((s) => this.addGoal(task.problem_id, s));
      const reaches = (goalId, target, seen = new Set()) => {
        if (goalId === target) return true;
        if (seen.has(goalId)) return false;
        seen.add(goalId);
        return this.all('SELECT requirements FROM routes WHERE goal_id=?', goalId).some((r) =>
          json(r.requirements, []).some((g) => reaches(g, target, seen)),
        );
      };
      assert(
        !requirements.some((g) => reaches(g.id, parent.id)),
        'Circular goal dependencies are not allowed.',
      );
      const bridge = this.evidence(bridgeId),
        p = this.problem(task.problem_id);
      assert(
        bridge.problem_id === p.id &&
          bridge.goal_id === parent.id &&
          bridge.status === (p.mode === 'demo' ? 'simulated' : 'verified') &&
          bridge.statement === bridgeStatement(subgoals, parent.statement),
        'The route needs evidence for its exact conditional bridge.',
      );
      const routeStatus = requirements.some((g) =>
        ['disproved', 'simulated_refuted'].includes(g.status),
      )
        ? 'refuted'
        : 'active';
      const routeId = id();
      this.run(
        'INSERT INTO routes VALUES(?,?,?,?,?,?,?,?)',
        routeId,
        task.problem_id,
        parent.id,
        text(label, 'Route label', 120),
        JSON.stringify(requirements.map((g) => g.id)),
        bridgeId,
        routeStatus,
        key,
      );
      if (routeStatus === 'active')
        for (const goal of requirements)
          if (
            goal.status === 'open' &&
            !this.one(
              "SELECT id FROM tasks WHERE goal_id=? AND status IN ('queued','leased')",
              goal.id,
            )
          )
            this.addTask(task.problem_id, goal.id);
      this.event(task.problem_id, 'route.created', `New proof route: ${label}`, {
        routeId,
        goalId: parent.id,
      });
      return routeId;
    });
  }
  activateIntegrations(problemId) {
    const p = this.problem(problemId);
    if (['solved', 'stopped', 'demo_completed'].includes(p.status)) return;
    this.tx(() => {
      for (const route of this.all(
        "SELECT * FROM routes WHERE problem_id=? AND status='active'",
        problemId,
      )) {
        if (this.goal(route.goal_id).status !== 'open') {
          this.run("UPDATE routes SET status='completed' WHERE id=?", route.id);
          continue;
        }
        const ready = json(route.requirements, []).every((g) =>
          ['proved', 'simulated'].includes(this.goal(g).status),
        );
        if (
          ready &&
          !this.one("SELECT id FROM tasks WHERE route_id=? AND kind='integrate'", route.id)
        ) {
          this.addTask(problemId, route.goal_id, 'integrate', 100, route.id);
          this.event(
            problemId,
            'integration.ready',
            'All required lemmas are ready for assembly.',
            { routeId: route.id },
          );
        }
      }
    });
  }
  reserve(task, fundingId, amount) {
    integer(amount, 'Reservation', 1, 1_000_000_000);
    return this.tx(() => {
      this.owned(task.id, task.token);
      assert(this.problem(task.problem_id).status === 'running', 'Research is not running.', 409);
      const change = this.run(
        'UPDATE funding SET reserved_micros=reserved_micros+? WHERE id=? AND problem_id=? AND active=1 AND budget_micros-spent_micros-reserved_micros>=?',
        amount,
        fundingId,
        task.problem_id,
        amount,
      );
      assert(change.changes === 1, 'Insufficient available budget.', 409);
      const callId = id();
      this.run(
        'INSERT INTO calls(id,problem_id,task_id,run_token,funding_id,reserved_micros,status,created_at) VALUES(?,?,?,?,?,?,?,?)',
        callId,
        task.problem_id,
        task.id,
        task.token,
        fundingId,
        amount,
        'reserved',
        iso(),
      );
      return callId;
    });
  }
  settle(callId, cost, providerId = null) {
    integer(cost, 'Reported cost', 0, 1_000_000_000);
    this.tx(() => {
      const call = this.one('SELECT * FROM calls WHERE id=?', callId);
      assert(call, 'Call not found.');
      if (call.status !== 'reserved') return;
      this.run(
        "UPDATE calls SET status='confirmed',cost_micros=?,provider_id=? WHERE id=?",
        cost,
        providerId,
        callId,
      );
      this.run(
        'UPDATE funding SET reserved_micros=reserved_micros-?,spent_micros=spent_micros+? WHERE id=?',
        call.reserved_micros,
        cost,
        call.funding_id,
      );
      if (cost > call.reserved_micros) {
        this.run(
          "UPDATE problems SET status='paused' WHERE id=? AND status='running'",
          call.problem_id,
        );
        this.event(
          call.problem_id,
          'budget.overrun',
          'Provider cost exceeded its reservation; research paused for review.',
        );
      }
    });
  }
  uncertain(callId) {
    this.tx(() => {
      const call = this.one('SELECT * FROM calls WHERE id=?', callId);
      if (!call || call.status !== 'reserved') return;
      this.run("UPDATE calls SET status='uncertain' WHERE id=?", callId);
      this.run(
        "UPDATE problems SET status='paused' WHERE id=? AND status='running'",
        call.problem_id,
      );
      this.event(
        call.problem_id,
        'budget.uncertain',
        'A provider call has unconfirmed cost. Its reservation is retained.',
      );
    });
  }
  snapshot(problemId) {
    const problem = this.problem(problemId);
    return {
      problem,
      goals: this.all('SELECT * FROM goals WHERE problem_id=?', problemId),
      routes: this.all('SELECT * FROM routes WHERE problem_id=?', problemId).map((r) => ({
        ...r,
        requirements: json(r.requirements, []),
      })),
      tasks: this.all(
        'SELECT id,goal_id,route_id,kind,status,priority,worker,steps,feedback,checkpoint,created_at FROM tasks WHERE problem_id=?',
        problemId,
      ),
      artifacts: this.all(
        'SELECT id FROM artifacts WHERE problem_id=? ORDER BY created_at',
        problemId,
      ).map((a) => this.evidence(a.id)),
      funding: this.all(
        'SELECT id,name,model,budget_micros,spent_micros,reserved_micros,active FROM funding WHERE problem_id=?',
        problemId,
      ),
      calls: this.all(
        'SELECT id,task_id,funding_id,reserved_micros,cost_micros,status,provider_id FROM calls WHERE problem_id=?',
        problemId,
      ),
      events: this.all(
        'SELECT * FROM events WHERE problem_id=? ORDER BY seq DESC LIMIT 100',
        problemId,
      ).map((e) => ({ ...e, data: json(e.data, {}) })),
    };
  }
  allocation(problemId) {
    const p = this.problem(problemId);
    const unsettled = this.one(
      "SELECT COUNT(*) AS n FROM calls WHERE problem_id=? AND status!='confirmed'",
      problemId,
    ).n;
    const rows = this.all(
      "SELECT f.id,f.name,COALESCE(SUM(c.cost_micros),0) AS cost FROM funding f LEFT JOIN calls c ON c.funding_id=f.id AND c.status='confirmed' WHERE f.problem_id=? GROUP BY f.id ORDER BY f.id",
      problemId,
    );
    const total = rows.reduce((s, r) => s + r.cost, 0);
    const eligible = p.mode === 'live' && p.status === 'solved' && unsettled === 0 && total > 0;
    let assigned = 0;
    const shares = rows.map((r) => {
      const numerator = BigInt(p.bounty_cents) * BigInt(r.cost),
        denom = BigInt(total || 1);
      const cents = eligible ? Number(numerator / denom) : 0;
      assigned += cents;
      return { ...r, cents, remainder: eligible ? numerator % denom : 0n };
    });
    if (eligible) {
      const sorted = [...shares].sort((a, b) =>
        a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1,
      );
      for (let i = 0; i < p.bounty_cents - assigned; i++) sorted[i].cents++;
    }
    return {
      eligible,
      payoutStatus: 'not_implemented',
      unsettledCalls: unsettled,
      shares: shares.map(({ remainder, ...r }) => r),
    };
  }
}
export const bridgeStatement = (requirements, target) =>
  requirements.map((s) => `(${statement(s)})`).join(' → ') + ` → (${statement(target)})`;
