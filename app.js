'use strict';
const VERSION = '43';

// ── MAP ────────────────────────────────────────────────────────────────────
const MAP_W_KM       = 2500;
let   MAP_H_KM       = 500;   // set dynamically per-simulation based on max threat hmax
const ENEMY_X_MAX    = 500;   // enemy zone 0-500km, friendly zone 500-2500km (no gap)
const FRIENDLY_X_MIN = 500;
const MAP_D_KM       = 400;
let ISO = { scaleX:0.3, scaleY:0.6, scaleZ:0.1, ox:0, oy:0, tiltV:0.3, cosYaw:1, sinYaw:0, vcx:0, vcy:0 };
let MAP_YAW  = 0;
let MAP_TILT = 1.0;
let VIEW = { zoom: 1, panX: 0, panY: 0 };
const YAW_STEP = Math.PI / 8, TILT_STEP = 0.15, TILT_MIN = 0.15, TILT_MAX = 3.0;
const ZOOM_MIN = 0.25, ZOOM_MAX = 6;

function applyView(x, y) {
  const { vcx, vcy } = ISO;
  return { x: (x - vcx) * VIEW.zoom + vcx + VIEW.panX, y: (y - vcy) * VIEW.zoom + vcy + VIEW.panY };
}
function unapplyView(x, y) {
  const { vcx, vcy } = ISO;
  return { x: (x - VIEW.panX - vcx) / VIEW.zoom + vcx, y: (y - VIEW.panY - vcy) / VIEW.zoom + vcy };
}
function zoomAround(cx, cy, factor) {
  const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, VIEW.zoom * factor));
  const f = z / VIEW.zoom;
  VIEW.panX = cx - (cx - VIEW.panX) * f;
  VIEW.panY = cy - (cy - VIEW.panY) * f;
  VIEW.zoom = z;
}
function resetView() { VIEW = { zoom: 1, panX: 0, panY: 0 }; MAP_YAW = 0; MAP_TILT = 1.0; computeIso(); state.starsSeeded = false; }
function adjustYaw(d) { MAP_YAW += d; computeIso(); state.starsSeeded = false; }
function adjustTilt(d) { MAP_TILT = Math.max(TILT_MIN, Math.min(TILT_MAX, MAP_TILT + d)); computeIso(); state.starsSeeded = false; }

function isoToCanvas(xKm, yKm, altKm) {
  const { scaleX, scaleY, scaleZ, ox, oy, tiltV, cosYaw, sinYaw, vcx, vcy } = ISO;
  const mcx = MAP_W_KM * 0.5, mcy = MAP_D_KM * 0.5;
  const dx = xKm - mcx, dy = yKm - mcy;
  const rx = mcx + dx * cosYaw - dy * sinYaw;
  const ry = mcy + dx * sinYaw + dy * cosYaw;
  const rawX = ox + rx * scaleX - ry * scaleY * 0.6;
  const rawY = oy + rx * scaleX * 0.4 + ry * tiltV - altKm * scaleZ;
  return { x: (rawX - vcx) * VIEW.zoom + vcx + VIEW.panX, y: (rawY - vcy) * VIEW.zoom + vcy + VIEW.panY };
}

function computeIso() {
  const W = canvas.width, H = canvas.height;
  const scaleX = (W * 0.36) / MAP_W_KM;
  const scaleY = (W * 0.20) / MAP_D_KM;
  const tiltV  = scaleY * 0.3 * MAP_TILT;
  const ox = W * 0.04 + MAP_D_KM * scaleY * 0.6;
  const groundBottomOffset = MAP_W_KM * scaleX * 0.4 + MAP_D_KM * tiltV;
  const oy = H * 0.92 - groundBottomOffset;
  const scaleZ = Math.max(0.05, (oy - H * 0.04) / Math.max(1, MAP_H_KM));
  ISO = { scaleX, scaleY, scaleZ, ox, oy, tiltV,
          cosYaw: Math.cos(MAP_YAW), sinYaw: Math.sin(MAP_YAW),
          vcx: W * 0.5, vcy: H * 0.5 };
}

function kmToCanvas(xKm, altKm, yKm) {
  return isoToCanvas(xKm, yKm ?? MAP_D_KM * 0.5, altKm);
}

function canvasToWorld(px, py) {
  const { scaleX, scaleY, tiltV, ox, oy, cosYaw, sinYaw } = ISO;
  const raw = unapplyView(px, py);
  const dx = raw.x - ox, dy = raw.y - oy;
  const yKm0 = (dy - dx * 0.4) / (tiltV + scaleY * 0.6 * 0.4);
  const xKm0 = (dx + yKm0 * scaleY * 0.6) / scaleX;
  const mcx = MAP_W_KM * 0.5, mcy = MAP_D_KM * 0.5;
  const dx2 = xKm0 - mcx, dy2 = yKm0 - mcy;
  return {
    xKm: Math.max(0, Math.min(MAP_W_KM, mcx + dx2 * cosYaw + dy2 * sinYaw)),
    yKm: Math.max(0, Math.min(MAP_D_KM, mcy - dx2 * sinYaw + dy2 * cosYaw)),
  };
}
function computeMapH() {
  // Threats live in state.waves[].threats until each wave fires, so scan both
  const allThreats = [
    ...state.threats,
    ...state.waves.flatMap(w => w.threats),
  ];
  const maxH = Math.max(...allThreats.map(t => t.hmax), 100);
  MAP_H_KM = Math.max(150, maxH * 1.05);
}

// ── DEFINITIONS ────────────────────────────────────────────────────────────
const THREAT_DEFS = {
  'scud-b':  { name:'SCUD-B',   rangekm:300,  speed:1.5, cost:1,  rcs:1.0, stealthAscent:false, termManeuver:false, color:'#ef4444', launchZone:'near'  },
  'scud-c':  { name:'SCUD-C',   rangekm:500,  speed:1.8, cost:2,  rcs:0.8, stealthAscent:false, termManeuver:false, color:'#f97316', launchZone:'near'  },
  'shahab3': { name:'Shahab-3', rangekm:1300, speed:2.5, cost:4,  rcs:0.45,stealthAscent:true,  termManeuver:false, color:'#fb923c', launchZone:'mid'   },
  'ghadr1':  { name:'Ghadr-1',  rangekm:1800, speed:3.0, cost:6,  rcs:0.25,stealthAscent:true,  termManeuver:false, color:'#fbbf24', launchZone:'far'   },
  'icbm':    { name:'ICBM',     rangekm:5000, speed:7.0, cost:15, rcs:0.07,stealthAscent:true,  termManeuver:true,  color:'#f43f5e', launchZone:'icbm'  },
};

const INTERCEPTOR_DEFS = {
  pac3:   { name:'PAC-3',    range:40,   altMin:5,   altMax:40,   speed:2.0, cost:1,  magazine:16, maxSim:4, reloadTime:25000, detRange:150,  color:'#5fc8e8' },
  arrow2: { name:'Arrow-2',  range:90,   altMin:10,  altMax:55,   speed:3.0, cost:3,  magazine:8,  maxSim:2, reloadTime:35000, detRange:300,  color:'#38bdf8' },
  thaad:  { name:'THAAD',    range:200,  altMin:40,  altMax:150,  speed:3.5, cost:6,  magazine:6,  maxSim:3, reloadTime:40000, detRange:600,  color:'#818cf8' },
  sm3:    { name:'SM-3',     range:700,  altMin:150, altMax:500,  speed:5.0, cost:10, magazine:4,  maxSim:2, reloadTime:60000, detRange:1000, color:'#a78bfa' },
  arrow3: { name:'Arrow-3',  range:2400, altMin:100, altMax:1000, speed:5.5, cost:15, magazine:4,  maxSim:1, reloadTime:90000, detRange:2000, color:'#c084fc' },
};

const RADAR_DEFS = {
  'patriot-radar': { name:'Patriot Radar', range:150,  cost:2, color:'#22d3ee' },
  'green-pine':    { name:'Green Pine',    range:500,  cost:5, color:'#4ade80' },
  'xband':         { name:'X-Band TPY-2', range:900,  cost:8, color:'#86efac' },
};

const INTERCEPTOR_INFO = {
  pac3:   'טווח: 40km | גובה: 5-40km | מגזין: 16 | מהירות: 2km/s | PK: SCUD 85%, בינוני 32%',
  arrow2: 'טווח: 90km | גובה: 10-55km | מגזין: 8 | מהירות: 3km/s | PK: SCUD 74%, Shahab 72%',
  thaad:  'טווח: 200km | גובה: 40-150km | מגזין: 6 | מהירות: 3.5km/s | PK: Shahab 86%, Ghadr 82%',
  sm3:    'טווח: 700km | גובה: 150-500km | מגזין: 4 | מהירות: 5km/s | PK: Ghadr 88%, ICBM 82%',
  arrow3: 'טווח: 2400km | גובה: 100-1000km | מגזין: 4 | מהירות: 5.5km/s | PK: ICBM 94%',
  'patriot-radar': 'גילוי: 150km | מספק עדכון מסלול בזמן-אמת',
  'green-pine':    'גילוי: 500km | מכ"ם ייעודי לגילוי מוקדם',
  'xband':         'גילוי: 900km | גילוי ב-X-Band, RCS נמוך',
  'scud-b':   'טווח: 300km | גובה שיא: 55km | RCS: 1.0 (גדול) | מהיר ופשוט לתפעול',
  'scud-c':   'טווח: 500km | גובה שיא: 90km | RCS: 0.8 | שיפור על SCUD-B',
  'shahab3':  'טווח: 1300km | גובה שיא: 234km | RCS: 0.45 | סטלת בעלייה — קשה לזיהוי מוקדם',
  'ghadr1':   'טווח: 1800km | גובה שיא: 324km | RCS: 0.25 | דיוק גבוה, קשה ליירוט',
  'icbm':     'טווח: 5000km | גובה שיא: 900km | RCS: 0.07 | תמרון סיומי — דורש SM-3 / Arrow-3',
};

// PK[interceptorId][threatId]
const PK_MATRIX = {
  pac3:   { 'scud-b':0.85, 'scud-c':0.72, 'shahab3':0.32, 'ghadr1':0.14, 'icbm':0.04 },
  arrow2: { 'scud-b':0.74, 'scud-c':0.82, 'shahab3':0.72, 'ghadr1':0.40, 'icbm':0.11 },
  thaad:  { 'scud-b':0.58, 'scud-c':0.64, 'shahab3':0.86, 'ghadr1':0.82, 'icbm':0.44 },
  sm3:    { 'scud-b':0.48, 'scud-c':0.54, 'shahab3':0.76, 'ghadr1':0.88, 'icbm':0.82 },
  arrow3: { 'scud-b':0.52, 'scud-c':0.58, 'shahab3':0.80, 'ghadr1':0.90, 'icbm':0.94 },
};

const LAUNCH_ZONES = {
  near:  [200, 280, 180, 320],
  mid:   [140, 200, 120, 170],
  far:   [80,  130, 60,  100],
  icbm:  [30,  60,  20,  45],
};

const TARGETS = [
  { id:'port',     name:'נמל ים',       value:12, icon:'⚓', posX_km:680,  posY_km:240 },
  { id:'industry', name:'מתקן תעשייתי', value:10, icon:'🏭', posX_km:920,  posY_km:330 },
  { id:'power',    name:'תחנת כוח',     value:20, icon:'⚡', posX_km:1260, posY_km:140 },
  { id:'city',     name:'עיר גדולה',    value:25, icon:'🏙', posX_km:1680, posY_km:280 },
  { id:'base',     name:'בסיס צבאי',    value:30, icon:'🪖', posX_km:2080, posY_km:100 },
  { id:'airport',  name:'נמל תעופה',    value:15, icon:'✈', posX_km:2350, posY_km:210 },
];

const BATTERY_LIMITS = {
  easy:    { pac3:6, arrow2:4, thaad:2, sm3:1, arrow3:1, 'patriot-radar':3, 'green-pine':2, 'xband':1 },
  medium:  { pac3:4, arrow2:3, thaad:2, sm3:1, arrow3:0, 'patriot-radar':2, 'green-pine':1, 'xband':0 },
  hard:    { pac3:3, arrow2:2, thaad:1, sm3:0, arrow3:0, 'patriot-radar':1, 'green-pine':1, 'xband':0 },
  extreme: { pac3:2, arrow2:1, thaad:1, sm3:0, arrow3:0, 'patriot-radar':1, 'green-pine':0, 'xband':0 },
};

const ATTACK_LIMITS = {
  easy:    { 'scud-b':6, 'scud-c':4, 'shahab3':0, 'ghadr1':0, 'icbm':0 },
  medium:  { 'scud-b':4, 'scud-c':4, 'shahab3':2, 'ghadr1':0, 'icbm':0 },
  hard:    { 'scud-b':3, 'scud-c':3, 'shahab3':3, 'ghadr1':2, 'icbm':0 },
  extreme: { 'scud-b':2, 'scud-c':2, 'shahab3':2, 'ghadr1':2, 'icbm':2 },
};

