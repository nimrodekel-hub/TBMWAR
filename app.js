'use strict';

// ── CONSTANTS ──────────────────────────────────────────────────────────────

const INTERCEPTOR_DEFS = {
  pac3:    { name:'PAC-3',       range:40,   altMin:15,  altMax:40,   speed:1.5, cost:1,  hitProb:0.85, color:'#5fc8e8' },
  arrow2:  { name:'Arrow-2',     range:90,   altMin:10,  altMax:50,   speed:2.5, cost:3,  hitProb:0.80, color:'#38bdf8' },
  thaad:   { name:'THAAD',       range:200,  altMin:40,  altMax:150,  speed:3.0, cost:6,  hitProb:0.90, color:'#818cf8' },
  sm3:     { name:'SM-3',        range:700,  altMin:150, altMax:500,  speed:4.5, cost:10, hitProb:0.88, color:'#a78bfa' },
  arrow3:  { name:'Arrow-3',     range:2400, altMin:100, altMax:1000, speed:5.0, cost:15, hitProb:0.92, color:'#c084fc' },
};

const RADAR_DEFS = {
  'patriot-radar': { name:'Patriot Radar', range:150,  cost:2, color:'#22d3ee' },
  'green-pine':    { name:'Green Pine',    range:500,  cost:5, color:'#4ade80' },
  'xband':         { name:'X-Band TPY-2', range:900,  cost:8, color:'#86efac' },
};

const THREAT_DEFS = {
  'scud-b':  { name:'SCUD-B',   rangekm:300,  speed:1.5, cost:1,  color:'#ef4444' },
  'scud-c':  { name:'SCUD-C',   rangekm:500,  speed:1.8, cost:2,  color:'#f97316' },
  'shahab3': { name:'Shahab-3', rangekm:1300, speed:2.5, cost:4,  color:'#fb923c' },
  'ghadr1':  { name:'Ghadr-1',  rangekm:1800, speed:3.0, cost:6,  color:'#fbbf24' },
  'icbm':    { name:'ICBM',     rangekm:5000, speed:7.0, cost:15, color:'#f43f5e' },
};

const DIFFICULTY = {
  easy:    { label:'קל',          budget:50, attackBudget:30, threatCount:3,  noIntel:false, speedMult:0.7 },
  medium:  { label:'בינוני',      budget:40, attackBudget:25, threatCount:6,  noIntel:false, speedMult:1.0 },
  hard:    { label:'קשה',         budget:30, attackBudget:20, threatCount:10, noIntel:false, speedMult:1.3 },
  extreme: { label:'קשה-במיוחד', budget:25, attackBudget:15, threatCount:15, noIntel:true,  speedMult:1.6 },
};

const TARGETS = [
  { id:'base',     name:'בסיס צבאי',      value:30, icon:'🪖', relX:0.72, relY:0.45 },
  { id:'city',     name:'עיר גדולה',       value:25, icon:'🏙', relX:0.60, relY:0.60 },
  { id:'power',    name:'תחנת כוח',       value:20, icon:'⚡', relX:0.50, relY:0.38 },
  { id:'airport',  name:'נמל תעופה',      value:15, icon:'✈', relX:0.65, relY:0.72 },
  { id:'industry', name:'מתקן תעשייתי',   value:10, icon:'🏭', relX:0.42, relY:0.65 },
  { id:'port',     name:'נמל ים',         value:12, icon:'⚓', relX:0.55, relY:0.82 },
];

const LAUNCH_SITES = [
  { relX:0.05, relY:0.20 },
  { relX:0.08, relY:0.55 },
  { relX:0.12, relY:0.80 },
  { relX:0.02, relY:0.70 },
];

const SIM_DURATION_MS = 30000;
const COLORS = { bg:'#080d18', bg2:'#0d1526', bg3:'#111d35', blue:'#5fc8e8', red:'#ef4444',
                 green:'#22c55e', orange:'#f97316', white:'#e8f0fe', muted:'#4a5a7a', border:'#1e3050' };

// ── STATE ──────────────────────────────────────────────────────────────────

let state = {
  scenario: 'defense',
  difficulty: 'medium',
  phase: 'idle',          // idle | deploy | simulate | replay
  budget: 40,
  budgetMax: 40,
  selectedUnitType: null,
  selectedUnitId: null,
  placedUnits: [],        // { id, type, defId, x, y, kmX, kmY }
  placedThreats: [],      // attack mode threat queue
  threats: [],            // active missiles in sim
  interceptors: [],       // deployed interceptors (sim)
  particles: [],
  labels: [],
  simTime: 0,
  simSpeed: 1,
  simPlaying: false,
  simFrameId: null,
  simLastTs: 0,
  simHistory: [],         // snapshots for scrubber
  scrubPos: 0,
  showRanges: true,
  counts: {               // unit counts in sidebar
    pac3:0, arrow2:0, thaad:0, sm3:0, arrow3:0,
    'patriot-radar':0, 'green-pine':0, xband:0,
    'scud-b':0, 'scud-c':0, shahab3:0, ghadr1:0, icbm:0,
  },
  stats: { intercepts:0, hits:0, score:0 },
  targetStatus: {},       // id -> 'safe'|'hit'
  mapScaleKm: 2000,       // km across map width
  ngScenario: 'defense',
  ngDifficulty: 'medium',
};

