const $ = (selector) => document.querySelector(selector);
const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const money = (value) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format((value || 0) / 1e6);
const label = (value) =>
  ({
    demo_completed: 'Simulation complete',
    simulated: 'Simulated',
    verified: 'Lean checked',
    proved: 'Proved',
    running: 'Researching',
    paused: 'Paused',
    draft: 'Ready to start',
    open: 'Open',
    active: 'Active',
    completed: 'Complete',
    leased: 'Working',
    queued: 'Waiting',
    rejected: 'Needs revision',
    disproved: 'Disproved',
    refuted: 'Refuted',
  })[value] || String(value).replaceAll('_', ' ');
const badge = (value) => `<span class="badge ${escape(value)}">${escape(label(value))}</span>`;
let selected = location.hash.slice(1),
  token = sessionStorage.getItem('panoptes-token') || '',
  lastRender = '',
  current = null,
  pendingAction = null,
  refreshing = false;
function notice(message, error = false) {
  const element = $('#notice');
  element.textContent = message;
  element.classList.toggle('error', error);
  element.hidden = false;
}
async function api(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers:
      body === undefined
        ? {}
        : { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) {
      token = '';
      sessionStorage.removeItem('panoptes-token');
      updateAccess();
    }
    throw new Error(data.error || 'Request failed.');
  }
  return data;
}
function controlled(action) {
  if (!token) {
    pendingAction = action;
    $('#access-dialog').showModal();
    return;
  }
  action().catch((error) => notice(error.message, true));
}
function updateAccess() {
  $('#access-state').textContent = token ? '●' : '○';
}
function empty() {
  return '<div class="empty"><div class="empty-orbit" aria-hidden="true">◎</div><h2>A workspace for the next idea.</h2><p>Start a simulation to follow agents from independent approaches to a shared proof. No API key or spending is needed.</p></div>';
}
function render(data) {
  current = data;
  const { problem: p, goals, routes, tasks, artifacts, funding, events } = data;
  const demo = p.mode === 'demo';
  const root = goals.find((g) => g.id === p.root_id);
  const accepted = artifacts.filter((a) => ['verified', 'simulated'].includes(a.status));
  const spent = funding.reduce((s, f) => s + f.spent_micros, 0),
    budget = funding.reduce((s, f) => s + f.budget_micros, 0),
    reserved = funding.reduce((s, f) => s + f.reserved_micros, 0);
  $('#breadcrumb').textContent = p.title;
  const routeCards = routes
    .map(
      (r) =>
        `<div class="route-card"><div class="route-title"><span>${escape(r.label)}</span>${badge(r.status)}</div><div class="goal-list">${r.requirements
          .map((gid) => {
            const g = goals.find((x) => x.id === gid);
            return `<div class="goal-row"><code>${escape(g.statement)}</code><div class="goal-status">${badge(g.status)}<span>Shared subgoal</span></div></div>`;
          })
          .join('')}</div></div>`,
    )
    .join('');
  const workers = ['Atlas', 'Iris', 'Themis']
    .map((name, i) => {
      const task =
        tasks.find((t) => t.worker === name && t.status === 'leased') ||
        tasks.filter((t) => t.worker === name).at(-1);
      return `<div class="worker"><div class="worker-icon">${['A', 'I', 'T'][i]}</div><strong>${name}</strong><small>${task ? escape(label(task.kind)) : 'Research agent'}</small>${task ? badge(task.status) : badge('queued')}<p>${task?.checkpoint ? escape(task.checkpoint.slice(0, 110)) : 'Ready to explore, prove, or build on another agent’s result.'}</p></div>`;
    })
    .join('');
  const records = artifacts
    .slice()
    .reverse()
    .map(
      (a) =>
        `<article class="record"><div class="record-head"><strong>${escape(label(a.kind))}</strong>${badge(a.status)}</div><p>${escape(a.summary)}</p><details><summary>Inspect statement and evidence${a.dependencies.length ? ` · ${a.dependencies.length} shared dependencies` : ''}</summary><pre>${escape(a.statement)}\n\n${escape(JSON.stringify(a.proof, null, 2))}\n\n${escape(a.verification.diagnostics)}</pre></details></article>`,
    )
    .join('');
  $('#content').innerHTML =
    `<div class="project-heading"><div><h2>${escape(p.title)}</h2><p>${escape(p.description)}</p></div><div class="project-actions">${badge(p.status)}${['draft', 'paused'].includes(p.status) ? '<button class="button small" data-action="start">Start research</button>' : ''}${p.status === 'running' ? '<button class="button small" data-action="pause">Pause</button>' : ''}</div></div>
    ${demo ? '<div class="notice">SIMULATION · Scripted agents and illustrative funding. These results have not been checked by Lean and are not eligible for payouts.</div>' : ''}
    <div class="stats"><div class="stat"><div class="stat-label">RESEARCH PATHS <span>↗</span></div><div class="stat-value">${String(routes.length).padStart(2, '0')}</div><div class="stat-foot">${goals.filter((g) => g.id !== p.root_id).length} shared subgoals</div></div><div class="stat"><div class="stat-label">${demo ? 'SIMULATED ARTIFACTS' : 'VERIFIED ARTIFACTS'} <span>◇</span></div><div class="stat-value">${String(accepted.length).padStart(2, '0')}</div><div class="stat-foot">Evidence stays with every result</div></div><div class="stat"><div class="stat-label">${demo ? 'ILLUSTRATIVE USAGE' : 'RESEARCH SPEND'} <span>◌</span></div><div class="stat-value">${money(spent)}</div><div class="stat-foot">${money(reserved)} reserved for active calls</div></div><div class="stat"><div class="stat-label">CONTRIBUTORS <span>◎</span></div><div class="stat-value">${String(funding.length).padStart(2, '0')}</div><div class="stat-foot">${money(budget)} ${demo ? 'illustrative' : 'committed'} capacity</div></div></div>
    <div class="research-layout"><div><section class="panel"><div class="panel-header"><h3>The proof landscape</h3><small>One target · multiple approaches</small></div><div class="target"><small>ORIGINAL TARGET</small><code>${escape(root.statement)}</code></div><div class="routes">${routeCards || '<p class="subtle">Independent exploration is the first step. New proof routes will appear here as their conditional bridges are checked.</p>'}</div></section><section class="panel"><div class="panel-header"><h3>At the research desk</h3><small>3 shared worker slots</small></div><div class="panel-body worker-grid">${workers}</div></section><section class="panel"><div class="panel-header"><h3>The shared notebook</h3><small>${artifacts.length} research artifacts</small></div>${records || '<div class="panel-body subtle">Findings, proof candidates, and verifier feedback will be preserved here.</div>'}</section></div><div><section class="panel"><div class="panel-header"><h3>Research capacity</h3><small>${demo ? 'SIMULATED' : 'OPENROUTER'}</small></div><div class="panel-body">${funding.map((f) => `<div class="contributor"><div class="contributor-row"><strong>${escape(f.name)}</strong><span>${money(f.spent_micros)}</span></div><small>${escape(f.model)} · ${money(f.budget_micros)} budget</small><progress aria-label="${escape(f.name)} budget used" value="${f.spent_micros + f.reserved_micros}" max="${f.budget_micros}"></progress></div>`).join('') || '<p class="subtle">Add a model budget to give the agents research capacity.</p>'}${!['solved', 'demo_completed', 'stopped'].includes(p.status) ? '<button class="button full-width" data-action="contribute">+ Contribute resources</button>' : ''}</div></section><section class="panel"><div class="panel-header"><h3>Research journal</h3><small>LIVE RECORD</small></div><div class="timeline">${events.map((e) => `<div class="event"><span class="event-time">${escape(new Date(e.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }))}</span><p>${escape(e.message)}</p></div>`).join('')}</div></section><section class="panel integrity"><h3>Evidence, carried forward.</h3><p>${demo ? 'In live mode, only results that pass Lean and a separate kernel replay become trusted proof artifacts.' : 'Shared proofs are checked against the fixed target and library version before another agent can build on them.'} Payment transfers are not enabled in this research preview.</p></section></div></div>`;
}
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const list = await api('/api/problems');
    $('#version').textContent = `v${list.version} · Research preview`;
    $('#project-count').textContent = list.problems.length;
    if (!list.problems.some((p) => p.id === selected)) selected = list.problems[0]?.id || '';
    $('#projects').innerHTML = list.problems
      .map(
        (p) =>
          `<button class="project-item ${p.id === selected ? 'active' : ''}" data-project="${p.id}">${escape(p.title)}<small>${escape(label(p.status))}</small></button>`,
      )
      .join('');
    if (selected) {
      const data = await api('/api/problems/' + selected);
      const fingerprint = JSON.stringify(data);
      if (fingerprint !== lastRender) {
        lastRender = fingerprint;
        render(data);
      }
    } else {
      $('#content').innerHTML = empty();
    }
    $('#connection').textContent = 'Connected locally';
  } catch (error) {
    $('#connection').textContent = 'Connection interrupted';
    notice(error.message, true);
  } finally {
    refreshing = false;
  }
}
$('#projects').addEventListener('click', (event) => {
  const button = event.target.closest('[data-project]');
  if (button) {
    selected = button.dataset.project;
    location.hash = selected;
    lastRender = '';
    refresh();
  }
});
$('#run-demo').addEventListener('click', () =>
  controlled(async () => {
    const data = await api('/api/demo', {});
    selected = data.id;
    location.hash = selected;
    lastRender = '';
    $('#notice').hidden = true;
    await refresh();
  }),
);
$('#new-project').addEventListener('click', () =>
  controlled(async () => $('#project-dialog').showModal()),
);
$('#access').addEventListener('click', () => $('#access-dialog').showModal());
$('#access-mobile').addEventListener('click', () => $('#access-dialog').showModal());
$('#access-dialog').addEventListener('close', () => {
  pendingAction = null;
});
$('#overview').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
document
  .querySelectorAll('[data-close]')
  .forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