const DIFFICULTY = {
  easy: {
    key:'easy', label:'קל', noIntel:false, speedMult:0.7,
    waves:[
      { startTime:2000,  count:3, pool:['scud-b','scud-b','scud-c'] },
      { startTime:28000, count:3, pool:['scud-b','scud-c','scud-c'] },
    ]
  },
  medium: {
    key:'medium', label:'בינוני', noIntel:false, speedMult:1.0,
    waves:[
      { startTime:2000,  count:4, pool:['scud-b','scud-c','scud-c','shahab3'] },
      { startTime:25000, count:3, pool:['scud-c','shahab3','shahab3'] },
      { startTime:48000, count:3, pool:['shahab3','ghadr1','shahab3'] },
    ]
  },
  hard: {
    key:'hard', label:'קשה', noIntel:false, speedMult:1.3,
    waves:[
      { startTime:2000,  count:5, pool:['scud-c','shahab3','shahab3','ghadr1'] },
      { startTime:20000, count:4, pool:['shahab3','ghadr1','ghadr1','shahab3'] },
      { startTime:40000, count:4, pool:['ghadr1','ghadr1','shahab3','icbm'] },
      { startTime:60000, count:3, pool:['ghadr1','icbm','icbm'] },
    ]
  },
  extreme: {
    key:'extreme', label:'קשה-במיוחד', noIntel:true, speedMult:1.6,
    waves:[
      { startTime:1500,  count:6, pool:['shahab3','ghadr1','ghadr1','icbm'] },
      { startTime:18000, count:5, pool:['ghadr1','icbm','ghadr1','icbm'] },
      { startTime:35000, count:5, pool:['icbm','ghadr1','icbm','icbm'] },
      { startTime:55000, count:4, pool:['icbm','icbm','ghadr1','icbm'] },
    ]
  },
};

// Threat severity multiplier for engagement priority
const THREAT_SEVERITY = {
  'scud-b':1.0, 'scud-c':1.2, 'shahab3':1.6, 'ghadr1':2.0, 'icbm':3.0,
};

// Minimum PK to bother engaging a threat with a given system
const PK_MIN_THRESHOLD = 0.10;

const SIM_TOTAL_MS = 90000;
const C = { bg:'#080d18', bg2:'#0d1526', bg3:'#111d35', blue:'#5fc8e8', red:'#ef4444', green:'#22c55e', orange:'#f97316', white:'#e8f0fe', muted:'#4a5a7a', border:'#1e3050' };

// ── STATE ──────────────────────────────────────────────────────────────────
let state = {
  scenario:'defense', difficulty:'medium',
  phase:'idle',
  batteryLimits:{}, attackLimits:{},
  selectedUnitId:null,
  movingBatteryId:null,
  placedBatteries:[],   // { id, defId, type:'interceptor'|'radar', posX_km, ammoRemaining, maxAmmo, activeEngagements, reloading, reloadTimer }
  threats:[],           // active missiles
  interceptorMissiles:[], // flying interceptors
  particles:[], labels:[],
  simTime:0, simSpeed:1, simPlaying:false, simLastTs:0,
  simHistory:[], scrubPos:0,
  showRanges:true, noIntel:false,
  waves:[], currentWaveIdx:0, nextWaveTimer:0,
  stats:{ intercepts:0, hits:0, score:0, shotsFired:0 },
  targetStatus:{},
  counts:{ pac3:0,arrow2:0,thaad:0,sm3:0,arrow3:0,'patriot-radar':0,'green-pine':0,xband:0,'scud-b':0,'scud-c':0,shahab3:0,ghadr1:0,icbm:0 },
  ngScenario:'defense', ngDifficulty:'medium',
  attackPlanned:[],     // {defId, launchX_km, launchY_km, targetId}
  attackPhase:'launcher', pendingLaunchX_km:null, pendingLaunchY_km:null,
  stars:[], starsSeeded:false,
};

// ── INIT ───────────────────────────────────────────────────────────────────
const canvas = document.getElementById('main-canvas');
const ctx    = canvas.getContext('2d');

function init() {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  bindUI();
  resetToIdle();
  const vEl = document.getElementById('hud-version');
  if (vEl) vEl.textContent = VERSION;
  document.title = 'TBMWAR ' + VERSION + (window.MOBILE_MODE ? ' מובייל' : '');
  requestAnimationFrame(renderLoop);
}

function resizeCanvas() {
  const area = document.getElementById('canvas-area');
  canvas.width  = area.clientWidth;
  canvas.height = area.clientHeight;
  state.starsSeeded = false;
  computeIso();
}

// ── UI BINDINGS ────────────────────────────────────────────────────────────
function bindUI() {
  document.getElementById('btn-new-game')?.addEventListener('click', () => openModal('modal-new-game'));
  document.getElementById('btn-instructions')?.addEventListener('click', () => openModal('modal-instructions'));
  document.getElementById('btn-start-sim')?.addEventListener('click', startSimulation);
  document.getElementById('btn-reset-deploy').addEventListener('click', resetDeploy);

  document.querySelectorAll('[data-close]').forEach(btn =>
    btn.addEventListener('click', () => closeModal(btn.dataset.close))
  );
  document.querySelectorAll('.modal-overlay').forEach(ov =>
    ov.addEventListener('click', e => { if (e.target === ov) closeModal(ov.id); })
  );

  document.querySelectorAll('#sidebar .diff-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('#sidebar .diff-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.difficulty = btn.dataset.diff;
      applyDifficulty();
    })
  );

  document.querySelectorAll('#scenario-select .scenario-card').forEach(card =>
    card.addEventListener('click', () => {
      document.querySelectorAll('#scenario-select .scenario-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      state.scenario = card.dataset.scenario;
      applyScenario();
    })
  );

  document.querySelectorAll('.count-btn').forEach(btn =>
    btn.addEventListener('click', () => adjustCount(btn.dataset.id, btn.dataset.action))
  );

  const tr = document.getElementById('toggle-ranges');
  if (tr) tr.addEventListener('change', e => { state.showRanges = e.target.checked; });

  canvas.addEventListener('click', onCanvasClick);
  canvas.addEventListener('mousemove', onCanvasMouseMove);
  canvas.addEventListener('mouseleave', hideTooltip);

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const cy = (e.clientY - rect.top)  * (canvas.height / rect.height);
    zoomAround(cx, cy, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });

  let _drag = { active:false, startX:0, startY:0, lastX:0, lastY:0,
                moved:false, dist0:0, angle0:0, midX:0, midY:0 };

  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    hideTooltip();
    if (e.touches.length === 1) {
      _drag.active = true;
      _drag.startX = _drag.lastX = e.touches[0].clientX;
      _drag.startY = _drag.lastY = e.touches[0].clientY;
      _drag.moved  = false;
    } else if (e.touches.length >= 2) {
      _drag.active = false;
      const t0 = e.touches[0], t1 = e.touches[1];
      _drag.dist0  = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      _drag.angle0 = Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX);
      _drag.midX   = (t0.clientX + t1.clientX) * 0.5;
      _drag.midY   = (t0.clientY + t1.clientY) * 0.5;
      _drag.moved  = true;
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 1 && _drag.active) {
      const dx = e.touches[0].clientX - _drag.lastX;
      const dy = e.touches[0].clientY - _drag.lastY;
      VIEW.panX += dx; VIEW.panY += dy;
      _drag.lastX = e.touches[0].clientX;
      _drag.lastY = e.touches[0].clientY;
      if (Math.hypot(e.touches[0].clientX - _drag.startX, e.touches[0].clientY - _drag.startY) > 6)
        _drag.moved = true;
    } else if (e.touches.length >= 2) {
      const t0 = e.touches[0], t1 = e.touches[1];
      const newDist  = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      const newAngle = Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX);
      const newMidX  = (t0.clientX + t1.clientX) * 0.5;
      const newMidY  = (t0.clientY + t1.clientY) * 0.5;
      const rect     = canvas.getBoundingClientRect();
      const cx = (_drag.midX - rect.left) * (canvas.width  / rect.width);
      const cy = (_drag.midY - rect.top)  * (canvas.height / rect.height);

      // Zoom from distance change
      zoomAround(cx, cy, newDist / _drag.dist0);

      let dAngle = newAngle - _drag.angle0;
      if (dAngle >  Math.PI) dAngle -= Math.PI * 2;
      if (dAngle < -Math.PI) dAngle += Math.PI * 2;
      const dMidY = newMidY - _drag.midY;
      MAP_YAW += dAngle;
      VIEW.panX += newMidX - _drag.midX;
      adjustTilt(-dMidY * 0.012);
      _drag.dist0  = newDist;
      _drag.angle0 = newAngle;
      _drag.midX   = newMidX;
      _drag.midY   = newMidY;
    }
  }, { passive: false });

  canvas.addEventListener('touchend', e => {
    e.preventDefault();
    if (!_drag.moved && e.changedTouches.length === 1) {
      const t    = e.changedTouches[0];
      const rect = canvas.getBoundingClientRect();
      const px   = (t.clientX - rect.left) * (canvas.width  / rect.width);
      const py   = (t.clientY - rect.top)  * (canvas.height / rect.height);
      onCanvasClick({ clientX: t.clientX, clientY: t.clientY, _px: px, _py: py });
    }
    _drag.active = false;
  }, { passive: false });

  document.getElementById('ng-confirm').addEventListener('click', confirmNewGame);
  document.querySelectorAll('#modal-new-game .scenario-card').forEach(card =>
    card.addEventListener('click', () => {
      document.querySelectorAll('#modal-new-game .scenario-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      state.ngScenario = card.dataset.scenario;
    })
  );
  document.querySelectorAll('#ng-difficulty .diff-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('#ng-difficulty .diff-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.ngDifficulty = btn.dataset.diff;
    })
  );

  document.getElementById('res-replay-btn').addEventListener('click', () => { closeModal('modal-results'); startReplay(); });
  document.getElementById('res-new-game-btn').addEventListener('click', () => { closeModal('modal-results'); openModal('modal-new-game'); });

  const track = document.getElementById('scrub-track');
  if (track) track.addEventListener('click', e => {
    const r = track.getBoundingClientRect();
    scrubTo((e.clientX - r.left) / r.width);
  });
  document.getElementById('scrub-play')?.addEventListener('click', toggleScrubPlay);
  document.getElementById('scrub-rewind')?.addEventListener('click', () => scrubTo(0));
  document.getElementById('scrub-results')?.addEventListener('click', showResultsModal);
  document.querySelectorAll('.speed-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.simSpeed = parseFloat(btn.dataset.speed);
    })
  );

  // Unit card selection
  ['panel-blue','panel-red'].forEach(pid => {
    const panel = document.getElementById(pid);
    if (!panel) return;
    panel.addEventListener('click', e => {
      const card = e.target.closest('.unit-card');
      if (!card || e.target.classList.contains('count-btn')) return;
      panel.querySelectorAll('.unit-card').forEach(c => c.classList.remove('selected'));
      if (!card.classList.contains('selected')) {
        card.classList.add('selected');
        state.selectedUnitId = card.dataset.id;
      } else {
        state.selectedUnitId = null;
      }
    });
  });

  document.querySelectorAll('.unit-info-btn').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const info = INTERCEPTOR_INFO[id] || '';
      showToast(info, 'info', 5000);
    })
  );

  document.addEventListener('keydown', e => {
    if (e.key === ' ' && !e.target.matches('input,button,textarea')) {
      e.preventDefault();
      if (state.phase === 'simulate') state.simPlaying = !state.simPlaying;
      else if (state.phase === 'replay') toggleScrubPlay();
    }
    if ((e.key === 'n'||e.key==='N') && !e.target.matches('input,textarea')) openModal('modal-new-game');
    if (e.key === 'Escape') { state.selectedUnitId = null; document.querySelectorAll('.unit-card').forEach(c=>c.classList.remove('selected')); }
    if (!e.target.matches('input,textarea,button')) {
      if (e.key==='q'||e.key==='Q') adjustYaw(-YAW_STEP);
      if (e.key==='e'||e.key==='E') adjustYaw(+YAW_STEP);
      if (e.key==='w'||e.key==='W') adjustTilt(-TILT_STEP);
      if (e.key==='s'||e.key==='S') adjustTilt(+TILT_STEP);
    }
  });

  document.getElementById('btn-rotate-left') ?.addEventListener('click', () => adjustYaw(-YAW_STEP));
  document.getElementById('btn-rotate-right')?.addEventListener('click', () => adjustYaw(+YAW_STEP));
  document.getElementById('btn-tilt-up')     ?.addEventListener('click', () => adjustTilt(-TILT_STEP));
  document.getElementById('btn-tilt-down')   ?.addEventListener('click', () => adjustTilt(+TILT_STEP));
}

// ── SCENARIO / DIFFICULTY ──────────────────────────────────────────────────
function applyScenario() {
  const isDefense = state.scenario === 'defense';
  document.getElementById('panel-blue').style.display = isDefense ? '' : 'none';
  document.getElementById('panel-red').style.display  = isDefense ? 'none' : '';
  setCanvasHint(isDefense
    ? 'בחר מיירט ולחץ על האזור הידידותי (ימין) להנחה. טווח הגילוי מוצג בקו מקווקו.'
    : 'בחר טיל, לחץ להנחת נקודת שיגור (שמאל), ולחץ על יעד (ימין) לכיוון.');
}

function applyDifficulty() {
  state.batteryLimits = { ...(BATTERY_LIMITS[state.difficulty] || BATTERY_LIMITS.medium) };
  state.attackLimits  = { ...(ATTACK_LIMITS[state.difficulty]  || ATTACK_LIMITS.medium)  };
  state.noIntel = DIFFICULTY[state.difficulty].noIntel;
  updateLimitsUI();
}