// ── INIT ───────────────────────────────────────────────────────────────────

const canvas = document.getElementById('main-canvas');
const ctx = canvas.getContext('2d');

function init() {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  bindUI();
  resetToIdle();
  requestAnimationFrame(renderLoop);
}

function resizeCanvas() {
  const area = document.getElementById('canvas-area');
  canvas.width  = area.clientWidth;
  canvas.height = area.clientHeight;
}

// ── UI BINDINGS ────────────────────────────────────────────────────────────

function bindUI() {
  document.getElementById('btn-new-game').addEventListener('click', () => openModal('modal-new-game'));
  document.getElementById('btn-instructions').addEventListener('click', () => openModal('modal-instructions'));
  document.getElementById('btn-start-sim').addEventListener('click', startSimulation);
  document.getElementById('btn-reset-deploy').addEventListener('click', resetDeploy);

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });

  document.querySelectorAll('.modal-overlay').forEach(ov => {
    ov.addEventListener('click', e => { if (e.target === ov) closeModal(ov.id); });
  });

  document.querySelectorAll('#sidebar .diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#sidebar .diff-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.difficulty = btn.dataset.diff;
      applyDifficulty();
    });
  });

  document.querySelectorAll('#scenario-select .scenario-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('#scenario-select .scenario-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      state.scenario = card.dataset.scenario;
      applyScenario();
    });
  });

  document.querySelectorAll('.count-btn').forEach(btn => {
    btn.addEventListener('click', () => adjustCount(btn.dataset.id, btn.dataset.action));
  });

  document.getElementById('toggle-ranges').addEventListener('change', e => {
    state.showRanges = e.target.checked;
  });

  canvas.addEventListener('click', onCanvasClick);
  canvas.addEventListener('mousemove', onCanvasMouseMove);
  canvas.addEventListener('mouseleave', () => hideTooltip());

  document.getElementById('ng-confirm').addEventListener('click', confirmNewGame);
  document.querySelectorAll('#modal-new-game .scenario-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('#modal-new-game .scenario-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      state.ngScenario = card.dataset.scenario;
    });
  });
  document.querySelectorAll('#ng-difficulty .diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#ng-difficulty .diff-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.ngDifficulty = btn.dataset.diff;
    });
  });

  document.getElementById('res-replay-btn').addEventListener('click', () => {
    closeModal('modal-results');
    startReplay();
  });
  document.getElementById('res-new-game-btn').addEventListener('click', () => {
    closeModal('modal-results');
    openModal('modal-new-game');
  });

  // Scrubber
  const track = document.getElementById('scrub-track');
  track.addEventListener('click', e => {
    const rect = track.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    scrubTo(pct);
  });
  document.getElementById('scrub-play').addEventListener('click', toggleScrubPlay);
  document.getElementById('scrub-rewind').addEventListener('click', () => scrubTo(0));
  document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.simSpeed = parseFloat(btn.dataset.speed);
    });
  });

  document.addEventListener('keydown', e => {
    if (e.key === ' ' && !e.target.matches('input,button,textarea')) {
      e.preventDefault();
      if (state.phase === 'simulate') toggleSimPlay();
      else if (state.phase === 'replay') toggleScrubPlay();
    }
    if (e.key === 'n' || e.key === 'N') openModal('modal-new-game');
    if (e.key === 'r' || e.key === 'R') { if (state.phase === 'replay' || state.phase === 'idle') startReplay(); }
    if (e.key === 'Escape') { state.selectedUnitId = null; state.selectedUnitType = null; }
  });
}

// ── MODAL HELPERS ──────────────────────────────────────────────────────────

function openModal(id)  { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

// ── SCENARIO / DIFFICULTY ──────────────────────────────────────────────────

function applyScenario() {
  const isDefense = state.scenario === 'defense';
  document.getElementById('panel-blue').style.display = isDefense ? '' : 'none';
  document.getElementById('panel-red').style.display  = isDefense ? 'none' : '';
  setCanvasHint(isDefense
    ? 'לחץ על המפה להנחת יחידה. בחר מיירט או מכ"ם בצד שמאל.'
    : 'בחר טיל, לחץ להנחת נקודת שיגור, ואז לחץ על יעד (אייקון) לכיוון.');
}

function applyDifficulty() {
  const diff = DIFFICULTY[state.difficulty];
  const budget = state.scenario === 'defense' ? diff.budget : diff.attackBudget;
  state.budget = budget;
  state.budgetMax = budget;
  updateBudgetUI();
}

function setCanvasHint(msg) {
  const el = document.getElementById('canvas-hint');
  el.textContent = msg;
  el.style.display = '';
}

// ── COUNT CONTROLS ──────────────────────────────────────────────────────────

function adjustCount(id, action) {
  if (state.phase !== 'idle' && state.phase !== 'deploy') return;
  const def = INTERCEPTOR_DEFS[id] || RADAR_DEFS[id] || THREAT_DEFS[id];
  if (!def) return;
  const cost = def.cost;
  if (action === 'inc') {
    if (state.budget < cost) { showToast('אין מספיק תקציב', 'warn'); return; }
    state.counts[id]++;
    state.budget -= cost;
  } else {
    if (state.counts[id] <= 0) return;
    state.counts[id]--;
    state.budget += cost;
  }
  document.getElementById('cnt-' + id).textContent = state.counts[id];
  updateBudgetUI();
}

function updateBudgetUI() {
  const val = document.getElementById('budget-val');
  const bar = document.getElementById('budget-bar');
  val.textContent = state.budget;
  const pct = Math.max(0, state.budget / state.budgetMax * 100);
  bar.style.width = pct + '%';
  val.className = 'budget-value' + (pct < 20 ? ' danger' : pct < 40 ? ' warn' : '');
  bar.style.background = pct < 20 ? COLORS.red : pct < 40 ? COLORS.orange : COLORS.green;
  document.getElementById('stat-budget').textContent = state.budget;
}

// ── CANVAS INTERACTION ──────────────────────────────────────────────────────

function onCanvasClick(e) {
  if (state.phase === 'simulate') return;
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top)  * (canvas.height / rect.height);

  if (state.phase === 'replay') return;

  if (state.scenario === 'defense') handleDefenseClick(x, y);
  else handleAttackClick(x, y);
}

