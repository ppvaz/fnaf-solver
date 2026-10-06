const games = ['FNAF1', 'FNAF2', 'FNAF3', 'FNAF4'];
const suggestions = {
  FNAF1: ['doorL close', 'doorL open', 'wait 1s'],
  FNAF2: ['wind 1s', 'cam10', 'mask 1s', 'wait 1s'],
  FNAF3: ['cam10', 'wait 1s'], FNAF4: ['bed', 'wait 1s'],
};
const byId = id => document.getElementById(id);
const tiles = new Map();
let selected = 'FNAF2', status = null, pending = 0, polling = false;
let latestEvents = [], frameSequence = 0;

for (const game of games) {
  const tile = document.createElement('article');
  tile.className = 'tile'; tile.dataset.game = game;
  tile.innerHTML = `<header class="tile-header"><h2><button data-select="${game}" aria-pressed="false" aria-label="Select ${game}">${game}</button></h2><span class="tile-hour">— AM</span></header>
    <div class="screen"><div class="no-signal"></div><img alt="${game} runtime frame" hidden><span class="screen-corner">NO SIGNAL</span>
      <div class="overlay"><strong class="overlay-title">--- OFFLINE ---</strong><span class="overlay-subtitle">Awaiting runtime</span></div></div>
    <div class="tile-footer"><span class="tile-status">OFFLINE</span><div class="tile-buttons"><button data-action="pause" disabled>Pause</button><button data-action="resume" disabled>Resume</button></div></div>
    <div class="tile-last">No command applied</div>`;
  tile.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => send(`${game} ${button.dataset.action}`)));
  byId('games').append(tile); tiles.set(game, tile);
}