function setCanvasHint(msg) {
  const el = document.getElementById('canvas-hint');
  if (el) { el.textContent = msg; el.style.display = ''; }
}

// ── BUDGET / COUNTS ────────────────────────────────────────────────────────
function adjustCount(id, action) {
  // kept for compatibility; count tracking removed in favour of direct placement
}

function updateLimitsUI() {
  Object.keys(state.batteryLimits || {}).forEach(id => {
    const placed = state.placedBatteries.filter(b => b.defId === id).length;
    const max    = state.batteryLimits[id] || 0;
    const el     = document.getElementById('avail-' + id);
    const card   = document.querySelector(`.unit-card[data-id="${id}"]`);
    if (el)   el.textContent = (max - placed) + '/' + max;
    if (card) card.classList.toggle('depleted', placed >= max);
  });
  Object.keys(state.attackLimits || {}).forEach(id => {
    const used = state.attackPlanned.filter(p => p.defId === id).length;
    const max  = state.attackLimits[id] || 0;
    const el   = document.getElementById('avail-' + id);
    const card = document.querySelector(`.unit-card[data-id="${id}"]`);
    if (el)   el.textContent = (max - used) + '/' + max;
    if (card) card.classList.toggle('depleted', used >= max || max === 0);
  });
  document.getElementById('budget-val')?.closest('#budget-display')?.remove();
}

function getAvailable(defId) {
  const placed = state.placedBatteries.filter(b => b.defId === defId).length;
  return (state.batteryLimits[defId] || 0) - placed;
}

function updateBudgetUI() {
  updateLimitsUI();
}

// ── CANVAS CLICK ───────────────────────────────────────────────────────────
function onCanvasClick(e) {
  if (state.phase === 'simulate' || state.phase === 'replay') return;
  const rect = canvas.getBoundingClientRect();
  const px = e._px ?? (e.clientX - rect.left) * (canvas.width / rect.width);
  const py = e._py ?? (e.clientY - rect.top)  * (canvas.height / rect.height);
  const { xKm, yKm } = canvasToWorld(px, py);

  if (state.scenario === 'defense') handleDefenseClick(xKm, yKm, px, py);
  else handleAttackClick(xKm, yKm, px, py);
}

function handleDefenseClick(xKm, yKm, px, py) {
  if (xKm < FRIENDLY_X_MIN) { showToast('פרוס רק באזור הידידותי (צד ימין)', 'warn'); return; }

  // Moving an already-placed battery
  if (state.movingBatteryId !== null) {
    const bat = state.placedBatteries.find(b => b.id === state.movingBatteryId);
    if (bat) {
      if (xKm < FRIENDLY_X_MIN) { showToast('פרוס רק באזור הידידותי', 'warn'); state.movingBatteryId = null; canvas.style.cursor = ''; return; }
      bat.posX_km = xKm;
      bat.posY_km = yKm;
      showToast('סוללה הוזזה', 'success');
    }
    state.movingBatteryId = null;
    canvas.style.cursor = '';
    updateBatteryStatusPanel();
    updateLimitsUI();
    return;
  }

  // No unit selected → try selecting a placed battery for moving
  if (!state.selectedUnitId) {
    const hit = findBatteryNear(xKm, yKm);
    if (hit) {
      state.movingBatteryId = hit.id;
      canvas.style.cursor = 'move';
      const def = INTERCEPTOR_DEFS[hit.defId] || RADAR_DEFS[hit.defId];
      showToast(`${def?.name || hit.defId} — לחץ על מיקום חדש להזזה`, 'info');
    }
    return;
  }

  const unitId = state.selectedUnitId;
  const isInterceptor = !!INTERCEPTOR_DEFS[unitId];
  const def = isInterceptor ? INTERCEPTOR_DEFS[unitId] : RADAR_DEFS[unitId];
  if (!def) return;

  if (getAvailable(unitId) <= 0) {
    showToast(`אין יותר ${def.name} לפריסה`, 'warn');
    return;
  }

  const battery = {
    id: Date.now() + Math.random(),
    defId: unitId,
    type: isInterceptor ? 'interceptor' : 'radar',
    posX_km: xKm,
    posY_km: yKm,
    ammoRemaining: isInterceptor ? def.magazine : 0,
    maxAmmo: isInterceptor ? def.magazine : 0,
    activeEngagements: 0,
    reloading: false, reloadTimer: 0,
    active: true,
  };

  state.placedBatteries.push(battery);
  updateLimitsUI();
  updateBatteryStatusPanel();
  if (state.phase === 'idle') { state.phase = 'deploy'; updatePhaseBadge(); }
  showToast(`${def.name} נפרס`, 'success');
}

function handleAttackClick(xKm, yKm, px, py) {
  if (state.attackPhase === 'launcher') {
    const unitId = state.selectedUnitId;
    if (!unitId || !THREAT_DEFS[unitId]) { showToast('בחר טיל תחילה', 'warn'); return; }
    if (xKm > ENEMY_X_MAX) { showToast('שגר רק מאזור האויב (צד שמאל)', 'warn'); return; }
    const limit = state.attackLimits[unitId] || 0;
    const used  = state.attackPlanned.filter(p => p.defId === unitId).length;
    if (used >= limit) { showToast(`הגעת לתקרת הקצאת ${THREAT_DEFS[unitId].name} (${limit})`, 'warn'); return; }
    state.pendingLaunchX_km = xKm;
    state.pendingLaunchY_km = yKm;
    state.attackPhase = 'target';
    setCanvasHint('עכשיו לחץ על יעד (אייקון) בצד ימין');
    showToast('בחר יעד', 'info');
  } else {
    const target = findTargetNear(xKm, yKm);
    if (!target) { showToast('לחץ ישירות על אייקון יעד', 'warn'); return; }
    const unitId = state.selectedUnitId;
    const def = THREAT_DEFS[unitId];
    state.attackPlanned.push({ defId:unitId, launchX_km:state.pendingLaunchX_km, launchY_km:state.pendingLaunchY_km, targetId:target.id });
    state.attackPhase = 'launcher';
    state.pendingLaunchX_km = null;
    state.pendingLaunchY_km = null;
    updateLimitsUI();
    setCanvasHint(`${def.name} → ${target.name} (${state.attackPlanned.length} טילים מתוכננים). הוסף עוד או לחץ שגר.`);
    showToast(`${def.name} מכוון ל${target.name}`, 'success');
  }
}

function findBatteryNear(xKm, yKm) {
  const threshold = (100 / canvas.width) * MAP_W_KM;
  return state.placedBatteries.find(b =>
    Math.hypot(b.posX_km - xKm, (b.posY_km ?? MAP_D_KM*0.5) - (yKm ?? MAP_D_KM*0.5)) < threshold
  ) || null;
}

function findTargetNear(xKm, yKm) {
  return TARGETS.find(t => Math.hypot(t.posX_km - xKm, t.posY_km - (yKm ?? MAP_D_KM*0.5)) < 120);
}

// ── RESET ──────────────────────────────────────────────────────────────────
function resetDeploy() {
  state.placedBatteries = [];
  state.attackPlanned   = [];
  state.attackPhase     = 'launcher';
  state.pendingLaunchX_km = null;
  state.pendingLaunchY_km = null;
  state.movingBatteryId   = null;
  state.selectedUnitId    = null;
  state.threats         = [];
  state.interceptorMissiles = [];
  state.particles       = [];
  state.labels          = [];
  state.simPlaying      = false;
  document.querySelectorAll('.unit-card').forEach(c => c.classList.remove('selected'));
  applyDifficulty();
  state.phase = 'idle';
  updatePhaseBadge();
  updateBatteryStatusPanel();
  applyScenario();
}

function resetToIdle() {
  state.phase = 'idle';
  state.scenario = 'defense';
  state.difficulty = 'medium';
  state.placedBatteries = [];
  state.threats = [];
  state.interceptorMissiles = [];
  state.particles = []; state.labels = [];
  state.simHistory = [];
  state.stats = { intercepts:0, hits:0, score:0, shotsFired:0 };
  state.targetStatus = {};
  state.waves = []; state.currentWaveIdx = 0; state.nextWaveTimer = 0;
  state.attackPlanned = []; state.attackPhase = 'launcher'; state.pendingLaunchX_km = null; state.pendingLaunchY_km = null;
  state.movingBatteryId = null;
  TARGETS.forEach(t => state.targetStatus[t.id] = 'safe');
  applyDifficulty();
  updatePhaseBadge();
  updateHUD();
  updateBatteryStatusPanel();
  document.getElementById('scrubber').classList.add('hidden');
  applyScenario();
  setCanvasHint('בחר תרחיש ורמת קושי, ואז פרוס כוחות על המפה');
}

// ── NEW GAME ───────────────────────────────────────────────────────────────
function confirmNewGame() {
  state.scenario   = state.ngScenario;
  state.difficulty = state.ngDifficulty;
  resetView();
  closeModal('modal-new-game');
  document.querySelectorAll('#scenario-select .scenario-card').forEach(c =>
    c.classList.toggle('selected', c.dataset.scenario === state.scenario)
  );
  document.querySelectorAll('#sidebar .diff-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.diff === state.difficulty)
  );
  resetDeploy();
  applyScenario();
  applyDifficulty();
  showToast('משחק חדש — ' + DIFFICULTY[state.difficulty].label, 'info');
}

// ── SIMULATION SETUP ───────────────────────────────────────────────────────
function startSimulation() {
  if (state.phase === 'simulate') return;
  const diff = DIFFICULTY[state.difficulty];
  state.threats = [];
  state.interceptorMissiles = [];
  state.particles = []; state.labels = [];
  state.simHistory = [];
  state.stats = { intercepts:0, hits:0, score:0, shotsFired:0 };
  TARGETS.forEach(t => state.targetStatus[t.id] = 'safe');
  state.simTime = 0; state.simPlaying = true;

  if (state.scenario === 'defense') buildDefenseWaves(diff);
  else buildAttackSimulation(diff);

  computeMapH();
  state.phase = 'simulate';
  updatePhaseBadge();
  document.getElementById('canvas-hint').style.display = 'none';
  document.getElementById('scrubber').classList.remove('hidden');
  updateHUD();
}

function buildDefenseWaves(diff) {
  const speedMult = diff.speedMult;
  state.waves = diff.waves.map((waveDef, wi) => ({
    startTime: waveDef.startTime,
    count: waveDef.count,
    fired: false,
    threats: buildWaveThreats(waveDef.count, waveDef.pool, speedMult, wi),
  }));
  state.currentWaveIdx = 0;
}

function buildWaveThreats(count, pool, speedMult, waveIdx) {
  const threats = [];
  for (let i = 0; i < count; i++) {
    const defId = pool[i % pool.length];
    const def   = THREAT_DEFS[defId];
    const zone  = LAUNCH_ZONES[def.launchZone];
    const launchX = zone[i % zone.length] + (Math.random()-0.5)*50;
    const launchY = MAP_D_KM * 0.12 + Math.random() * MAP_D_KM * 0.76;
    const target  = TARGETS[(waveIdx * 3 + i) % TARGETS.length];
    const targetX = target.posX_km + (Math.random()-0.5)*80;
    const targetY = target.posY_km + (Math.random()-0.5) * 60;
    const actualDist = Math.abs(targetX - launchX);
    // Arc height: max of missile's nominal range and actual travel distance,
    // so SCUD arcing to a far target looks proportional, ICBMs always go high.
    const hmax    = Math.max(def.rangekm, actualDist) * 0.18;
    const duration = (20000 + Math.random()*8000) / speedMult;
    threats.push({
      id: Date.now()+Math.random()+i,
      defId, def,
      launchX_km: launchX,
      launchY_km: launchY,
      targetX_km: targetX,
      targetY_km: targetY,
      targetId: target.id,
      hmax,
      duration,
      elapsed: 0,
      t: 0,
      posX_km: launchX, posY_km: launchY, altKm: 0,
      active: true, intercepted: false, hit: false,
      detected: false, detectedTime: -1,
      engagedBy: new Set(),
      shotsReceived: 0, penetrationReasons: [],
      trail: [],
    });
  }
  return threats;
}

function buildAttackSimulation(diff) {
  const speedMult = diff.speedMult;
  const noIntel   = diff.noIntel;

  state.attackPlanned.forEach((plan, i) => {
    const def    = THREAT_DEFS[plan.defId];
    const target = TARGETS.find(t => t.id === plan.targetId) || TARGETS[0];
    const hmax   = def.rangekm * 0.18;
    const duration = (20000 + i * 1500) / speedMult;
    state.threats.push({
      id: Date.now()+Math.random()+i,
      defId: plan.defId, def,
      launchX_km: plan.launchX_km,
      launchY_km: plan.launchY_km ?? MAP_D_KM * 0.5,
      targetX_km: target.posX_km,
      targetY_km: target.posY_km,
      targetId: plan.targetId,
      hmax, duration,
      elapsed: i * 1200, t: 0,
      posX_km: plan.launchX_km, posY_km: plan.launchY_km ?? MAP_D_KM * 0.5, altKm: 0,
      active: true, intercepted: false, hit: false,
      detected: false, detectedTime: -1,
      engagedBy: new Set(),
      shotsReceived: 0, penetrationReasons: [],
      trail: [],
    });
  });

  // AI defense batteries
  const aiDefs = ['pac3','arrow2','thaad'];
  const aiCount = { easy:4, medium:6, hard:8, extreme:12 }[state.difficulty];
  state.placedBatteries = [];
  for (let i = 0; i < aiCount; i++) {
    const defId = aiDefs[i % aiDefs.length];
    const def   = INTERCEPTOR_DEFS[defId];
    const t     = TARGETS[i % TARGETS.length];
    const posX  = t.posX_km + (Math.random()-0.5)*200;
    const posY  = MAP_D_KM * 0.1 + Math.random() * MAP_D_KM * 0.8;
    state.placedBatteries.push({
      id:'ai-'+i, defId, type:'interceptor',
      posX_km: posX, posY_km: posY,
      ammoRemaining: def.magazine, maxAmmo: def.magazine,
      activeEngagements: 0,
      reloading: false, reloadTimer: 0,
      active: true,
      hidden: noIntel,
    });
  }
  state.waves = [];
}