function handleDefenseClick(x, y) {
  const unitId = getSelectedUnit();
  if (!unitId) {
    const hit = findUnitAtPos(x, y);
    if (hit) removeUnit(hit);
    return;
  }
  const def = INTERCEPTOR_DEFS[unitId] || RADAR_DEFS[unitId];
  const cost = def.cost;
  if (state.budget < cost && !unitAlreadyPaid(unitId)) {
    showToast('אין מספיק תקציב', 'warn'); return;
  }
  placeUnit(unitId, x, y);
}

let attackPhase = 'launcher'; // 'launcher' | 'target'
let pendingAttackUnit = null;
let pendingLaunchPos = null;

function handleAttackClick(x, y) {
  if (attackPhase === 'launcher') {
    const unitId = getSelectedAttackUnit();
    if (!unitId) return;
    pendingLaunchPos = { x, y };
    attackPhase = 'target';
    setCanvasHint('עכשיו לחץ על יעד (אייקון) כדי לכוון את הטיל');
    showToast('בחר יעד', 'info');
  } else {
    const target = findTargetAtPos(x, y);
    if (!target) {
      showToast('לחץ ישירות על אייקון יעד', 'warn');
      return;
    }
    const unitId = getSelectedAttackUnit();
    const def = THREAT_DEFS[unitId];
    if (state.budget < def.cost) { showToast('אין מספיק תקציב', 'warn'); attackPhase = 'launcher'; return; }
    state.budget -= def.cost;
    state.counts[unitId] = Math.max(0, state.counts[unitId] - 1);
    document.getElementById('cnt-' + unitId).textContent = state.counts[unitId];
    updateBudgetUI();
    const tx = target.relX * canvas.width;
    const ty = target.relY * canvas.height;
    state.placedThreats.push({ defId: unitId, lx: pendingLaunchPos.x, ly: pendingLaunchPos.y, tx, ty, targetId: target.id });
    attackPhase = 'launcher';
    pendingLaunchPos = null;
    setCanvasHint('טיל נוסף לתכנית. בחר עוד טיל או לחץ "הפעל סימולציה".');
    showToast('טיל נוסף לתכנית', 'success');
  }
}

function getSelectedUnit() {
  const cards = document.querySelectorAll('#panel-blue .unit-card.selected');
  if (!cards.length) return null;
  return cards[0].dataset.id;
}

function getSelectedAttackUnit() {
  const cards = document.querySelectorAll('#panel-red .unit-card.selected');
  if (!cards.length) return null;
  return cards[0].dataset.id;
}

document.querySelectorAll && document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.unit-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('count-btn')) return;
      const panel = card.closest('#panel-blue, #panel-red');
      if (!panel) return;
      panel.querySelectorAll('.unit-card').forEach(c => c.classList.remove('selected'));
      card.classList.toggle('selected');
    });
  });
});

function placeUnit(id, x, y) {
  const type = INTERCEPTOR_DEFS[id] ? 'interceptor' : 'radar';
  const def = INTERCEPTOR_DEFS[id] || RADAR_DEFS[id];
  state.placedUnits.push({ id: Date.now() + Math.random(), defId: id, type, x, y });
  if (state.phase === 'idle') state.phase = 'deploy';
  updatePhaseBadge();
}

function removeUnit(unit) {
  state.placedUnits = state.placedUnits.filter(u => u.id !== unit.id);
  const def = INTERCEPTOR_DEFS[unit.defId] || RADAR_DEFS[unit.defId];
  state.budget += def.cost;
  updateBudgetUI();
}

function findUnitAtPos(x, y) {
  return state.placedUnits.find(u => Math.hypot(u.x - x, u.y - y) < 14);
}

function findTargetAtPos(x, y) {
  return TARGETS.find(t => {
    const tx = t.relX * canvas.width, ty = t.relY * canvas.height;
    return Math.hypot(tx - x, ty - y) < 22;
  });
}

function unitAlreadyPaid(id) { return false; }

// ── DEPLOY / RESET ──────────────────────────────────────────────────────────