$('#access-form').addEventListener('submit', (event) => {
  event.preventDefault();
  token = $('#control-token').value.trim();
  sessionStorage.setItem('panoptes-token', token);
  $('#control-token').value = '';
  $('#access-dialog').close();
  updateAccess();
  const action = pendingAction;
  pendingAction = null;
  if (action) controlled(action);
});
$('#content').addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  controlled(async () => {
    if (action === 'contribute') {
      const demo = current.problem.mode === 'demo';
      $('#key-label').hidden = demo;
      $('#funding-help').textContent = demo
        ? 'This adds illustrative capacity to the simulation. No key is needed and no money is spent.'
        : 'Your key is encrypted locally and used only for this project. Set a matching spending limit on the provider’s key.';
      $('#funding-form').elements.model.value = demo ? 'simulation' : '';
      $('#funding-dialog').showModal();
    } else {
      await api(`/api/problems/${selected}/${action}`, {});
      $('#notice').hidden = true;
      await refresh();
    }
  });
});
$('#project-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget,
    button = form.querySelector('button.primary');
  button.disabled = true;
  try {
    const input = Object.fromEntries(new FormData(form));
    const data = await api('/api/problems', { ...input, mode: 'live' });
    selected = data.id;
    location.hash = selected;
    form.reset();
    $('#project-dialog').close();
    await refresh();
  } catch (error) {
    notice(error.message, true);
    $('#project-dialog').close();
  } finally {
    button.disabled = false;
  }
});
$('#funding-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget,
    button = form.querySelector('button.primary');
  button.disabled = true;
  try {
    const input = Object.fromEntries(new FormData(form));
    await api(`/api/problems/${selected}/funding`, {
      name: input.name,
      model: input.model,
      apiKey: input.apiKey,
      budgetMicros: Math.round(Number(input.budget) * 1e6),
    });
    form.reset();
    $('#funding-dialog').close();
    $('#notice').hidden = true;
    await refresh();
  } catch (error) {
    notice(error.message, true);
    $('#funding-dialog').close();
  } finally {
    form.elements.apiKey.value = '';
    button.disabled = false;
  }
});
window.addEventListener('hashchange', () => {
  selected = location.hash.slice(1);
  lastRender = '';
  refresh();
});
updateAccess();
refresh();
setInterval(refresh, 1500);