// ── SIMULATION LOOP ────────────────────────────────────────────────────────
function renderLoop(ts) {
  requestAnimationFrame(renderLoop);
  let dt = 0;
  if (state.simPlaying && state.phase === 'simulate') {
    dt = Math.min(ts - (state.simLastTs||ts), 100) * state.simSpeed;
  }
  state.simLastTs = ts;

  if (state.phase === 'simulate' && state.simPlaying) {
    state.simTime += dt;
    updateWaves(dt);
    updateDetection();
    autoEngageThreats();
    updateThreats(dt);
    updateInterceptorMissiles(dt);
    updateReload(dt);
    updateParticles(dt);
    updateLabels(dt);
    updateHUD();

    if (!state.simHistory.length || state.simTime - state.simHistory[state.simHistory.length-1].t > 500)
      state.simHistory.push(snapshotState());

    if (state.threats.every(t => !t.active) && allWavesFired())
      endSimulation();
  }

  drawFrame();
}

// ── WAVE MANAGEMENT ────────────────────────────────────────────────────────
function updateWaves(dt) {
  if (!state.waves.length) return;
  if (state.currentWaveIdx >= state.waves.length) return;

  const wave = state.waves[state.currentWaveIdx];
  if (!wave.fired && state.simTime >= wave.startTime) {
    wave.fired = true;
    wave.threats.forEach(t => state.threats.push(t));
    showToast(`גל ${state.currentWaveIdx+1} — ${wave.count} איומים`, 'danger');
    state.currentWaveIdx++;
  }
}

function allWavesFired() {
  return state.waves.every(w => w.fired) || !state.waves.length;
}

function currentWaveLabel() {
  const total = state.waves.length;
  if (!total) return '';
  const fired = state.waves.filter(w=>w.fired).length;
  return `גל ${Math.min(fired, total)} / ${total}`;
}

function nextWaveIn() {
  if (state.currentWaveIdx >= state.waves.length) return 0;
  return Math.max(0, (state.waves[state.currentWaveIdx].startTime - state.simTime) / 1000);
}

// ── DETECTION ──────────────────────────────────────────────────────────────
function updateDetection() {
  state.threats.forEach(threat => {
    if (!threat.active || threat.detected) return;
    for (const b of state.placedBatteries) {
      if (!b.active) continue;
      const def = INTERCEPTOR_DEFS[b.defId] || RADAR_DEFS[b.defId];
      if (!def || !def.detRange) continue;
      const effRange = effectiveDetRange(b.defId, threat.defId, threat.t);
      const dist = Math.hypot(threat.posX_km - b.posX_km, threat.posY_km - b.posY_km);
      if (dist <= effRange) {
        threat.detected = true;
        threat.detectedTime = state.simTime;
        const pos = isoToCanvas(threat.posX_km, threat.posY_km, threat.altKm);
        addLabel(pos.x, pos.y - 18, '⚠ זוהה', C.orange, 2200);
        break;
      }
    }
  });
}

function effectiveDetRange(batteryDefId, threatDefId, t) {
  const def = INTERCEPTOR_DEFS[batteryDefId] || RADAR_DEFS[batteryDefId];
  if (!def || !def.detRange) return (RADAR_DEFS[batteryDefId]?.range || 0);
  const rcs     = THREAT_DEFS[threatDefId]?.rcs ?? 0.5;
  const stealth = THREAT_DEFS[threatDefId]?.stealthAscent ?? false;
  const speed   = THREAT_DEFS[threatDefId]?.speed ?? 1.5;
  // RCS exponent 0.4: ICBM (rcs=0.07) gets ~40% detection range vs SCUD (rcs=1.0)
  let range = def.detRange * Math.pow(rcs / 1.0, 0.4);
  // Stealth ascent: near-invisible until past boost phase
  if (stealth && t < 0.4) range *= 0.18;
  // High-speed targets harder to track via Doppler (minor effect)
  range *= Math.max(0.65, 1 - (speed - 1.5) * 0.04);
  return range;
}

// ── AUTO-ENGAGEMENT ────────────────────────────────────────────────────────
function autoEngageThreats() {
  const futureWaves = state.waves.slice(state.currentWaveIdx).filter(w => !w.fired).length;
  const conserveAmmo = futureWaves > 0;

  const threats = state.threats
    .filter(t => t.active && t.detected && !t.intercepted)
    .map(t => ({ t, pri: threatPriority(t) }))
    .sort((a,b) => b.pri - a.pri);

  for (const { t: threat } of threats) {
    const alreadyAssigned = state.interceptorMissiles.filter(im => im.threatId === threat.id && im.active).length;

    // Max simultaneous interceptors per threat scales with target value
    const tgt = TARGETS.find(t => t.id === threat.targetId);
    const tgtVal = tgt ? tgt.value : 10;
    const maxPerThreat = tgtVal >= 25 ? 3 : 2; // minimum 2 for all targets
    if (alreadyAssigned >= maxPerThreat) continue;

    // Sort batteries by PK descending (best system first)
    const candidates = state.placedBatteries
      .filter(b => canEngage(b, threat))
      .sort((a,b) => (PK_MATRIX[b.defId]?.[threat.defId]??0) - (PK_MATRIX[a.defId]?.[threat.defId]??0));

    for (const battery of candidates) {
      const pk = PK_MATRIX[battery.defId]?.[threat.defId] ?? 0;
      if (pk < PK_MIN_THRESHOLD) continue; // system not effective against this threat type

      // Ammo conservation: hold back low-ammo batteries if future waves are coming and threat already engaged
      if (conserveAmmo && battery.ammoRemaining <= 2 && alreadyAssigned > 0) continue;

      fireInterceptor(battery, threat);
      break; // one shot per threat per engagement cycle
    }
  }
}

// Scan the threat's future trajectory for a valid intercept point within this battery's envelope.
// Travel time is proportional to distance/MAP_W, scaled to threat.duration so interceptors arrive in time.
function computeIntercept(battery, threat) {
  const def = INTERCEPTOR_DEFS[battery.defId];
  if (!def) return null;
  const remainingMs = (1 - threat.t) * threat.duration;
  const STEPS = 80;
  for (let s = 1; s <= STEPS; s++) {
    const fp = threat.t + s * (1 - threat.t) / STEPS;
    if (fp >= 0.998) break;
    const tx  = threat.launchX_km + fp * (threat.targetX_km - threat.launchX_km);
    const ty  = threat.launchY_km + fp * (threat.targetY_km - threat.launchY_km);
    const ta  = Math.max(0, 4 * threat.hmax * fp * (1 - fp));
    if (fp < 0.5) continue;
    if (Math.hypot(tx - battery.posX_km, ty - battery.posY_km) > def.range) continue;
    if (ta < def.altMin || ta > def.altMax) continue;
    const dist3d   = Math.hypot(tx - battery.posX_km, ty - battery.posY_km, ta);
    const travelMs = Math.max(1000, (dist3d / MAP_W_KM) * threat.duration * 0.90);
    const timeToFp = (fp - threat.t) * threat.duration;
    if (travelMs <= timeToFp + 600 && travelMs < remainingMs - 200) {
      return { targetX_km: tx, targetY_km: ty, targetAlt_km: ta, travelTime: travelMs };
    }
  }
  return null;
}

function canEngage(battery, threat) {
  if (!battery.active || battery.reloading) return false;
  if (battery.ammoRemaining <= 0) return false;
  const def = INTERCEPTOR_DEFS[battery.defId];
  if (!def) return false;
  if (battery.activeEngagements >= def.maxSim) return false;
  if (threat.engagedBy.has(battery.id)) return false;
  return computeIntercept(battery, threat) !== null;
}

function threatPriority(threat) {
  const tgt = TARGETS.find(t => t.id === threat.targetId);
  const val = tgt ? tgt.value : 10;
  const severity = THREAT_SEVERITY[threat.defId] ?? 1.0;
  const timeLeft = Math.max(0.1, (1 - threat.t) * threat.duration / 1000);
  const alreadyEngaged = state.interceptorMissiles.filter(im => im.threatId === threat.id && im.active).length;
  const engagePenalty = alreadyEngaged > 0 ? 0.45 : 1.0;
  return (val * severity * engagePenalty) / timeLeft;
}

function fireInterceptor(battery, threat) {
  const def = INTERCEPTOR_DEFS[battery.defId];
  const ic  = computeIntercept(battery, threat) || {
    targetX_km: threat.posX_km, targetY_km: threat.posY_km, targetAlt_km: threat.altKm,
    travelTime: Math.max(1500, (Math.hypot(threat.posX_km - battery.posX_km, threat.posY_km - battery.posY_km, threat.altKm) / MAP_W_KM) * threat.duration * 1.0),
  };

  state.interceptorMissiles.push({
    id: Date.now()+Math.random(),
    batteryId: battery.id,
    threatId:  threat.id,
    defId:     battery.defId,
    color:     def.color,
    startX_km: battery.posX_km, startY_km: battery.posY_km, startAlt_km: 0,
    targetX_km: ic.targetX_km, targetY_km: ic.targetY_km ?? battery.posY_km, targetAlt_km: ic.targetAlt_km,
    posX_km: battery.posX_km, posY_km: battery.posY_km, altKm: 0,
    travelTime: ic.travelTime, elapsed: 0,
    active: true, trail: [],
  });

  battery.ammoRemaining--;
  battery.activeEngagements++;
  state.stats.shotsFired++;
  threat.engagedBy.add(battery.id);
  threat.shotsReceived++;

  if (battery.ammoRemaining <= 0) {
    battery.reloading = true;
    battery.reloadTimer = def.reloadTime;
    showToast(`${def.name} — מגזין ריק, טוען...`, 'warn');
  }
  updateBatteryStatusPanel();
}

// ── THREAT UPDATE ──────────────────────────────────────────────────────────
function updateThreats(dt) {
  state.threats.forEach(threat => {
    if (!threat.active) return;
    threat.elapsed += dt;
    if (threat.elapsed < 0) return;

    const progress = Math.min(1, threat.elapsed / threat.duration);
    threat.t = progress;
    threat.posX_km = threat.launchX_km + progress * (threat.targetX_km - threat.launchX_km);
    threat.posY_km = threat.launchY_km + progress * (threat.targetY_km - threat.launchY_km);
    threat.altKm   = Math.max(0, 4 * threat.hmax * progress * (1 - progress));

    const pos = isoToCanvas(threat.posX_km, threat.posY_km, threat.altKm);
    threat.trail.push({ x:pos.x, y:pos.y });
    if (threat.trail.length > 14) threat.trail.shift();

    if (progress >= 1 && !threat.intercepted) {
      threat.active = false;
      threat.hit = true;
      threat.penetrationReasons = analyzePenetration(threat);
      state.targetStatus[threat.targetId] = 'hit';
      state.stats.hits++;
      const p = isoToCanvas(threat.targetX_km, threat.targetY_km, 0);
      spawnExplosion(p.x, p.y, C.red, 40);
      addLabel(p.x, p.y-36, 'נפגע ✗', C.red, 3500);
      showToast(`${threat.def.name} פגע ב${TARGETS.find(t=>t.id===threat.targetId)?.name||'יעד'}!`, 'danger');
    }
  });
}

// ── INTERCEPTOR MISSILE UPDATE ──────────────────────────────────────────────
function updateInterceptorMissiles(dt) {
  state.interceptorMissiles.forEach(im => {
    if (!im.active) return;
    im.elapsed += dt;
    const t = Math.min(1, im.elapsed / im.travelTime);

    // Home on target: update aim point to threat's current position so the
    // interceptor visually reaches the threat rather than a stale predicted point.
    const liveTarget = state.threats.find(th => th.id === im.threatId && th.active);
    if (liveTarget) {
      im.targetX_km  = liveTarget.posX_km;
      im.targetY_km  = liveTarget.posY_km;
      im.targetAlt_km = liveTarget.altKm;
    }

    im.posX_km = im.startX_km + t*(im.targetX_km - im.startX_km);
    im.posY_km = im.startY_km + t*(im.targetY_km - im.startY_km);
    im.altKm   = im.startAlt_km + t*(im.targetAlt_km - im.startAlt_km);

    const pos = isoToCanvas(im.posX_km, im.posY_km, im.altKm);
    im.trail.push({ x:pos.x, y:pos.y });
    if (im.trail.length > 10) im.trail.shift();

    if (t >= 1) {
      im.active = false;
      resolveIntercept(im);
    }
  });
}