function resetDeploy() {
  state.placedUnits = [];
  state.placedThreats = [];
  attackPhase = 'launcher';
  pendingLaunchPos = null;
  const diff = DIFFICULTY[state.difficulty];
  const budget = state.scenario === 'defense' ? diff.budget : diff.attackBudget;
  state.budget = budget;
  state.budgetMax = budget;
  Object.keys(state.counts).forEach(k => state.counts[k] = 0);
  document.querySelectorAll('.unit-count').forEach(el => el.textContent = '0');
  updateBudgetUI();
  state.phase = 'idle';
  updatePhaseBadge();
  setCanvasHint(state.scenario === 'defense'
    ? 'לחץ על המפה להנחת יחידה. בחר מיירט או מכ"ם בצד שמאל.'
    : 'בחר טיל, לחץ להנחת נקודת שיגור, ואז לחץ על יעד לכיוון.');
}

function resetToIdle() {
  state.phase = 'idle';
  state.scenario = 'defense';
  state.difficulty = 'medium';
  state.budget = 40;
  state.budgetMax = 40;
  state.placedUnits = [];
  state.placedThreats = [];
  state.threats = [];
  state.interceptors = [];
  state.particles = [];
  state.labels = [];
  state.simHistory = [];
  state.stats = { intercepts:0, hits:0, score:0 };
  state.targetStatus = {};
  TARGETS.forEach(t => state.targetStatus[t.id] = 'safe');
  updateBudgetUI();
  updatePhaseBadge();
  updateHUD();
  document.getElementById('scrubber').classList.add('hidden');
  applyScenario();
  setCanvasHint('בחר תרחיש ורמת קושי, ואז פרוס כוחות על המפה');
}

// ── NEW GAME ────────────────────────────────────────────────────────────────

function confirmNewGame() {
  state.scenario   = state.ngScenario;
  state.difficulty = state.ngDifficulty;
  closeModal('modal-new-game');
  // Sync sidebar selectors
  document.querySelectorAll('#scenario-select .scenario-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.scenario === state.scenario);
  });
  document.querySelectorAll('#sidebar .diff-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.diff === state.difficulty);
  });
  resetDeploy();
  applyScenario();
  applyDifficulty();
  showToast('משחק חדש — ' + DIFFICULTY[state.difficulty].label, 'info');
}

// ── SIMULATION SETUP ────────────────────────────────────────────────────────

function startSimulation() {
  if (state.phase === 'simulate') return;
  const diff = DIFFICULTY[state.difficulty];

  state.threats = [];
  state.interceptors = [];
  state.particles = [];
  state.labels = [];
  state.simHistory = [];
  state.stats = { intercepts:0, hits:0, score:0 };
  TARGETS.forEach(t => state.targetStatus[t.id] = 'safe');

  if (state.scenario === 'defense') buildDefenseSimulation(diff);
  else buildAttackSimulation(diff);

  state.simTime = 0;
  state.simPlaying = true;
  state.phase = 'simulate';
  updatePhaseBadge();
  document.getElementById('canvas-hint').style.display = 'none';
  document.getElementById('scrubber').classList.remove('hidden');
  document.getElementById('scrubber').classList.remove('hidden');
  updateHUD();
}

function buildDefenseSimulation(diff) {
  // Build interceptors from placed units
  state.interceptors = state.placedUnits
    .filter(u => u.type === 'interceptor')
    .map(u => {
      const def = INTERCEPTOR_DEFS[u.defId];
      return { id:u.id, defId:u.defId, def, x:u.x, y:u.y, active:true, fired:false, flyingMissiles:[] };
    });

  // Generate enemy threats based on difficulty
  const count = diff.threatCount;
  const threatPool = ['scud-b','scud-c','scud-c','shahab3','ghadr1'];
  const speedMult = diff.speedMult;

  for (let i = 0; i < count; i++) {
    const defId = threatPool[Math.min(i, threatPool.length-1)];
    const def = THREAT_DEFS[defId];
    const launch = LAUNCH_SITES[i % LAUNCH_SITES.length];
    const target = TARGETS[i % TARGETS.length];
    const lx = launch.relX * canvas.width + (Math.random()-0.5)*30;
    const ly = launch.relY * canvas.height + (Math.random()-0.5)*30;
    const tx = target.relX * canvas.width;
    const ty = target.relY * canvas.height;
    const delay = i * (SIM_DURATION_MS / count) * 0.6;
    addThreat(defId, def, lx, ly, tx, ty, target.id, delay, speedMult);
  }
}

function buildAttackSimulation(diff) {
  const speedMult = diff.speedMult;
  const noIntel = diff.noIntel;

  // Player's threats
  state.placedThreats.forEach((pt, i) => {
    const def = THREAT_DEFS[pt.defId];
    addThreat(pt.defId, def, pt.lx, pt.ly, pt.tx, pt.ty, pt.targetId, i * 1200, speedMult);
  });

  // AI interceptors
  const aiInterceptorDefs = ['pac3','arrow2','thaad'];
  const aiCount = { easy:4, medium:6, hard:8, extreme:12 }[state.difficulty];
  state.interceptors = [];
  for (let i = 0; i < aiCount; i++) {
    const defId = aiInterceptorDefs[i % aiInterceptorDefs.length];
    const def = INTERCEPTOR_DEFS[defId];
    const target = TARGETS[i % TARGETS.length];
    const spread = 80;
    const x = target.relX * canvas.width + (Math.random()-0.5)*spread;
    const y = target.relY * canvas.height + (Math.random()-0.5)*spread;
    state.interceptors.push({ id:'ai-'+i, defId, def, x, y, active:true, fired:false, flyingMissiles:[], hidden:noIntel });
  }
}