function select(game) {
  selected = game;
  byId('command').value = game + ' ' + suggestions[game][0];
  document.querySelectorAll('[data-select]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.select === game)));
  for (const [name, tile] of tiles) tile.classList.toggle('selected', name === game);
  drawQuickActions();
}

function drawQuickActions() {
  byId('quick-label').textContent = selected;
  const tile = status?.tiles.find(tile => tile.game === selected);
  const container = byId('quick-actions'); container.replaceChildren();
  for (const action of suggestions[selected]) {
    const button = document.createElement('button'); button.textContent = action;
    button.disabled = !tile || tile.phase !== 'AWAITING_INPUT' || pending || !tile.commands.includes(action.split(' ')[0].toLowerCase());
    button.addEventListener('click', () => send(selected + ' ' + action)); container.append(button);
  }
}

function render(next) {
  status = next;
  const online = next.tiles.filter(tile => !['OFFLINE', 'FAULT'].includes(tile.phase)).length;
  byId('active-count').textContent = `${online} / 4`;
  byId('connection').textContent = 'Local';
  document.querySelectorAll('[data-select]').forEach(button => { button.disabled = false; });
  byId('command').disabled = !online;
  document.querySelector('.send').disabled = !online;
  byId('pause-all').disabled = !online;
  byId('resume-all').disabled = !online;
  for (const info of next.tiles) renderTile(info);
  latestEvents = next.events;
  renderEvents(); drawQuickActions();
}

function renderTile(info) {
  const tile = tiles.get(info.game), observation = info.observation;
  const terminal = observation?.terminal;
  tile.querySelector('.tile-hour').textContent = observation?.hour ?? '— AM';
  const state = tile.querySelector('.tile-status');
  state.textContent = info.phase.replaceAll('_', ' '); state.dataset.phase = info.phase;
  const label = tile.querySelector('.screen-corner');
  label.textContent = info.label === 'UNKNOWN' ? 'NO SIGNAL' : info.label;
  label.classList.toggle('label-fixture', info.label === 'FIXTURE');
  const overlay = tile.querySelector('.overlay');
  const title = tile.querySelector('.overlay-title'), subtitle = tile.querySelector('.overlay-subtitle');
  overlay.hidden = info.phase === 'EXECUTING';
  title.textContent = terminal ? `--- ${terminal} ---` : info.phase === 'OFFLINE' ? '--- OFFLINE ---'
    : info.phase === 'FAULT' ? '--- CONNECTION LOST ---' : info.phase === 'PAUSING' ? '--- PAUSE REQUESTED ---' : '--- PAUSED ---';
  subtitle.textContent = terminal ? 'Attempt complete' : info.phase === 'OFFLINE' ? 'Awaiting runtime'
    : info.phase === 'FAULT' ? 'Awaiting operator' : info.phase === 'PAUSING' ? 'Awaiting acknowledgment'
      : info.manual || info.global ? 'Awaiting resume' : 'Awaiting input';
  tile.querySelector('.tile-last').textContent = info.fault ?? info.lastAction ?? 'No command applied';
  tile.querySelector('.tile-last').title = info.fault ?? info.lastAction ?? '';
  for (const button of tile.querySelectorAll('[data-action]'))
    button.disabled = ['OFFLINE', 'FAULT', 'TERMINAL', 'PAUSING'].includes(info.phase);
  if (observation?.imageRevision !== null && observation?.imageRevision !== undefined)
    updateFrame(tile, info.game, observation.imageRevision);
}

function updateFrame(tile, game, revision) {
  const image = tile.querySelector('img');
  if (image.dataset.revision === String(revision) || image.dataset.pending === String(revision)) return;
  image.dataset.pending = String(revision);
  const probe = new Image();
  probe.onload = () => {
    if (Number(image.dataset.revision ?? -1) > revision) return;
    image.src = probe.src; image.dataset.revision = String(revision); image.hidden = false;
    delete image.dataset.pending;
    tile.querySelector('.no-signal').hidden = true;
  };
  probe.onerror = () => { delete image.dataset.pending; byId('feedback').textContent = `${game}: runtime image unavailable.`; };
  probe.src = `/api/frame/${game}?revision=${revision}&request=${++frameSequence}`;
}

function renderEvents() {
  if (!latestEvents.length) return;
  byId('event-count').textContent = String(latestEvents.at(-1).sequence).padStart(2, '0');
  const ledger = byId('ledger'); ledger.replaceChildren();
  for (const event of latestEvents.slice(-12).reverse()) {
    const li = document.createElement('li'), game = document.createElement('span');
    game.className = 'event-game'; game.textContent = event.game;
    li.append(game, `${event.kind.toUpperCase()} · ${event.detail}`); ledger.append(li);
  }
}

async function send(text) {
  if (!status) return;
  const prefix = text.trim().split(/\s+/)[0].toUpperCase();
  const round = prefix === 'ALL' ? status.globalRound : status.tiles.find(tile => tile.game === prefix)?.round;
  if (!/@\d+\s*$/.test(text)) text += ` @${round ?? 0}`;
  pending++; drawQuickActions();
  const feedback = byId('feedback'); feedback.classList.remove('error'); feedback.textContent = 'Sending…';
  try {
    const response = await fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(20_000) });
    const result = await response.json();
    if (result.status) render(result.status);
    if (!response.ok) throw new Error(result.error ?? 'Command refused');
    feedback.textContent = text + ' · applied';
  } catch (error) { feedback.textContent = error.message; feedback.classList.add('error'); }
  finally { pending--; if (status) render(status); }
}

async function poll() {
  if (polling) return;
  polling = true;
  try {
    const response = await fetch('/api/status', { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error('Session unavailable');
    render(await response.json());
  } catch {
    byId('connection').textContent = 'Disconnected';
    document.querySelectorAll('button').forEach(button => { button.disabled = true; });
    byId('command').disabled = true;
    for (const tile of tiles.values()) {
      tile.querySelector('.overlay').hidden = false;
      tile.querySelector('.overlay-title').textContent = '--- OFFLINE ---';
      tile.querySelector('.overlay-subtitle').textContent = 'Awaiting connection';
    }
    status = null;
  } finally { polling = false; }
}
byId('command-form').addEventListener('submit', event => { event.preventDefault(); void send(byId('command').value); });
document.querySelectorAll('[data-select]').forEach(button => button.addEventListener('click', () => select(button.dataset.select)));
byId('pause-all').addEventListener('click', () => send('ALL pause'));
byId('resume-all').addEventListener('click', () => send('ALL resume'));
select(selected); void poll(); setInterval(poll, 500);