function resolveIntercept(im) {
  const battery = state.placedBatteries.find(b => b.id === im.batteryId);
  if (battery) battery.activeEngagements = Math.max(0, battery.activeEngagements-1);

  const threat = state.threats.find(t => t.id===im.threatId && t.active && !t.intercepted);
  if (!threat) return;

  // Descent-only rule: interceptor arrived while threat is still ascending — abort, allow retry
  if (threat.t < 0.5) {
    if (battery) threat.engagedBy.delete(battery.id);
    return;
  }

  // Radar guidance: need self-radar OR an external radar battery covering the threat right now
  const selfRange = battery ? effectiveDetRange(battery.defId, threat.defId, threat.t) : 0;
  const selfDist  = battery ? Math.hypot(threat.posX_km - battery.posX_km, (threat.posY_km ?? MAP_D_KM*0.5) - (battery.posY_km ?? MAP_D_KM*0.5)) : Infinity;
  const hasRadarContact = selfDist <= selfRange || state.placedBatteries.some(b => {
    if (b.type !== 'radar') return false;
    const rd = RADAR_DEFS[b.defId];
    if (!rd) return false;
    return Math.hypot(threat.posX_km - b.posX_km, (threat.posY_km ?? MAP_D_KM*0.5) - (b.posY_km ?? MAP_D_KM*0.5)) <= rd.range;
  });
  if (!hasRadarContact) {
    if (battery) threat.engagedBy.delete(battery.id);
    const pos = isoToCanvas(im.targetX_km, im.targetY_km ?? MAP_D_KM*0.5, im.targetAlt_km);
    spawnExplosion(pos.x, pos.y, C.orange, 14);
    addLabel(pos.x, pos.y - 20, 'אבד מגע מכ"מ ✗', C.orange, 2800);
    showToast(`${INTERCEPTOR_DEFS[im.defId]?.name||''} — אבד מגע מכ"מ`, 'warn');
    return;
  }

  const basePk   = PK_MATRIX[im.defId]?.[threat.defId] ?? 0.5;
  const rcsMod   = threat.def.rcs < 0.2 ? 0.82 : 1.0;
  const manoMod  = threat.def.termManeuver ? 0.75 : 1.0;
  const finalPk  = Math.min(0.97, basePk * rcsMod * manoMod);
  const pos      = isoToCanvas(im.targetX_km, im.targetY_km ?? MAP_D_KM*0.5, im.targetAlt_km);

  if (Math.random() < finalPk) {
    threat.active = false;
    threat.intercepted = true;
    state.stats.intercepts++;
    spawnExplosion(pos.x, pos.y, C.green, 26);
    addLabel(pos.x, pos.y-24, 'נוטרל ✓', C.green, 2800);
    showToast(`${threat.def.name} נוטרל! PK=${Math.round(finalPk*100)}%`, 'success');
  } else {
    // Clear this battery from engagedBy so it (and any system) can retry
    if (battery) threat.engagedBy.delete(battery.id);
    spawnExplosion(pos.x, pos.y, C.orange, 12);
    addLabel(pos.x, pos.y-18, `החטיא (${Math.round(finalPk*100)}%)`, C.orange, 2000);
    showToast(`${INTERCEPTOR_DEFS[im.defId].name} החטיא — PK=${Math.round(finalPk*100)}%`, 'warn');
  }
  updateBatteryStatusPanel();
}

// ── RELOAD ─────────────────────────────────────────────────────────────────
function updateReload(dt) {
  state.placedBatteries.forEach(b => {
    if (!b.reloading) return;
    b.reloadTimer -= dt;
    if (b.reloadTimer <= 0) {
      b.reloading = false;
      b.reloadTimer = 0;
      b.ammoRemaining = b.maxAmmo;
      showToast(`${(INTERCEPTOR_DEFS[b.defId]||{}).name||''} — טעינה הושלמה`, 'info');
      updateBatteryStatusPanel();
    }
  });
}

// ── PARTICLES / LABELS ─────────────────────────────────────────────────────
function spawnExplosion(x, y, color, size) {
  for (let i=0; i<22; i++) {
    const a = Math.random()*Math.PI*2;
    const v = 1 + Math.random()*3;
    state.particles.push({ x,y, vx:Math.cos(a)*v, vy:Math.sin(a)*v, r:size*(0.3+Math.random()*0.7), life:1.0, decay:0.02+Math.random()*0.04, color });
  }
}
function updateParticles(dt) {
  const s = dt/1000;
  state.particles = state.particles.filter(p=>p.life>0);
  state.particles.forEach(p=>{ p.x+=p.vx*s*60; p.y+=p.vy*s*60; p.vx*=0.95; p.vy*=0.95; p.life-=p.decay*s*60; p.r*=0.97; });
}
function addLabel(x, y, text, color, dur) {
  state.labels.push({ x,y,text,color,life:dur,maxLife:dur });
}
function updateLabels(dt) {
  state.labels = state.labels.filter(l=>l.life>0);
  state.labels.forEach(l=>{ l.life-=dt; l.y-=0.25; });
}

// ── END SIMULATION ─────────────────────────────────────────────────────────
function analyzePenetration(threat) {
  const reasons = [];
  if (!threat.detected) {
    reasons.push({ type:'nodetect', text:'לא זוהה על ידי מכ"ם — עבר ללא גילוי' });
    return reasons;
  }
  const interceptors = state.placedBatteries.filter(b => b.type === 'interceptor');
  const tyKm = threat.targetY_km ?? MAP_D_KM * 0.5;
  const inAltitude = interceptors.filter(b => {
    const def = INTERCEPTOR_DEFS[b.defId];
    return threat.hmax >= def.altMin && threat.hmax <= def.altMax * 1.5;
  });
  const inRange = inAltitude.filter(b => {
    const def = INTERCEPTOR_DEFS[b.defId];
    return Math.hypot(threat.targetX_km - b.posX_km, tyKm - (b.posY_km ?? MAP_D_KM * 0.5)) <= def.range;
  });

  if (threat.shotsReceived === 0) {
    if (interceptors.length === 0) {
      reasons.push({ type:'nobattery', text:'לא פרוסות סוללות יירוט כלל' });
    } else if (inAltitude.length === 0) {
      reasons.push({ type:'noalt', text:`אין סוללה המכסה גובה שיא ${Math.round(threat.hmax)} km — נדרש ${threat.hmax > 150 ? 'THAAD / SM-3 / Arrow-3' : 'Arrow-2 / THAAD'}` });
    } else if (inRange.length === 0) {
      reasons.push({ type:'norange', text:'סוללות קיימות אך מחוץ לטווח גיאוגרפי — נדרשת פריסה קדמית' });
    } else {
      const withAmmo = inRange.filter(b => b.ammoRemaining > 0);
      if (withAmmo.length === 0) {
        reasons.push({ type:'noammo', text:'כל הסוללות בטווח מוצו מתחמושת — נדרשות שכבות נוספות' });
      } else {
        reasons.push({ type:'assign', text:'סוללות זמינות לא הוקצו — ייתכן עיכוב תגובה אוטומטית' });
      }
    }
  } else {
    reasons.push({ type:'miss', text:`${threat.shotsReceived} מיירט${threat.shotsReceived > 1 ? 'ים' : ''} נורו — כולם החטיאו (כישלון הסתברותי)` });
    if (threat.def.termManeuver) reasons.push({ type:'maneuver', text:'תמרון סיומי הפחית משמעותית את הסתברות היירוט' });
    if (threat.def.rcs < 0.2)    reasons.push({ type:'stealth',  text:'חתך מכ"ם נמוך — הקשה על כיוון המיירט' });
  }
  return reasons;
}

function generateRecommendations() {
  const recs = [];
  if (state.scenario !== 'defense') {
    const sc = state.stats.score;
    if (sc < 50) recs.push('ריכז טילים על יעדים בעלי ערך גבוה במקום פיזור');
    if (sc < 80) recs.push('שגר גלי מטח — מספר טילים בו-זמנית מכביד על מערך ההגנה');
    recs.push('Shahab-3/Ghadr-1 קשים יותר לגילוי ולמניעה בשל חתך מכ"ם נמוך');
    return recs;
  }
  const hitThreats = state.threats.filter(t => t.hit);
  if (hitThreats.length === 0) { recs.push('ביצוע מושלם — ללא המלצות שיפור.'); return recs; }

  const types = new Set(hitThreats.flatMap(t => t.penetrationReasons.map(r => r.type)));
  if (types.has('nodetect'))  recs.push('הוסף מכ"מים (Green Pine, X-Band) — הגדל אזור גילוי מוקדם');
  if (types.has('noalt'))     recs.push('הוסף שכבת יירוט גובה-ביניים / גובה-גבוה (THAAD, SM-3, Arrow-3)');
  if (types.has('norange'))   recs.push('פרוס סוללות לעומק אמצע המפה — הגדל כיסוי גיאוגרפי קדמי');
  if (types.has('noammo'))    recs.push('הכפל סוללות בצמתי מפגש — שכבה שנייה כגיבוי כשהראשונה מתרוקנת');
  if (types.has('miss'))      recs.push('הוסף שכבת יירוט שנייה — ירי כפול מגדיל הסתברות כוללת ל-90%+');
  if (types.has('maneuver'))  recs.push('לאיומים עם תמרון סיומי — יירוט מוקדם בשלב הירידה בלבד (fp>0.5)');
  if (types.has('stealth'))   recs.push('לאיומים עם חתך מכ"ם נמוך — קרב X-Band ל-300 km+ לגילוי מוקדם');

  const hitHighVal = hitThreats.filter(t => (TARGETS.find(tg => tg.id === t.targetId)?.value ?? 0) >= 3);
  if (hitHighVal.length > 0)  recs.push('הגן ביתר שאת על יעדים בעלי ערך גבוה — PAC-3 קרוב ליעד כהגנה אחרונה');
  return recs;
}

function endSimulation() {
  state.simPlaying = false;
  state.phase = 'replay';
  computeScore();
  updatePhaseBadge();
  updateHUD();
  showResultsModal();
}

function computeScore() {
  const totalVal = TARGETS.reduce((s,t)=>s+t.value,0);
  if (state.scenario === 'defense') {
    const saved = TARGETS.filter(t=>state.targetStatus[t.id]==='safe').reduce((s,t)=>s+t.value,0);
    state.stats.score = Math.round(saved/totalVal*100);
  } else {
    const hit = TARGETS.filter(t=>state.targetStatus[t.id]==='hit').reduce((s,t)=>s+t.value,0);
    state.stats.score = Math.round(hit/totalVal*100);
  }
}

function generateLessons() {
  const lessons = [];
  const sc = state.stats.score;
  const hitTargets   = TARGETS.filter(t => state.targetStatus[t.id] === 'hit');
  const safeTargets  = TARGETS.filter(t => state.targetStatus[t.id] === 'safe');

  if (state.scenario === 'defense') {
    if (sc === 100) {
      lessons.push('ביצוע מושלם — כל היעדים ניצלו.');
    } else {
      if (state.stats.shotsFired === 0) {
        lessons.push('אף מיירט לא נורה. פרוס סוללות קרוב למסלולי הטילים (האזור הירוק בצד ימין).');
      } else if (state.stats.intercepts === 0 && state.stats.shotsFired > 0) {
        lessons.push(`נורו ${state.stats.shotsFired} מיירטים אך אף אחד לא פגע — ודא התאמת גובה: PAC-3 ל-5–40km, THAAD ל-40–150km.`);
      } else if (sc < 50) {
        lessons.push('כיסוי הגנתי לקוי. שקול פריסת שכבות: PAC-3 קרוב ליעדים + Arrow-2/THAAD אמצע המפה.');
      }
      if (hitTargets.length > 0) {
        const names = hitTargets.map(t => t.name).join(' ו');
        lessons.push(`${names} נפגעו — הנח סוללות נוספות מול מסלולי ההתקפה לאזורים אלו.`);
      }
      const interceptors = state.placedBatteries.filter(b => b.type === 'interceptor');
      if (interceptors.length > 0) {
        const idleCount = interceptors.filter(b => b.ammoRemaining === b.maxAmmo).length;
        if (idleCount > 0) {
          lessons.push(`${idleCount} סוללות לא ירו כלל — בדוק שפרסת אותן בטווח גילוי ויירוט של מסלולי האיומים.`);
        }
      }
      if (state.stats.hits > 0 && state.stats.intercepts < state.stats.hits) {
        lessons.push('שיעור יירוט נמוך — הוסף שכבות הגנה מרובות ותחנות מכ"ם להגדלת אזור הגילוי.');
      }
    }
  } else {
    if (sc === 0) {
      lessons.push('כל הטילים יורטו. נסה מגוון גדול יותר של טילים, שגר ממספר נקודות שונות, או השתמש ב-Shahab-3/Ghadr-1 שקשה יותר לאתר.');
    } else if (sc < 50) {
      lessons.push('חלק מהיעדים הושמדו, אך אחרים שרדו. ריכז מספר טילים על יעדי ערך גבוה (בסיס צבאי, עיר גדולה).');
    } else if (sc < 90) {
      lessons.push('מתקפה חלקית מוצלחת. תקיפה בגלים תחת לחץ מערך ההגנה יכולה להגביר הצלחה.');
    }
    if (safeTargets.length > 0 && sc < 100) {
      const names = safeTargets.map(t => t.name).join(' ו');
      lessons.push(`${names} שרדו — נסה לכוון אליהם טילים מרובים בו-זמנית.`);
    }
  }
  return lessons;
}