function addThreat(defId, def, lx, ly, tx, ty, targetId, delay, speedMult) {
  const dist = Math.hypot(tx-lx, ty-ly);
  const hmax = def.rangekm * 0.18;
  const duration = (SIM_DURATION_MS * 0.6) / (speedMult || 1);
  state.threats.push({
    id: Date.now() + Math.random(),
    defId, def,
    lx, ly, tx, ty, targetId,
    delay,
    duration,
    t: 0, elapsed: -delay,
    hmax,
    active: true,
    intercepted: false,
    hit: false,
    trail: [],
    interceptorFired: false,
    interceptedBy: null,
    interceptTime: null,
    interceptPos: null,
  });
}

// ── SIMULATION LOOP ─────────────────────────────────────────────────────────

function renderLoop(ts) {
  requestAnimationFrame(renderLoop);

  const dt = state.simPlaying && state.phase === 'simulate'
    ? Math.min(ts - (state.simLastTs || ts), 100) * state.simSpeed
    : 0;
  state.simLastTs = ts;

  if (state.phase === 'simulate' && state.simPlaying) {
    state.simTime += dt;
    updateSimulation(dt);

    if (state.simHistory.length === 0 || state.simTime - state.simHistory[state.simHistory.length-1].t > 500) {
      state.simHistory.push(snapshotState());
    }

    const allDone = state.threats.every(t => !t.active);
    if (allDone || state.simTime > SIM_DURATION_MS * 1.2) {
      endSimulation();
    }
  }

  drawFrame();
}

function updateSimulation(dt) {
  const allInterceptors = state.interceptors;

  state.threats.forEach(threat => {
    if (!threat.active) return;
    threat.elapsed += dt;
    if (threat.elapsed < 0) return;

    const progress = Math.min(1, threat.elapsed / threat.duration);
    threat.t = progress;

    const x = threat.lx + progress * (threat.tx - threat.lx);
    const y = threat.ly + progress * (threat.ty - threat.ly);
    const altKm = 4 * threat.hmax * progress * (1 - progress);

    threat.trail.push({ x, y, t: progress });
    if (threat.trail.length > 12) threat.trail.shift();
    threat.cx = x; threat.cy = y; threat.altKm = altKm;

    // Check each interceptor
    if (!threat.intercepted) {
      for (const icp of allInterceptors) {
        if (!icp.active) continue;
        const distPx = Math.hypot(icp.x - x, icp.y - y);
        const distKm = distPx / canvas.width * state.mapScaleKm;
        if (distKm <= icp.def.range && altKm >= icp.def.altMin && altKm <= icp.def.altMax) {
          const roll = Math.random();
          if (roll < icp.def.hitProb) {
            threat.intercepted = true;
            threat.active = false;
            threat.interceptPos = { x, y };
            state.stats.intercepts++;
            spawnExplosion(x, y, COLORS.green, 24);
            addLabel(x, y - 20, 'נוטרל ✓', COLORS.green, 2000);
            showToast('יירוט מוצלח!', 'success');
            // fire one interceptor missile (visual)
            launchInterceptorMissile(icp, { x, y });
          } else {
            spawnExplosion(x, y, COLORS.orange, 14);
            addLabel(x, y - 20, 'החטיא', COLORS.orange, 1500);
          }
          break;
        }
      }
    }

    if (progress >= 1 && !threat.intercepted) {
      threat.active = false;
      threat.hit = true;
      state.targetStatus[threat.targetId] = 'hit';
      state.stats.hits++;
      spawnExplosion(threat.tx, threat.ty, COLORS.red, 36);
      addLabel(threat.tx, threat.ty - 30, 'נפגע ✗', COLORS.red, 3000);
      showToast('יעד נפגע!', 'danger');
    }
  });

  updateParticles(dt);
  updateLabels(dt);
}

function launchInterceptorMissile(icp, targetPos) {
  spawnExplosion(icp.x, icp.y, COLORS.blue, 10);
}

// ── PARTICLES ──────────────────────────────────────────────────────────────

function spawnExplosion(x, y, color, size) {
  for (let i = 0; i < 20; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 3;
    state.particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: size * (0.3 + Math.random() * 0.7),
      life: 1.0,
      decay: 0.02 + Math.random() * 0.04,
      color,
    });
  }
}

function updateParticles(dt) {
  const sec = dt / 1000;
  state.particles = state.particles.filter(p => p.life > 0);
  state.particles.forEach(p => {
    p.x += p.vx * sec * 60;
    p.y += p.vy * sec * 60;
    p.vx *= 0.95;
    p.vy *= 0.95;
    p.life -= p.decay * sec * 60;
    p.r *= 0.97;
  });
}

function addLabel(x, y, text, color, duration) {
  state.labels.push({ x, y, text, color, life: duration, maxLife: duration });
}

function updateLabels(dt) {
  state.labels = state.labels.filter(l => l.life > 0);
  state.labels.forEach(l => {
    l.life -= dt;
    l.y -= 0.3;
  });
}

// ── END SIMULATION ──────────────────────────────────────────────────────────