function showResultsModal() {
  const sc = state.stats.score;
  const el = document.getElementById('res-score-val');
  el.textContent = sc;
  el.className = 'result-score-value '+(sc>=90?'excellent':sc>=70?'good':sc>=50?'ok':'fail');
  document.getElementById('res-stars').textContent = sc>=90?'★★★':sc>=70?'★★☆':sc>=50?'★☆☆':'☆☆☆';
  const vkey = sc>=90?'excellent':sc>=70?'good':sc>=50?'ok':'fail';
  const verd = { defense:{excellent:'הגנה מושלמת',good:'הגנה טובה',ok:'הגנה חלקית',fail:'הגנה כשלה'}, attack:{excellent:'מתקפה מוצלחת',good:'מתקפה טובה',ok:'מתקפה חלקית',fail:'מתקפה כשלה'} };
  document.getElementById('res-verdict').textContent = verd[state.scenario][vkey];

  const tbody = document.getElementById('res-table-body');
  tbody.innerHTML = '';
  TARGETS.forEach(t => {
    const hit = state.targetStatus[t.id]==='hit';
    const rowCls = state.scenario==='defense'?(hit?'hit':'save'):(hit?'save':'miss');
    tbody.innerHTML += `<tr class="${rowCls}"><td>${t.icon} ${t.name}</td><td>${t.value}</td><td>${hit?(state.scenario==='defense'?'✗ נפגע':'✓ הושמד'):(state.scenario==='defense'?'✓ ניצל':'✗ לא נפגע')}</td></tr>`;
  });
  document.getElementById('res-intercepts').textContent = state.stats.intercepts;
  document.getElementById('res-hits').textContent       = state.stats.hits;
  document.getElementById('res-shots').textContent      = state.stats.shotsFired;

  // Penetration analysis (defense: per hit-target; attack: per surviving target)
  const penEl = document.getElementById('res-penetration');
  const penSec = document.getElementById('res-penetration-section');
  if (penEl && state.scenario === 'defense') {
    const hitThreats = state.threats.filter(t => t.hit);
    if (hitThreats.length > 0 && penSec) penSec.style.display = '';
    penEl.innerHTML = hitThreats.map(t => {
      const tgt = TARGETS.find(tg => tg.id === t.targetId);
      const reasons = t.penetrationReasons.length ? t.penetrationReasons : [{ text:'לא ידוע' }];
      return `<div style="margin-bottom:10px;">
        <div style="font-weight:700;color:var(--red);font-size:13px;">${tgt?.icon||'🎯'} ${tgt?.name||t.targetId} — חדר ${t.def.name}</div>
        <ul style="margin:3px 0 0;padding-right:14px;font-size:12px;color:var(--muted);line-height:1.7;">
          ${reasons.map(r=>`<li>${r.text}</li>`).join('')}
        </ul></div>`;
    }).join('');
  }

  // Recommendations
  const recsEl = document.getElementById('res-recs');
  if (recsEl) {
    const recs = generateRecommendations();
    recsEl.innerHTML = recs.map(r => `<li>${r}</li>`).join('');
  }

  openModal('modal-results');
}

// ── REPLAY / SCRUBBER ──────────────────────────────────────────────────────
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
    threats: state.threats.map(t=>({...t, trail:[...t.trail], engagedBy:new Set(t.engagedBy)})),
    interceptorMissiles: state.interceptorMissiles.map(im=>({...im,trail:[...im.trail]})),
    particles: state.particles.map(p=>({...p})),
    stats: {...state.stats},
    targetStatus: {...state.targetStatus},
  };
}

function scrubTo(pct) {
  pct = Math.max(0,Math.min(1,pct));
  state.scrubPos = pct;
  applyScrubPos(pct);
}

function applyScrubPos(pct) {
  updateScrubUI(pct);
  if (!state.simHistory.length) return;
  const idx = Math.floor(pct*(state.simHistory.length-1));
  const snap = state.simHistory[idx]; if (!snap) return;
  state.threats = snap.threats.map(t=>({...t,trail:[...t.trail],engagedBy:new Set(t.engagedBy)}));
  state.interceptorMissiles = snap.interceptorMissiles.map(im=>({...im,trail:[...im.trail]}));
  state.particles = snap.particles.map(p=>({...p}));
  state.stats = {...snap.stats};
  state.targetStatus = {...snap.targetStatus};
  updateHUD();
  document.getElementById('scrub-time').textContent = fmtTime(snap.t/1000);
}

function updateScrubUI(pct) {
  document.getElementById('scrub-fill').style.width = (pct*100)+'%';
  document.getElementById('scrub-thumb').style.left  = (pct*100)+'%';
}

let _scrubInterval = null;
function toggleScrubPlay() {
  if (_scrubInterval) { clearInterval(_scrubInterval); _scrubInterval=null; document.getElementById('scrub-play').textContent='▶'; }
  else {
    document.getElementById('scrub-play').textContent='⏸';
    _scrubInterval = setInterval(()=>{
      if (state.scrubPos>=1){ clearInterval(_scrubInterval); _scrubInterval=null; document.getElementById('scrub-play').textContent='▶'; return; }
      state.scrubPos = Math.min(1, state.scrubPos + 0.005*state.simSpeed);
      applyScrubPos(state.scrubPos);
    }, 50);
  }
}

function fmtTime(s) { const m=Math.floor(s/60); return `${m}:${Math.floor(s%60).toString().padStart(2,'0')}`; }

// ── DRAW FRAME ─────────────────────────────────────────────────────────────
function drawFrame() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  drawBackground();
  drawGrid();
  drawTerritoryZones();
  drawTargets();
  if (!state.noIntel || state.scenario==='defense') drawBatteries();
  else if (state.phase==='idle'||state.phase==='deploy') drawBatteries();
  drawEngagementLines();
  drawInterceptorMissiles();
  drawThreats();
  drawParticles();
  drawLabels();
  drawWaveInfo();
  drawVersionWatermark();
  if (state.phase==='simulate'||state.phase==='replay') drawSimProgress();
  if ((state.phase==='idle'||state.phase==='deploy') && state.scenario==='attack' && state.attackPhase==='launcher') drawLaunchZoneMarker();
  if (state.scenario==='attack' && state.attackPhase==='target' && state.pendingLaunchX_km!=null) drawPendingLaunchMarker();
  drawAttackPlanned();
}