function endSimulation() {
  state.simPlaying = false;
  state.phase = 'replay';
  computeScore();
  updatePhaseBadge();
  updateHUD();
  showResultsModal();
}

function computeScore() {
  const totalVal = TARGETS.reduce((s,t)=>s+t.value, 0);
  let savedVal = 0, hitVal = 0;
  if (state.scenario === 'defense') {
    TARGETS.forEach(t => { if (state.targetStatus[t.id] === 'safe') savedVal += t.value; });
    state.stats.score = Math.round(savedVal / totalVal * 100);
  } else {
    TARGETS.forEach(t => { if (state.targetStatus[t.id] === 'hit') hitVal += t.value; });
    state.stats.score = Math.round(hitVal / totalVal * 100);
  }
}

function showResultsModal() {
  const score = state.stats.score;
  const el = document.getElementById('res-score-val');
  el.textContent = score;
  el.className = 'result-score-value ' + (score>=90?'excellent':score>=70?'good':score>=50?'ok':'fail');

  const stars = score>=90?'★★★':score>=70?'★★☆':score>=50?'★☆☆':'☆☆☆';
  document.getElementById('res-stars').textContent = stars;

  const verdicts = {
    defense: { excellent:'הגנה מושלמת', good:'הגנה טובה', ok:'הגנה חלקית', fail:'הגנה כשלה' },
    attack:  { excellent:'מתקפה מוצלחת', good:'מתקפה טובה', ok:'מתקפה חלקית', fail:'מתקפה כשלה' },
  };
  const vkey = score>=90?'excellent':score>=70?'good':score>=50?'ok':'fail';
  document.getElementById('res-verdict').textContent = verdicts[state.scenario][vkey];

  const tbody = document.getElementById('res-table-body');
  tbody.innerHTML = '';
  TARGETS.forEach(t => {
    const status = state.targetStatus[t.id];
    const isHit = status === 'hit';
    const rowClass = state.scenario==='defense'
      ? (isHit ? 'hit' : 'save')
      : (isHit ? 'save' : 'miss');
    tbody.innerHTML += `<tr class="${rowClass}">
      <td>${t.icon} ${t.name}</td>
      <td>${t.value}</td>
      <td>${isHit?(state.scenario==='defense'?'✗ נפגע':'✓ נפגע'):(state.scenario==='defense'?'✓ ניצל':'✗ לא נפגע')}</td>
    </tr>`;
  });

  document.getElementById('res-intercepts').textContent = state.stats.intercepts;
  document.getElementById('res-hits').textContent = state.stats.hits;
  document.getElementById('res-budget-saved').textContent = state.budget;

  openModal('modal-results');
}

// ── REPLAY / SCRUBBER ───────────────────────────────────────────────────────

function startReplay() {
  if (!state.simHistory.length) return;
  state.phase = 'replay';
  state.scrubPos = 0;
  updatePhaseBadge();
  applyScrubPos(0);
}

function snapshotState() {
  return {
    t: state.simTime,
    threats: state.threats.map(t => ({...t, trail:[...t.trail]})),
    particles: state.particles.map(p=>({...p})),
    stats: {...state.stats},
    targetStatus: {...state.targetStatus},
  };
}

function scrubTo(pct) {
  pct = Math.max(0, Math.min(1, pct));
  state.scrubPos = pct;
  applyScrubPos(pct);
}

function applyScrubPos(pct) {
  updateScrubUI(pct);
  if (!state.simHistory.length) return;
  const idx = Math.floor(pct * (state.simHistory.length - 1));
  const snap = state.simHistory[idx];
  if (!snap) return;
  state.threats = snap.threats.map(t => ({...t, trail:[...t.trail]}));
  state.particles = snap.particles.map(p=>({...p}));
  state.stats = {...snap.stats};
  state.targetStatus = {...snap.targetStatus};
  updateHUD();
  const secs = snap.t / 1000;
  document.getElementById('scrub-time').textContent = fmtTime(secs);
}

function updateScrubUI(pct) {
  document.getElementById('scrub-fill').style.width = (pct*100)+'%';
  document.getElementById('scrub-thumb').style.left  = (pct*100)+'%';
}

let scrubPlayInterval = null;
function toggleScrubPlay() {
  if (scrubPlayInterval) {
    clearInterval(scrubPlayInterval);
    scrubPlayInterval = null;
    document.getElementById('scrub-play').textContent = '▶';
  } else {
    document.getElementById('scrub-play').textContent = '⏸';
    scrubPlayInterval = setInterval(() => {
      if (state.scrubPos >= 1) { clearInterval(scrubPlayInterval); scrubPlayInterval=null; document.getElementById('scrub-play').textContent='▶'; return; }
      state.scrubPos = Math.min(1, state.scrubPos + 0.005 * state.simSpeed);
      applyScrubPos(state.scrubPos);
    }, 50);
  }
}

function toggleSimPlay() {
  state.simPlaying = !state.simPlaying;
}

function fmtTime(s) {
  const m = Math.floor(s/60);
  const sec = Math.floor(s%60);
  return `${m}:${sec.toString().padStart(2,'0')}`;
}

// ── DRAWING ─────────────────────────────────────────────────────────────────