// ── BACKGROUND ─────────────────────────────────────────────────────────────
function drawBackground() {
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0,   '#000308');
  sky.addColorStop(0.3, '#020a18');
  sky.addColorStop(0.65,'#061428');
  sky.addColorStop(1,   '#0a1f3a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!state.starsSeeded) seedStars();
  const t = Date.now() * 0.001;
  state.stars.forEach(s => {
    const a = s.twinkle ? s.a * (0.7 + 0.3 * Math.sin(t * s.twinkle + s.phase)) : s.a;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`; ctx.fill();
  });

  const c0 = isoToCanvas(0, 0, 0);
  const c1 = isoToCanvas(MAP_W_KM, 0, 0);
  const c2 = isoToCanvas(MAP_W_KM, MAP_D_KM, 0);
  const c3 = isoToCanvas(0, MAP_D_KM, 0);

  ctx.beginPath();
  ctx.moveTo(c0.x, c0.y); ctx.lineTo(c1.x, c1.y);
  ctx.lineTo(c2.x, c2.y); ctx.lineTo(c3.x, c3.y);
  ctx.closePath();
  const grd = ctx.createLinearGradient(c0.x, c0.y, c3.x, c3.y);
  grd.addColorStop(0,   '#0d1c0d');
  grd.addColorStop(0.45,'#111f11');
  grd.addColorStop(1,   '#08120a');
  ctx.fillStyle = grd; ctx.fill();

  ctx.save();
  ctx.shadowColor = '#3a7a3a';
  ctx.shadowBlur = 18;
  ctx.strokeStyle = '#2a5c2a88'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(c0.x, c0.y); ctx.lineTo(c1.x, c1.y);
  ctx.lineTo(c2.x, c2.y); ctx.lineTo(c3.x, c3.y);
  ctx.closePath(); ctx.stroke();
  ctx.restore();

  const horizonY = Math.min(c0.y, c1.y, c2.y, c3.y);
  const hGrd = ctx.createLinearGradient(0, horizonY - 35, 0, horizonY + 15);
  hGrd.addColorStop(0,   'rgba(15,50,30,0)');
  hGrd.addColorStop(0.5, 'rgba(20,70,40,0.14)');
  hGrd.addColorStop(1,   'rgba(10,30,15,0)');
  ctx.fillStyle = hGrd;
  ctx.fillRect(0, horizonY - 35, canvas.width, 50);
}

function seedStars() {
  state.stars = [];
  const maxY = ISO.oy;
  for (let i = 0; i < 220; i++) {
    const bright = i < 12;
    state.stars.push({
      x: Math.random() * canvas.width,
      y: Math.random() * maxY * 0.88,
      r: bright ? Math.random() * 1.4 + 0.9 : Math.random() * 0.7 + 0.2,
      a: bright ? Math.random() * 0.4 + 0.5 : Math.random() * 0.45 + 0.2,
      twinkle: bright ? Math.random() * 2 + 1 : 0,
      phase: Math.random() * Math.PI * 2,
    });
  }
  state.starsSeeded = true;
}

// ── GRID ───────────────────────────────────────────────────────────────────
function drawGrid() {
  ctx.lineWidth = 0.5;

  for (let y = 0; y <= MAP_D_KM; y += 100) {
    const p1 = isoToCanvas(0, y, 0), p2 = isoToCanvas(MAP_W_KM, y, 0);
    ctx.strokeStyle = 'rgba(95,200,232,0.05)';
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
  }

  ctx.font = '9px Share Tech Mono, monospace';
  ctx.fillStyle = 'rgba(95,200,232,0.28)';
  [500,1000,1500,2000,2500].forEach(x => {
    const p1 = isoToCanvas(x, 0, 0), p2 = isoToCanvas(x, MAP_D_KM, 0);
    ctx.strokeStyle = 'rgba(95,200,232,0.05)';
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillText(x+'km', p1.x + 4, p1.y + 10);
  });

  const alts = [50, 100, 200, 400, 700, 1000];
  alts.forEach(alt => {
    const p1 = isoToCanvas(0, 0, alt);
    if (p1.y < 4) return;
    const p2 = isoToCanvas(MAP_W_KM, 0, alt);
    ctx.strokeStyle = 'rgba(95,200,232,0.06)';
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    ctx.fillStyle = 'rgba(95,200,232,0.30)';
    ctx.textAlign = 'left';
    ctx.fillText(alt+'km', p1.x + 2, p1.y - 2);
  });
}

// ── TERRITORY ZONES ────────────────────────────────────────────────────────
function drawZoneHatch(pts, color, step) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath(); ctx.clip();
  ctx.strokeStyle = color; ctx.lineWidth = 0.8;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const minX = Math.min(...xs) - 60, maxX = Math.max(...xs) + 60;
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = maxY - minY;
  for (let d = minX - span; d < maxX; d += step) {
    ctx.beginPath(); ctx.moveTo(d, minY); ctx.lineTo(d + span, maxY); ctx.stroke();
  }
  ctx.restore();
}

function drawTerritoryZones() {
  const eq = [
    isoToCanvas(0, 0, 0), isoToCanvas(ENEMY_X_MAX, 0, 0),
    isoToCanvas(ENEMY_X_MAX, MAP_D_KM, 0), isoToCanvas(0, MAP_D_KM, 0),
  ];
  ctx.beginPath(); ctx.moveTo(eq[0].x, eq[0].y);
  for (let i = 1; i < eq.length; i++) ctx.lineTo(eq[i].x, eq[i].y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(239,68,68,0.06)'; ctx.fill();
  drawZoneHatch(eq, 'rgba(239,68,68,0.07)', 24);
  ctx.beginPath(); ctx.moveTo(eq[0].x, eq[0].y);
  for (let i = 1; i < eq.length; i++) ctx.lineTo(eq[i].x, eq[i].y);
  ctx.closePath();
  ctx.strokeStyle = 'rgba(239,68,68,0.35)'; ctx.setLineDash([4,6]); ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);

  const fq = [
    isoToCanvas(FRIENDLY_X_MIN, 0, 0), isoToCanvas(MAP_W_KM, 0, 0),
    isoToCanvas(MAP_W_KM, MAP_D_KM, 0), isoToCanvas(FRIENDLY_X_MIN, MAP_D_KM, 0),
  ];
  ctx.beginPath(); ctx.moveTo(fq[0].x, fq[0].y);
  for (let i = 1; i < fq.length; i++) ctx.lineTo(fq[i].x, fq[i].y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(34,197,94,0.04)'; ctx.fill();
  drawZoneHatch(fq, 'rgba(34,197,94,0.06)', 24);
  ctx.beginPath(); ctx.moveTo(fq[0].x, fq[0].y);
  for (let i = 1; i < fq.length; i++) ctx.lineTo(fq[i].x, fq[i].y);
  ctx.closePath();
  ctx.strokeStyle = 'rgba(34,197,94,0.25)'; ctx.setLineDash([4,6]); ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);

  ctx.font = 'bold 12px Rajdhani, sans-serif'; ctx.textAlign = 'center';
  const el = isoToCanvas(ENEMY_X_MAX / 2, MAP_D_KM * 0.5, 5);
  ctx.fillStyle = 'rgba(239,68,68,0.6)'; ctx.fillText('אזור שיגור', el.x, el.y);
  const fl = isoToCanvas((FRIENDLY_X_MIN + MAP_W_KM) / 2, MAP_D_KM * 0.5, 5);
  ctx.fillStyle = 'rgba(34,197,94,0.6)'; ctx.fillText('אזור מוגן', fl.x, fl.y);
}

// ── TARGETS ────────────────────────────────────────────────────────────────
function drawTargets() {
  TARGETS.forEach(t => {
    const hit = state.targetStatus[t.id]==='hit';
    const col = hit ? C.red : C.green;
    const pos = isoToCanvas(t.posX_km, t.posY_km, 0);
    const top = isoToCanvas(t.posX_km, t.posY_km, 8);

    ctx.strokeStyle = col+'44'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pos.x, pos.y); ctx.lineTo(top.x, top.y); ctx.stroke();

    ctx.font = '15px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.globalAlpha = hit ? 0.4 : 0.95;
    ctx.fillText(t.icon, top.x, top.y);
    ctx.globalAlpha = 1;

    ctx.font = 'bold 10px Rajdhani, sans-serif'; ctx.textBaseline = 'top';
    ctx.fillStyle = col;
    ctx.fillText(t.name, pos.x, pos.y + 4);
    ctx.font = '9px Share Tech Mono, monospace';
    ctx.fillStyle = col + 'aa';
    ctx.fillText('✦' + t.value, pos.x, pos.y + 16);
    ctx.textBaseline = 'alphabetic';

    if (hit) {
      ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = C.red; ctx.textBaseline = 'bottom';
      ctx.fillText('✗', top.x + 8, top.y); ctx.textBaseline = 'alphabetic';
    }
  });
}

// ── ENGAGEMENT LINES ────────────────────────────────────────────────────────
function drawEngagementLines() {
  state.interceptorMissiles.forEach(im => {
    if (!im.active) return;
    const battery = state.placedBatteries.find(b => b.id === im.batteryId);
    if (!battery) return;
    const bPos = isoToCanvas(battery.posX_km, battery.posY_km, 0);
    const mPos = isoToCanvas(im.posX_km, im.posY_km, im.altKm);
    ctx.strokeStyle = (im.color || C.blue)+'28'; ctx.lineWidth = 0.7;
    ctx.setLineDash([2, 8]);
    ctx.beginPath(); ctx.moveTo(bPos.x, bPos.y); ctx.lineTo(mPos.x, mPos.y); ctx.stroke();
    ctx.setLineDash([]);
  });
}

// ── BATTERIES ──────────────────────────────────────────────────────────────
function drawBatteries() {
  state.placedBatteries.forEach(b => {
    if (b.hidden && state.noIntel) return;
    const isInterceptor = b.type === 'interceptor';
    const def = isInterceptor ? INTERCEPTOR_DEFS[b.defId] : RADAR_DEFS[b.defId];
    if (!def) return;
    const pos = isoToCanvas(b.posX_km, b.posY_km ?? MAP_D_KM*0.5, 0);
    const col = def.color;

    if (state.showRanges) {
      const bX = b.posX_km, bY = b.posY_km ?? MAP_D_KM * 0.5;
      const FACE = Math.PI;        // threats from left (-X)
      const HALF = Math.PI / 3;    // ±60° → 120° sector
      const A0 = FACE - HALF, A1 = FACE + HALF;
      const N  = 20;

      // Horizontal arc at fixed altitude
      function hArc(r, alt, move) {
        for (let i = 0; i <= N; i++) {
          const a = A0 + (A1 - A0) * i / N;
          const p = isoToCanvas(bX + r * Math.cos(a), bY + r * Math.sin(a), alt);
          if (move && i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
      }

      // Vertical quarter-circle arc along a given bearing — traces ground → apex
      function vArc(angle, radius) {
        for (let i = 0; i <= N; i++) {
          const theta = (Math.PI / 2) * i / N;          // 0..90°
          const h   = radius * Math.cos(theta);          // horiz distance
          const alt = radius * Math.sin(theta);          // altitude
          const p = isoToCanvas(bX + h * Math.cos(angle), bY + h * Math.sin(angle), alt);
          if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
      }

      // ── Intercept envelope ──────────────────────────────────────────────────
      if (isInterceptor && def.altMin !== undefined) {
        const R   = def.range;
        const col = def.color;

        // Ground sector (footprint)
        const base0 = isoToCanvas(bX, bY, 0);
        ctx.beginPath(); ctx.moveTo(base0.x, base0.y);
        hArc(R, 0, false);
        ctx.closePath();
        ctx.fillStyle = col + '0c'; ctx.fill();
        ctx.strokeStyle = col + '38'; ctx.lineWidth = 1; ctx.setLineDash([4, 7]); ctx.stroke(); ctx.setLineDash([]);

        // Ceiling arc at altMax
        ctx.beginPath(); hArc(R, def.altMax, true);
        ctx.strokeStyle = col + '65'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 5]); ctx.stroke(); ctx.setLineDash([]);

        // Floor arc at altMin
        ctx.beginPath(); hArc(R, def.altMin, true);
        ctx.strokeStyle = col + '38'; ctx.lineWidth = 1; ctx.setLineDash([2, 8]); ctx.stroke(); ctx.setLineDash([]);

        // Vertical walls at sector edges + centre
        ctx.lineWidth = 1; ctx.setLineDash([2, 8]);
        [A0, A1, FACE].forEach(a => {
          const ex = bX + R * Math.cos(a), ey = bY + R * Math.sin(a);
          const g = isoToCanvas(ex, ey, def.altMin);
          const t = isoToCanvas(ex, ey, def.altMax);
          ctx.strokeStyle = col + '30';
          ctx.beginPath(); ctx.moveTo(g.x, g.y); ctx.lineTo(t.x, t.y); ctx.stroke();
          // ground to altMin
          const gr = isoToCanvas(ex, ey, 0);
          ctx.strokeStyle = col + '18';
          ctx.beginPath(); ctx.moveTo(gr.x, gr.y); ctx.lineTo(g.x, g.y); ctx.stroke();
        });
        ctx.setLineDash([]);
      }

      // ── Detection bubble (sphere) ───────────────────────────────────────────
      const detRange = isInterceptor ? def.detRange : def.range;
      if (detRange) {
        // Ground sector
        const base1 = isoToCanvas(bX, bY, 0);
        ctx.beginPath(); ctx.moveTo(base1.x, base1.y);
        hArc(detRange, 0, false);
        ctx.closePath();
        ctx.fillStyle = '#5fc8e807'; ctx.fill();
        ctx.strokeStyle = '#5fc8e840'; ctx.lineWidth = 1.2; ctx.setLineDash([5, 9]); ctx.stroke(); ctx.setLineDash([]);

        // Vertical arcs on sector edges + centre — radius = detRange → apex at altitude = detRange
        ctx.strokeStyle = '#5fc8e830'; ctx.lineWidth = 1; ctx.setLineDash([3, 9]);
        [A0, A1, FACE].forEach(a => {
          ctx.beginPath(); vArc(a, detRange); ctx.stroke();
        });
        ctx.setLineDash([]);

        // Horizontal ring at mid-altitude (detRange * sin 45°) to hint the sphere
        const midH = detRange * Math.SQRT1_2;  // √2/2 ≈ 0.707
        const midAlt = detRange * Math.SQRT1_2;
        ctx.beginPath(); hArc(midH, midAlt, true);
        ctx.strokeStyle = '#5fc8e822'; ctx.lineWidth = 1; ctx.setLineDash([2, 10]); ctx.stroke(); ctx.setLineDash([]);
      }
    }

    drawBatteryIcon(pos.x, pos.y, col, b.reloading, isInterceptor);

    if (b.id === state.movingBatteryId) {
      const pulse = 0.5 + 0.5*Math.sin(Date.now()*0.008);
      ctx.beginPath(); ctx.arc(pos.x, pos.y - 6, 12+pulse*4, 0, Math.PI*2);
      ctx.strokeStyle = 'rgba(255,255,100,0.7)'; ctx.lineWidth=2; ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.font = 'bold 10px Rajdhani, sans-serif'; ctx.fillStyle = col;
    ctx.fillText(def.name, pos.x, pos.y + 16);
    if (isInterceptor) {
      const ammoFrac = b.ammoRemaining / b.maxAmmo;
      const ac = ammoFrac>0.5?C.green:ammoFrac>0.2?C.orange:C.red;
      ctx.font = '9px Share Tech Mono, monospace'; ctx.fillStyle = ac;
      ctx.fillText(b.ammoRemaining+'/'+b.maxAmmo, pos.x, pos.y+27);
      if (b.reloading) {
        const frac = 1 - b.reloadTimer/(INTERCEPTOR_DEFS[b.defId]?.reloadTime||1);
        ctx.fillStyle=C.orange+'55'; ctx.fillRect(pos.x-18,pos.y+30,36*frac,3);
        ctx.strokeStyle=C.orange+'55'; ctx.lineWidth=1; ctx.strokeRect(pos.x-18,pos.y+30,36,3);
        ctx.font='8px Rajdhani'; ctx.fillStyle=C.orange; ctx.fillText('טוען',pos.x,pos.y+40);
      }
    }
  });
}

function drawBatteryIcon(x, y, color, reloading, isInterceptor) {
  const col = reloading ? C.orange : color;
  ctx.save();
  ctx.shadowColor = col;
  ctx.shadowBlur = 8;
  ctx.strokeStyle = col; ctx.lineWidth = 2;
  if (isInterceptor) {
    ctx.fillStyle = col + '22';
    ctx.fillRect(x - 11, y - 4, 22, 5);
    ctx.strokeRect(x - 11, y - 4, 22, 5);
    const offsets = [-5, 0, 5];
    offsets.forEach(ox => {
      ctx.beginPath();
      ctx.moveTo(x + ox, y - 4);
      ctx.lineTo(x + ox - 6, y - 17);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(x + ox - 6, y - 17, 2, 0, Math.PI * 2);
      ctx.fillStyle = col + 'cc'; ctx.fill();
    });
  } else {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 14); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y - 14, 7, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 5, y - 14); ctx.lineTo(x + 5, y - 14); ctx.stroke();
  }
  ctx.shadowBlur = 14;
  ctx.beginPath(); ctx.arc(x, y - 1, 3, 0, Math.PI * 2);
  ctx.fillStyle = col; ctx.fill();
  ctx.restore();
}

// ── THREATS ────────────────────────────────────────────────────────────────
function drawThreats() {
  state.threats.forEach(threat => {
    if (threat.elapsed < 0) return;
    if (!threat.active && !threat.intercepted) return;
    if (!threat.active) return;

    const t = threat.t;
    const stealthed = threat.def.stealthAscent && t < 0.4 && !threat.detected;
    let color = t<0.4?C.blue:t<0.6?C.white:t<0.85?C.orange:C.red;

    if (threat.detected || !stealthed) {
      ctx.strokeStyle = color+'28'; ctx.setLineDash([3,7]); ctx.lineWidth=1;
      ctx.beginPath(); let first=true;
      for (let pt=Math.max(0,t); pt<=1.0; pt+=0.025) {
        const xk = threat.launchX_km + pt*(threat.targetX_km - threat.launchX_km);
        const yk = threat.launchY_km + pt*(threat.targetY_km - threat.launchY_km);
        const ak = Math.max(0, 4*threat.hmax*pt*(1-pt));
        const p = isoToCanvas(xk, yk, ak);
        if (first) { ctx.moveTo(p.x,p.y); first=false; } else ctx.lineTo(p.x,p.y);
      }
      ctx.stroke(); ctx.setLineDash([]);
    }

    const pos = isoToCanvas(threat.posX_km, threat.posY_km, threat.altKm);

    for (let i = 1; i < threat.trail.length; i++) {
      const frac = i / threat.trail.length;
      ctx.globalAlpha = frac * 0.65;
      ctx.strokeStyle = color;
      ctx.lineWidth = frac * 2.5;
      ctx.beginPath();
      ctx.moveTo(threat.trail[i-1].x, threat.trail[i-1].y);
      ctx.lineTo(threat.trail[i].x,   threat.trail[i].y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.lineWidth = 1;

    const shadow = isoToCanvas(threat.posX_km, threat.posY_km, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.09)'; ctx.setLineDash([2,6]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pos.x,pos.y); ctx.lineTo(shadow.x,shadow.y); ctx.stroke(); ctx.setLineDash([]);

    const normAlt = threat.hmax > 0 ? threat.altKm / threat.hmax : 0;
    const radius = 3.5 + normAlt * 8;
    ctx.globalAlpha = stealthed ? 0.28 : 1.0;
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = stealthed ? 4 : 12 + normAlt * 10;
    ctx.beginPath(); ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color + '99'; ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(pos.x, pos.y, Math.max(1, radius * 0.32), 0, Math.PI * 2);
    ctx.fillStyle = '#ffffffee'; ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;

    if (stealthed) {
      if (Math.sin(state.simTime * 0.006) > 0) {
        ctx.font = 'bold 10px sans-serif'; ctx.fillStyle = C.orange;
        ctx.textAlign = 'center'; ctx.fillText('?', pos.x, pos.y - radius - 2);
      }
    } else if (!threat.detected) {
      ctx.font = '9px Rajdhani'; ctx.fillStyle = C.orange + '88';
      ctx.textAlign = 'center'; ctx.fillText('לא זוהה', pos.x, pos.y - radius - 10);
    }

    if (threat.altKm > 3) {
      ctx.font = '9px Share Tech Mono, monospace'; ctx.fillStyle = color;
      ctx.textAlign = 'center'; ctx.fillText(Math.round(threat.altKm) + 'km', pos.x, pos.y - radius - 5);
    }
    ctx.font = '8px Rajdhani, sans-serif'; ctx.fillStyle = color + '99';
    ctx.textAlign = 'center'; ctx.fillText(threat.def.name, pos.x, pos.y + radius + 9);

    if (threat.detected && state.phase === 'simulate' && Math.sin(state.simTime * 0.008) > 0) {
      const hasCoverage = state.placedBatteries.some(b => canEngage(b, threat));
      if (!hasCoverage) {
        ctx.font = 'bold 9px Rajdhani, sans-serif'; ctx.fillStyle = C.red;
        ctx.textAlign = 'center'; ctx.fillText('⚠ אין כיסוי', pos.x, pos.y - radius - 14);
      }
    }
  });
}

// ── INTERCEPTOR MISSILES ────────────────────────────────────────────────────
function drawInterceptorMissiles() {
  state.interceptorMissiles.forEach(im => {
    if (!im.active) return;
    const pos = isoToCanvas(im.posX_km, im.posY_km, im.altKm);
    const col = im.color || C.blue;
    for (let i = 1; i < im.trail.length; i++) {
      const frac = i / im.trail.length;
      ctx.globalAlpha = frac * 0.8;
      ctx.strokeStyle = col;
      ctx.lineWidth = frac * 2;
      ctx.beginPath();
      ctx.moveTo(im.trail[i-1].x, im.trail[i-1].y);
      ctx.lineTo(im.trail[i].x,   im.trail[i].y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.lineWidth = 1;
    ctx.save();
    ctx.shadowColor = col;
    ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = col; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(pos.x, pos.y, 1.8, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.restore();
  });
}

// ── PARTICLES / LABELS ─────────────────────────────────────────────────────
function drawParticles() {
  state.particles.forEach(p => {
    ctx.beginPath(); ctx.arc(p.x,p.y,Math.max(0.5,p.r),0,Math.PI*2);
    ctx.fillStyle=p.color; ctx.globalAlpha=Math.max(0,p.life); ctx.fill();
  });
  ctx.globalAlpha=1;
}

function drawLabels() {
  state.labels.forEach(l => {
    ctx.globalAlpha=Math.min(1,l.life/l.maxLife*3);
    ctx.font='bold 11px Rajdhani, sans-serif'; ctx.fillStyle=l.color;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(l.text, l.x, l.y);
  });
  ctx.globalAlpha=1; ctx.textBaseline='alphabetic';
}

// ── WAVE INFO on canvas ────────────────────────────────────────────────────
function drawWaveInfo() {
  if (!state.waves.length) return;
  const label = currentWaveLabel();
  if (!label) return;
  ctx.font='bold 12px Rajdhani, sans-serif';
  ctx.textAlign='right'; ctx.fillStyle='rgba(239,68,68,0.7)';
  ctx.fillText(label, canvas.width-8, 32);
  const nxt = nextWaveIn();
  if (nxt > 0) {
    ctx.font='10px Share Tech Mono, monospace'; ctx.fillStyle='rgba(239,68,68,0.5)';
    ctx.fillText('גל הבא: '+Math.ceil(nxt)+'ש', canvas.width-8, 46);
  }
}

// ── OVERLAYS ───────────────────────────────────────────────────────────────
function drawVersionWatermark() {
  ctx.font='10px Share Tech Mono, monospace'; ctx.textAlign='left';
  ctx.textBaseline='bottom'; ctx.fillStyle='rgba(95,200,232,0.22)';
  ctx.fillText('TBMWAR '+VERSION, 6, canvas.height-4);
  ctx.textBaseline='alphabetic';
}

function drawSimProgress() {
  const pct = Math.min(100,Math.round(state.simTime/SIM_TOTAL_MS*100));
  ctx.font='10px Share Tech Mono, monospace'; ctx.textAlign='right';
  ctx.fillStyle=C.muted; ctx.fillText('סימולציה: '+pct+'%', canvas.width-8, canvas.height-4);
}

function drawLaunchZoneMarker() {
  const pos = isoToCanvas(ENEMY_X_MAX*0.5, MAP_D_KM*0.5, 2);
  ctx.font='bold 11px Rajdhani, sans-serif'; ctx.textAlign='center'; ctx.fillStyle='rgba(239,68,68,0.6)';
  ctx.fillText('לחץ כאן לנקודת שיגור', pos.x, pos.y);
}

function drawPendingLaunchMarker() {
  if (state.pendingLaunchX_km==null) return;
  const pos = isoToCanvas(state.pendingLaunchX_km, state.pendingLaunchY_km ?? MAP_D_KM*0.5, 0);
  ctx.beginPath(); ctx.moveTo(pos.x,pos.y-16); ctx.lineTo(pos.x-10,pos.y); ctx.lineTo(pos.x+10,pos.y); ctx.closePath();
  ctx.fillStyle=C.red; ctx.fill();
  ctx.font='9px Rajdhani'; ctx.fillStyle=C.orange; ctx.textAlign='center';
  ctx.fillText('שגר → לחץ יעד',pos.x,pos.y-20);
}

function drawAttackPlanned() {
  if (!state.attackPlanned.length) return;
  state.attackPlanned.forEach((plan,i) => {
    const tgt = TARGETS.find(t=>t.id===plan.targetId);
    const def = THREAT_DEFS[plan.defId];
    const lx = plan.launchX_km, ly = plan.launchY_km ?? MAP_D_KM*0.5;
    const tx = tgt ? tgt.posX_km : MAP_W_KM-50;
    const ty = tgt ? tgt.posY_km : MAP_D_KM*0.5;
    const hmax2 = (def?.rangekm||300)*0.18;

    ctx.strokeStyle=(def?.color||C.red)+'44'; ctx.setLineDash([2,5]); ctx.lineWidth=1;
    ctx.beginPath();
    for (let pt=0; pt<=1; pt+=0.05) {
      const px = lx + pt*(tx-lx);
      const py = ly + pt*(ty-ly);
      const altKm = 4*hmax2*pt*(1-pt);
      const sp = isoToCanvas(px, py, altKm);
      if (pt===0) ctx.moveTo(sp.x,sp.y); else ctx.lineTo(sp.x,sp.y);
    }
    ctx.stroke(); ctx.setLineDash([]);

    const lpos = isoToCanvas(lx, ly, 0);
    ctx.beginPath(); ctx.moveTo(lpos.x,lpos.y-12); ctx.lineTo(lpos.x-8,lpos.y); ctx.lineTo(lpos.x+8,lpos.y); ctx.closePath();
    ctx.fillStyle=(def?.color||C.red)+'88'; ctx.fill();
    ctx.font='8px Share Tech Mono'; ctx.fillStyle=def?.color||C.red;
    ctx.textAlign='center'; ctx.fillText(i+1,lpos.x,lpos.y-14);
  });
}

// ── HUD / STATUS ───────────────────────────────────────────────────────────
function updateHUD() {
  const diff = DIFFICULTY[state.difficulty];
  document.getElementById('stat-phase').textContent  = diff?.label??'--';
  const budgetEl = document.getElementById('stat-budget');
  if (budgetEl) budgetEl.textContent = diff?.label??'--';
  document.getElementById('stat-threats').textContent = state.threats.filter(t=>t.active).length;
  document.getElementById('stat-intercepts').textContent = state.stats.intercepts;
  document.getElementById('stat-hits').textContent       = state.stats.hits;
  document.getElementById('stat-score').textContent = (state.phase==='replay'||state.phase==='simulate') ? state.stats.score : '--';
  const waveEl = document.getElementById('stat-wave');
  if (waveEl) {
    const total = state.waves.length;
    if (total) {
      const fired = state.waves.filter(w => w.fired).length;
      waveEl.textContent = Math.min(fired, total) + '/' + total;
    } else {
      waveEl.textContent = '--';
    }
  }
}

function updatePhaseBadge() {
  const badge  = document.getElementById('phase-badge');
  const labels = { idle:'ממתין', deploy:'פריסה', simulate:'סימולציה', replay:'חזרה' };
  const cls    = { idle:'idle', deploy:'deploy', simulate:'simulate', replay:'replay' };
  badge.textContent = labels[state.phase]||'--';
  badge.className   = 'phase-badge '+(cls[state.phase]||'idle');
  updateHUD();
}

function updateBatteryStatusPanel() {
  const panel = document.getElementById('battery-status-panel');
  if (!panel) return;
  const batteries = state.placedBatteries.filter(b => b.type==='interceptor');
  if (!batteries.length) { panel.style.display='none'; return; }
  panel.style.display='';

  let html = '<div class="sidebar-section-header blue" style="font-size:10px;">סוללות פרוסות</div>';
  batteries.forEach(b => {
    const def = INTERCEPTOR_DEFS[b.defId]; if (!def) return;
    const ammoFrac = b.maxAmmo>0 ? b.ammoRemaining/b.maxAmmo : 0;
    const barCol = ammoFrac>0.5?'var(--green)':ammoFrac>0.2?'var(--orange)':'var(--red)';
    const engDots = Array.from({length:def.maxSim},(_,i)=>
      `<span style="color:${i<b.activeEngagements?'var(--blue)':'var(--border)'}">●</span>`).join('');

    html += `<div class="battery-status-card" style="padding:5px 8px;margin-bottom:4px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;font-size:11px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="color:${def.color};font-weight:700;">${def.name}</span>
        <span style="font-family:var(--font-mono);font-size:10px;color:var(--muted);">${Math.round(b.posX_km)}km</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:3px;">
        <div style="flex:1;height:4px;background:var(--border);border-radius:2px;overflow:hidden;">
          <div style="height:100%;width:${ammoFrac*100}%;background:${barCol};border-radius:2px;transition:width 0.3s;"></div>
        </div>
        <span style="font-family:var(--font-mono);font-size:10px;color:${barCol};">${b.ammoRemaining}/${b.maxAmmo}</span>
        <span style="font-size:10px;">${engDots}</span>
      </div>
      ${b.reloading ? `<div style="font-size:9px;color:var(--orange);margin-top:2px;">טוען... ${Math.ceil(b.reloadTimer/1000)}ש</div>` : ''}
    </div>`;
  });
  panel.innerHTML = html;
  updateLimitsUI();
}

// ── TOOLTIP ────────────────────────────────────────────────────────────────
function onCanvasMouseMove(e) {
  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left)*(canvas.width/rect.width);
  const py = (e.clientY - rect.top)*(canvas.height/rect.height);
  const { xKm, yKm } = canvasToWorld(px, py);

  const tgt = findTargetNear(xKm, yKm);
  if (tgt) {
    showTooltip(e.clientX, e.clientY, tgt.name, `ערך: ${tgt.value} | ${state.targetStatus[tgt.id]==='hit'?'נפגע':'שלם'}`);
    return;
  }
  const bat = findBatteryNear(xKm, yKm);
  if (bat) {
    const def = INTERCEPTOR_DEFS[bat.defId]||RADAR_DEFS[bat.defId];
    if (def) {
      const pkInfo = INTERCEPTOR_DEFS[bat.defId] ? Object.entries(PK_MATRIX[bat.defId]||{}).map(([k,v])=>`${THREAT_DEFS[k]?.name}:${Math.round(v*100)}%`).join(' | ') : '';
      showTooltip(e.clientX, e.clientY, def.name, `טווח:${def.range||def.detRange||0}km | ${pkInfo}`);
      return;
    }
  }
  hideTooltip();
}

function showTooltip(cx,cy,name,detail) {
  const tt = document.getElementById('tooltip'); if(!tt) return;
  document.getElementById('tooltip-name').textContent   = name;
  document.getElementById('tooltip-detail').textContent = detail;
  tt.style.left=(cx+14)+'px'; tt.style.top=(cy-10)+'px';
  tt.classList.remove('hidden');
}
function hideTooltip() { document.getElementById('tooltip')?.classList.add('hidden'); }

// ── TOAST / MODAL ──────────────────────────────────────────────────────────
function showToast(msg, type='info', dur=2800) {
  const c = document.getElementById('toast-container'); if(!c) return;
  const t = document.createElement('div');
  t.className=`toast ${type}`; t.textContent=msg;
  c.appendChild(t); setTimeout(()=>t.remove(), dur);
}
function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
  if (id === 'modal-new-game') {
    document.querySelectorAll('#modal-new-game .scenario-card').forEach(c =>
      c.classList.toggle('selected', c.dataset.scenario === state.ngScenario)
    );
    document.querySelectorAll('#ng-difficulty .diff-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.diff === state.ngDifficulty)
    );
  }
}
function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }

// ── BOOT ───────────────────────────────────────────────────────────────────
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