function drawFrame() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBackground();
  drawGrid();
  drawTargets();
  drawPlacedUnits();
  drawThreats();
  drawParticles();
  drawLabels();
  if (state.phase === 'simulate' || state.phase === 'replay') drawStats();
  if (state.phase === 'idle' || state.phase === 'deploy') drawDeployPreview();
  if (state.scenario === 'attack' && attackPhase === 'launcher' && state.phase !== 'simulate') drawLaunchSites();
  if (state.scenario === 'attack' && attackPhase === 'target' && pendingLaunchPos) drawPendingLaunch();
}

function drawBackground() {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle vignette
  const grad = ctx.createRadialGradient(canvas.width/2, canvas.height/2, canvas.height*0.3,
                                         canvas.width/2, canvas.height/2, canvas.height*0.8);
  grad.addColorStop(0, 'transparent');
  grad.addColorStop(1, 'rgba(0,0,0,0.4)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawGrid() {
  const cellPx = canvas.width / 20;
  ctx.strokeStyle = '#1a2744';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let x = 0; x < canvas.width; x += cellPx) {
    ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height);
  }
  for (let y = 0; y < canvas.height; y += cellPx) {
    ctx.moveTo(0, y); ctx.lineTo(canvas.width, y);
  }
  ctx.stroke();
}

function drawTargets() {
  TARGETS.forEach(t => {
    const x = t.relX * canvas.width;
    const y = t.relY * canvas.height;
    const isHit = state.targetStatus[t.id] === 'hit';
    const color = isHit ? COLORS.red : COLORS.green;

    // Glow ring
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI*2);
    ctx.strokeStyle = color + '44';
    ctx.lineWidth = 6;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI*2);
    ctx.strokeStyle = color + '88';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Icon
    ctx.font = '18px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = isHit ? 0.5 : 1.0;
    ctx.fillText(t.icon, x, y);
    ctx.globalAlpha = 1.0;

    if (isHit) {
      ctx.fillStyle = COLORS.red;
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText('✗', x + 10, y - 10);
    }

    // Label
    ctx.fillStyle = color;
    ctx.font = '10px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t.name, x, y + 24);
  });
}

function drawPlacedUnits() {
  state.placedUnits.forEach(unit => {
    const def = INTERCEPTOR_DEFS[unit.defId] || RADAR_DEFS[unit.defId];
    const isRadar = unit.type === 'radar';
    const color = def.color || COLORS.blue;

    if (state.showRanges && def.range) {
      const rangePx = def.range / state.mapScaleKm * canvas.width;
      ctx.beginPath();
      ctx.arc(unit.x, unit.y, rangePx, 0, Math.PI*2);
      ctx.strokeStyle = color + '33';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (isRadar) {
      drawRadarIcon(unit.x, unit.y, color, def.range);
    } else {
      drawInterceptorIcon(unit.x, unit.y, color);
    }

    ctx.fillStyle = color;
    ctx.font = '10px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(def.name, unit.x, unit.y + 18);
  });
}

function drawInterceptorIcon(x, y, color) {
  ctx.beginPath();
  ctx.arc(x, y, 8, 0, Math.PI*2);
  ctx.fillStyle = color + '33';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Small triangle (upward arrow)
  ctx.beginPath();
  ctx.moveTo(x, y-5);
  ctx.lineTo(x-4, y+4);
  ctx.lineTo(x+4, y+4);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawRadarIcon(x, y, color, rangeKm) {
  ctx.strokeStyle = color + 'aa';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) {
    const r = 6 + i * 5;
    const startAngle = -Math.PI * 0.6;
    const endAngle   =  Math.PI * 0.6;
    ctx.beginPath();
    ctx.arc(x, y, r, startAngle, endAngle);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI*2);
  ctx.fillStyle = color;
  ctx.fill();
}

function drawThreats() {
  state.threats.forEach(threat => {
    if (threat.elapsed < 0) return;
    if (!threat.active && !threat.intercepted && !threat.hit) return;

    const x = threat.cx, y = threat.cy;
    const t = threat.t;
    const altKm = threat.altKm || 0;
    const maxAlt = threat.hmax;
    const normAlt = maxAlt > 0 ? altKm / maxAlt : 0;

    // Color by phase
    let color;
    if (t < 0.4) color = COLORS.blue;
    else if (t < 0.6) color = COLORS.white;
    else if (t < 0.85) color = COLORS.orange;
    else color = COLORS.red;

    if (threat.intercepted) return;

    // Trail
    if (threat.trail.length > 1) {
      for (let i = 1; i < threat.trail.length; i++) {
        const p = threat.trail[i-1];
        const q = threat.trail[i];
        const alpha = (i / threat.trail.length) * 0.5;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      }
    }

    // Shadow line (vertical drop to bottom)
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, canvas.height);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.setLineDash([3, 6]);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);

    // Missile dot (grows with altitude)
    const radius = 4 + normAlt * 8;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI*2);
    ctx.fillStyle = color + 'aa';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Altitude label
    if (altKm > 1) {
      ctx.fillStyle = color;
      ctx.font = '10px Share Tech Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(Math.round(altKm) + 'km', x, y - radius - 5);
    }
  });
}

function drawParticles() {
  state.particles.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.5, p.r), 0, Math.PI*2);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fill();
    ctx.globalAlpha = 1.0;
  });
}

function drawLabels() {
  state.labels.forEach(l => {
    const alpha = Math.min(1, l.life / l.maxLife * 3);
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 12px Rajdhani, sans-serif';
    ctx.fillStyle = l.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(l.text, l.x, l.y);
    ctx.globalAlpha = 1.0;
  });
}

function drawStats() {
  ctx.font = '11px Share Tech Mono, monospace';
  ctx.textAlign = 'right';
  ctx.fillStyle = COLORS.muted;
  const simPct = Math.min(100, Math.round(state.simTime / SIM_DURATION_MS * 100));
  ctx.fillText('סימולציה: ' + simPct + '%', canvas.width - 10, canvas.height - 10);
}

function drawDeployPreview() {
  const unit = getSelectedUnit() || getSelectedAttackUnit();
  if (!unit) return;
  const def = INTERCEPTOR_DEFS[unit] || RADAR_DEFS[unit] || THREAT_DEFS[unit];
  if (!def) return;
  ctx.font = '12px Rajdhani, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = COLORS.blue;
  ctx.fillText('[ בחור: ' + def.name + ' ]', 8, canvas.height - 8);
}

function drawLaunchSites() {
  LAUNCH_SITES.forEach((ls, i) => {
    const x = ls.relX * canvas.width;
    const y = ls.relY * canvas.height;
    ctx.beginPath();
    ctx.moveTo(x, y - 12);
    ctx.lineTo(x - 10, y + 8);
    ctx.lineTo(x + 10, y + 8);
    ctx.closePath();
    ctx.fillStyle = COLORS.red + '66';
    ctx.fill();
    ctx.strokeStyle = COLORS.red;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = COLORS.red;
    ctx.font = '10px Rajdhani';
    ctx.textAlign = 'center';
    ctx.fillText('שיגור ' + (i+1), x, y + 22);
  });
}

function drawPendingLaunch() {
  const { x, y } = pendingLaunchPos;
  ctx.beginPath();
  ctx.moveTo(x, y - 14);
  ctx.lineTo(x - 11, y + 9);
  ctx.lineTo(x + 11, y + 9);
  ctx.closePath();
  ctx.fillStyle = COLORS.red;
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = COLORS.orange;
  ctx.font = '11px Rajdhani';
  ctx.textAlign = 'center';
  ctx.fillText('בחר יעד', x, y + 26);
}

// ── HUD / PHASE ─────────────────────────────────────────────────────────────

function updateHUD() {
  document.getElementById('stat-phase').textContent = DIFFICULTY[state.difficulty]?.label ?? '--';
  document.getElementById('stat-budget').textContent = state.budget;
  document.getElementById('stat-threats').textContent = state.threats.filter(t=>t.active).length;
  document.getElementById('stat-intercepts').textContent = state.stats.intercepts;
  document.getElementById('stat-hits').textContent = state.stats.hits;
  document.getElementById('stat-score').textContent = state.phase==='replay'||state.phase==='simulate' ? state.stats.score : '--';
}

function updatePhaseBadge() {
  const badge = document.getElementById('phase-badge');
  const labels = { idle:'ממתין', deploy:'פריסה', simulate:'סימולציה', replay:'חזרה' };
  const classes = { idle:'idle', deploy:'deploy', simulate:'simulate', replay:'replay' };
  badge.textContent = labels[state.phase] || '--';
  badge.className = 'phase-badge ' + (classes[state.phase] || 'idle');
  updateHUD();
}

// ── TOOLTIP ─────────────────────────────────────────────────────────────────

function onCanvasMouseMove(e) {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top)  * (canvas.height / rect.height);

  const target = findTargetAtPos(x, y);
  if (target) {
    showTooltip(e.clientX, e.clientY, target.name, `ערך: ${target.value} | סטטוס: ${state.targetStatus[target.id]==='hit'?'נפגע':'שלם'}`);
    return;
  }
  const unit = findUnitAtPos(x, y);
  if (unit) {
    const def = INTERCEPTOR_DEFS[unit.defId] || RADAR_DEFS[unit.defId];
    showTooltip(e.clientX, e.clientY, def.name, `טווח: ${def.range}km${def.altMin?` | גובה: ${def.altMin}–${def.altMax}km`:''}`);
    return;
  }
  hideTooltip();
}

function showTooltip(cx, cy, name, detail) {
  const tt = document.getElementById('tooltip');
  document.getElementById('tooltip-name').textContent = name;
  document.getElementById('tooltip-detail').textContent = detail;
  tt.style.left = (cx + 14) + 'px';
  tt.style.top  = (cy - 10) + 'px';
  tt.classList.remove('hidden');
}

function hideTooltip() {
  document.getElementById('tooltip').classList.add('hidden');
}

// ── TOAST ───────────────────────────────────────────────────────────────────

function showToast(msg, type='info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 2800);
}

// ── UNIT CARD SELECTION (deferred binding) ───────────────────────────────────

(function bindUnitCards() {
  const panels = ['panel-blue','panel-red'];
  panels.forEach(pid => {
    const panel = document.getElementById(pid);
    if (!panel) return;
    panel.addEventListener('click', e => {
      const card = e.target.closest('.unit-card');
      if (!card || e.target.classList.contains('count-btn')) return;
      panel.querySelectorAll('.unit-card').forEach(c => c.classList.remove('selected'));
      card.classList.toggle('selected');
    });
  });
})();

// ── BOOT ────────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
