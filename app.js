'use strict';
const VERSION = '117';

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
  const { vcx, vcy } = ISO;
  VIEW.panX = (cx - vcx) * (1 - f) + VIEW.panX * f;
  VIEW.panY = (cy - vcy) * (1 - f) + VIEW.panY * f;
  VIEW.zoom = z;
}
function resetView() { VIEW = { zoom: 1, panX: 0, panY: 0 }; MAP_YAW = 0; MAP_TILT = 1.0; computeIso(); state.starsSeeded = false; }
function _syncPresetBtns(id) {
  document.querySelectorAll('.view-preset-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.preset === id));
}
function adjustYaw(d) {
  if (_activePreset !== 'iso') {
    if (_viewAnimId) { cancelAnimationFrame(_viewAnimId); _viewAnimId = null; }
    _activePreset = 'iso'; MAP_YAW = 0; MAP_TILT = 1.0;
    _syncPresetBtns('iso');
  }
  MAP_YAW += d; computeIso(); state.starsSeeded = false;
}
function adjustTilt(d) {
  if (_activePreset !== 'iso') {
    if (_viewAnimId) { cancelAnimationFrame(_viewAnimId); _viewAnimId = null; }
    _activePreset = 'iso'; MAP_YAW = 0; MAP_TILT = 1.0;
    _syncPresetBtns('iso');
  }
  MAP_TILT = Math.max(TILT_MIN, Math.min(TILT_MAX, MAP_TILT + d)); computeIso(); state.starsSeeded = false;
}

let _activePreset = 'iso';
let _viewAnimId   = null;
let _batteryMoveHandles = []; // [{id, sx, sy}] screen-space hit targets, rebuilt each frame

function _isoToMatrixForm(iso) {
  return {
    ox: iso.ox, oy: iso.oy, cosYaw: iso.cosYaw, sinYaw: iso.sinYaw,
    vcx: iso.vcx, vcy: iso.vcy,
    m11: iso.scaleX,          m12: -(iso.scaleY * 0.6), m13: 0,
    m21: iso.scaleX * 0.4,    m22: iso.tiltV,           m23: -iso.scaleZ,
  };
}

function _buildPresetISO(mode) {
  const W = canvas.width, H = canvas.height;
  const cosYaw = 1, sinYaw = 0, vcx = W * 0.5, vcy = H * 0.5;
  const mob = !!window.MOBILE_MODE;
  if (mode === 'top') {
    const sx = W * 0.86 / MAP_W_KM;
    const sy = H * 0.68 / MAP_D_KM;
    const ox = W * 0.5 - (MAP_W_KM * 0.5) * sx;
    const oy = (mob ? H * 0.40 : H * 0.5) + (MAP_D_KM * 0.5) * sy;
    return { ox, oy, cosYaw, sinYaw, vcx, vcy,
             m11: sx, m12: 0,   m13: 0,
             m21: 0,  m22: -sy, m23: 0 };
  }
  if (mode === 'side') {
    const sx = W * 0.86 / MAP_W_KM;
    const sz = H * 0.76 / Math.max(MAP_H_KM, 100);
    const ox = W * 0.5 - (MAP_W_KM * 0.5) * sx;
    return { ox, oy: mob ? H * 0.78 : H * 0.90, cosYaw, sinYaw, vcx, vcy,
             m11: sx, m12: 0, m13: 0,
             m21: 0,  m22: 0, m23: -sz };
  }
  // iso: use computeIso result
  const tmpYaw = MAP_YAW, tmpTilt = MAP_TILT;
  MAP_YAW = 0; MAP_TILT = 1.0; computeIso();
  const r = _isoToMatrixForm(ISO);
  MAP_YAW = tmpYaw; MAP_TILT = tmpTilt; computeIso();
  return r;
}

function setViewPreset(id) {
  _activePreset = id;
  _syncPresetBtns(id);
  VIEW = { zoom: 1, panX: 0, panY: 0 };
  const start  = _isoToMatrixForm(ISO);
  const target = _buildPresetISO(id);
  const t0 = performance.now(), DURATION = 380;
  if (_viewAnimId) cancelAnimationFrame(_viewAnimId);
  function step(now) {
    const raw  = Math.min(1, (now - t0) / DURATION);
    const ease = 1 - Math.pow(1 - raw, 3);
    const L = (a, b) => a + (b - a) * ease;
    ISO = {
      ox: L(start.ox, target.ox), oy: L(start.oy, target.oy),
      cosYaw: L(start.cosYaw, target.cosYaw), sinYaw: L(start.sinYaw, target.sinYaw),
      vcx: target.vcx, vcy: target.vcy,
      m11: L(start.m11, target.m11), m12: L(start.m12, target.m12), m13: L(start.m13, target.m13),
      m21: L(start.m21, target.m21), m22: L(start.m22, target.m22), m23: L(start.m23, target.m23),
      useMatrix: true,
      scaleX: L(start.m11, target.m11), scaleY: 0, scaleZ: Math.abs(L(start.m23, target.m23)),
      tiltV: L(start.m22, target.m22),
    };
    state.starsSeeded = false;
    if (raw < 1) { _viewAnimId = requestAnimationFrame(step); return; }
    _viewAnimId = null;
    if (id === 'iso') { MAP_YAW = 0; MAP_TILT = 1.0; computeIso(); }
  }
  _viewAnimId = requestAnimationFrame(step);
}

function isoToCanvas(xKm, yKm, altKm) {
  const { scaleX, scaleY, scaleZ, ox, oy, tiltV, cosYaw, sinYaw, vcx, vcy,
          useMatrix, m11, m12, m13, m21, m22, m23 } = ISO;
  const mcx = MAP_W_KM * 0.5, mcy = MAP_D_KM * 0.5;
  const dx = xKm - mcx, dy = yKm - mcy;
  const rx = mcx + dx * cosYaw - dy * sinYaw;
  const ry = mcy + dx * sinYaw + dy * cosYaw;
  const alt = altKm || 0;
  const rawX = ox + (useMatrix ? m11*rx + m12*ry + m13*alt : rx * scaleX - ry * scaleY * 0.6);
  const rawY = oy + (useMatrix ? m21*rx + m22*ry + m23*alt : rx * scaleX * 0.4 + ry * tiltV - alt * scaleZ);
  return { x: (rawX - vcx) * VIEW.zoom + vcx + VIEW.panX, y: (rawY - vcy) * VIEW.zoom + vcy + VIEW.panY };
}

function computeIso() {
  const W = canvas.width, H = canvas.height;
  const mob = !!window.MOBILE_MODE;
  const scaleX = (W * (mob ? 0.38 : 0.46)) / MAP_W_KM;
  const scaleY = (W * (mob ? 0.21 : 0.24)) / MAP_D_KM;
  const tiltV  = scaleY * 0.3 * MAP_TILT;
  // Center the map: rawX at (MAP_W_KM/2, MAP_D_KM/2) = W/2
  const ox = W * 0.5 - (MAP_W_KM * 0.5) * scaleX + (MAP_D_KM * 0.5) * scaleY * 0.6;
  const groundBottomOffset = MAP_W_KM * scaleX * 0.4 + MAP_D_KM * tiltV;
  const oy = Math.max(H * 0.06, (mob ? H * 0.82 : H * 0.84) - groundBottomOffset);
  const scaleZ = Math.max(0.05, (oy - H * 0.04) / Math.max(1, MAP_H_KM));
  ISO = { scaleX, scaleY, scaleZ, ox, oy, tiltV,
          cosYaw: Math.cos(MAP_YAW), sinYaw: Math.sin(MAP_YAW),
          vcx: W * 0.5, vcy: H * 0.5 };
}

function kmToCanvas(xKm, altKm, yKm) {
  return isoToCanvas(xKm, yKm ?? MAP_D_KM * 0.5, altKm);
}

function canvasToWorld(px, py) {
  const raw = unapplyView(px, py);
  const dx = raw.x - ISO.ox, dy = raw.y - ISO.oy;
  const mcx = MAP_W_KM * 0.5, mcy = MAP_D_KM * 0.5;
  let rx0, ry0;
  if (ISO.useMatrix) {
    const det = ISO.m11 * ISO.m22 - ISO.m12 * ISO.m21;
    if (Math.abs(det) > 1e-6) {
      rx0 = (ISO.m22 * dx - ISO.m12 * dy) / det;
      ry0 = (ISO.m11 * dy - ISO.m21 * dx) / det;
    } else {
      rx0 = ISO.m11 ? dx / ISO.m11 : mcx;
      ry0 = mcy;
    }
  } else {
    const { scaleX, scaleY, tiltV } = ISO;
    ry0 = (dy - dx * 0.4) / (tiltV + scaleY * 0.6 * 0.4);
    rx0 = (dx + ry0 * scaleY * 0.6) / scaleX;
  }
  const drx = rx0 - mcx, dry = ry0 - mcy;
  return {
    xKm: Math.max(0, Math.min(MAP_W_KM, mcx + drx * ISO.cosYaw + dry * ISO.sinYaw)),
    yKm: Math.max(0, Math.min(MAP_D_KM, mcy - drx * ISO.sinYaw + dry * ISO.cosYaw)),
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
  'scud-b':  { name:'SCUD-B',   rangekm:300,  rangeMin:150,  speed:1.5, cost:1,  rcs:1.0, stealthAscent:false, termManeuver:false, color:'#ef4444', launchZone:'near'  },
  'scud-c':  { name:'SCUD-C',   rangekm:500,  rangeMin:300,  speed:1.8, cost:2,  rcs:0.8, stealthAscent:false, termManeuver:false, color:'#f97316', launchZone:'near'  },
  'shahab3': { name:'Shahab-3', rangekm:1300, rangeMin:1000, speed:2.5, cost:4,  rcs:0.45,stealthAscent:true,  termManeuver:false, color:'#fb923c', launchZone:'mid'   },
  'ghadr1':  { name:'Ghadr-1',  rangekm:1600, rangeMin:1200, speed:3.0, cost:6,  rcs:0.25,stealthAscent:true,  termManeuver:false, color:'#fbbf24', launchZone:'far'   },
  'icbm':    { name:'ICBM',     rangekm:4000, rangeMin:2000, speed:5.0, cost:15, rcs:0.07,stealthAscent:true,  termManeuver:true,  color:'#f43f5e', hmaxKm:3000,        launchZone:'icbm'  },
};

const INTERCEPTOR_DEFS = {
  'iron-dome': { name:'Iron Shield', short:'ISH', range:50,  altMin:0,   altMax:20,   speed:2.0, cost:1,  magazine:20, maxSim:6, reloadTime:15000, detRange:400,  color:'#fb923c', targetList:['scud-b','scud-c'] },
  pac3:        { name:'PAC-3',     short:'PAC', range:150,  altMin:0,   altMax:40,   speed:2.5, cost:2,  magazine:16, maxSim:4, reloadTime:25000, detRange:350,  color:'#5fc8e8', targetList:['scud-b','scud-c','shahab3'] },
  arrow2:      { name:'Arrow-2',   short:'AR2', range:250,  altMin:10,  altMax:55,   speed:3.0, cost:4,  magazine:8,  maxSim:2, reloadTime:35000, detRange:700,  color:'#38bdf8', targetList:['shahab3','ghadr1'] },
  thaad:       { name:'THAAD',     short:'THD', range:300,  altMin:40,  altMax:150,  speed:3.5, cost:6,  magazine:6,  maxSim:3, reloadTime:40000, detRange:700,  color:'#818cf8', targetList:['shahab3','ghadr1','icbm'] },
  sm3:         { name:'SM-3',      short:'SM3', range:500,  altMin:150, altMax:500,  speed:5.0, cost:10, magazine:4,  maxSim:2, reloadTime:60000, detRange:1100, color:'#a78bfa', targetList:['shahab3','ghadr1','icbm'] },
  arrow3:      { name:'Arrow-3',   short:'AR3', range:400,  altMin:100, altMax:1000, speed:5.5, cost:12, magazine:4,  maxSim:1, reloadTime:90000, detRange:1000, color:'#c084fc', targetList:['shahab3','ghadr1','icbm'] },
};

const RADAR_DEFS = {
  'green-pine': { name:'אורן ירוק',    short:'GPR', range:1400, cost:6, color:'#4ade80', supportedInterceptors:['sm3','thaad','arrow2','arrow3'] },
  'xband':      { name:'X-Band TPY-2', short:'XBD', range:1300, cost:8, color:'#86efac', supportedInterceptors:['sm3','thaad','arrow2','arrow3'] },
};

const INTERCEPTOR_INFO = {
  'iron-dome': 'גילוי: 400km | ירי: 50km | גובה: 0-20km | 20 מיירטים | יירוט: SCUD-B, SCUD-C בלבד | PK: SCUD-B 90%, SCUD-C 75%',
  pac3:        'גילוי: 350km | ירי: 150km | גובה: 0-40km | 16 מיירטים | יירוט: SCUD-B/C, Shahab-3 בלבד | PK: SCUD-B 88%, Shahab 55%',
  arrow2:      'גילוי: 700km | ירי: 250km | גובה: 10-55km | 8 מיירטים | יירוט: Shahab-3, Ghadr-1 בלבד | PK: Shahab 78%, Ghadr 50%',
  thaad:       'גילוי: 700km | ירי: 300km | גובה: 40-150km | 6 מיירטים | יירוט: Shahab-3, Ghadr-1, ICBM | PK: Shahab 86%, Ghadr 82%, ICBM 44%',
  sm3:         'גילוי: 1100km | ירי: 500km | גובה: 150-500km | 4 מיירטים | יירוט: Shahab-3, Ghadr-1, ICBM | PK: Ghadr 88%, ICBM 82%',
  arrow3:      'גילוי: 1000km | ירי: 400km | גובה: 100-1000km | 4 מיירטים | יירוט: Shahab-3, Ghadr-1, ICBM | PK: Ghadr 90%, ICBM 94%',
  'green-pine': 'גילוי: 1400km | תומך: SM-3, THAAD, חץ-2, חץ-3 בלבד | מכ"ם ייעודי לגילוי מוקדם',
  'xband':      'גילוי: 1300km | תומך: SM-3, THAAD, חץ-2, חץ-3 בלבד | X-Band — גילוי טילים עם חתימה רדארית קטנה',
  'scud-b':   'טווח: 150–300km | גובה שיא: 54km | RCS: 1.0 (גדול) | Iron Shield / PAC-3',
  'scud-c':   'טווח: 300–500km | גובה שיא: 90km | RCS: 0.8 | Iron Shield / PAC-3',
  'shahab3':  'טווח: 1000–1300km | גובה שיא: 234km | RCS: 0.45 | PAC-3, חץ-2, THAAD, SM-3, חץ-3',
  'ghadr1':   'טווח: 1200–1600km | גובה שיא: 288km | RCS: 0.25 | חץ-2, THAAD, SM-3, חץ-3',
  'icbm':     'טווח: 2000–4000km | גובה שיא: 3000km | RCS: 0.07 | תמרון סיומי — THAAD / SM-3 / חץ-3 בלבד',
};

// PK[interceptorId][threatId]
const PK_MATRIX = {
  'iron-dome': { 'scud-b':0.90, 'scud-c':0.75 },
  pac3:        { 'scud-b':0.88, 'scud-c':0.78, 'shahab3':0.55 },
  arrow2:      { 'shahab3':0.78, 'ghadr1':0.50 },
  thaad:       { 'shahab3':0.86, 'ghadr1':0.82, 'icbm':0.44 },
  sm3:         { 'shahab3':0.76, 'ghadr1':0.88, 'icbm':0.82 },
  arrow3:      { 'shahab3':0.80, 'ghadr1':0.90, 'icbm':0.94 },
};

const LAUNCH_ZONES = {
  near:  [200, 280, 180, 320],
  mid:   [140, 200, 120, 170],
  far:   [80,  130, 60,  100],
  icbm:  [30,  60,  20,  45],
};

const TARGETS = [
  { id:'port',     name:'נמל ים',       value:12, icon:'⚓', posX_km:680,  posY_km:240, baseX:680,  baseY:240 },
  { id:'industry', name:'מתקן תעשייתי', value:10, icon:'🏭', posX_km:920,  posY_km:330, baseX:920,  baseY:330 },
  { id:'power',    name:'תחנת כוח',     value:20, icon:'⚡', posX_km:1260, posY_km:140, baseX:1260, baseY:140 },
  { id:'city',     name:'עיר גדולה',    value:25, icon:'🏙', posX_km:1680, posY_km:280, baseX:1680, baseY:280 },
  { id:'base',     name:'בסיס צבאי',    value:30, icon:'🪖', posX_km:2080, posY_km:100, baseX:2080, baseY:100 },
  { id:'airport',  name:'נמל תעופה',    value:15, icon:'✈', posX_km:2350, posY_km:210, baseX:2350, baseY:210 },
];

const BATTERY_LIMITS = {
  easy:    { 'iron-dome':4, pac3:4, arrow2:3, thaad:2, sm3:1, arrow3:1, 'green-pine':2, 'xband':1 },
  medium:  { 'iron-dome':3, pac3:3, arrow2:2, thaad:2, sm3:1, arrow3:0, 'green-pine':1, 'xband':0 },
  hard:    { 'iron-dome':2, pac3:2, arrow2:2, thaad:1, sm3:0, arrow3:0, 'green-pine':1, 'xband':0 },
  extreme: { 'iron-dome':1, pac3:2, arrow2:1, thaad:1, sm3:0, arrow3:0, 'green-pine':0, 'xband':0 },
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
      { startTime:2000,  count:4, pool:['scud-b','scud-b','scud-c'] },
      { startTime:28000, count:5, pool:['scud-b','scud-c','scud-c'] },
    ]
  },
  medium: {
    key:'medium', label:'בינוני', noIntel:false, speedMult:1.0,
    waves:[
      { startTime:2000,  count:5, pool:['scud-b','scud-c','scud-c','shahab3'] },
      { startTime:25000, count:5, pool:['scud-c','shahab3','shahab3'] },
      { startTime:48000, count:6, pool:['shahab3','ghadr1','shahab3'] },
    ]
  },
  hard: {
    key:'hard', label:'קשה', noIntel:false, speedMult:1.3,
    waves:[
      { startTime:2000,  count:6, pool:['scud-c','shahab3','shahab3','ghadr1'] },
      { startTime:20000, count:6, pool:['shahab3','ghadr1','ghadr1','shahab3'] },
      { startTime:40000, count:7, pool:['ghadr1','ghadr1','shahab3','icbm'] },
      { startTime:60000, count:5, pool:['ghadr1','icbm','icbm'] },
    ]
  },
  extreme: {
    key:'extreme', label:'קשה-במיוחד', noIntel:true, speedMult:1.6,
    waves:[
      { startTime:1500,  count:8, pool:['shahab3','ghadr1','ghadr1','icbm'] },
      { startTime:18000, count:7, pool:['ghadr1','icbm','ghadr1','icbm'] },
      { startTime:35000, count:7, pool:['icbm','ghadr1','icbm','icbm'] },
      { startTime:55000, count:6, pool:['icbm','icbm','ghadr1','icbm'] },
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
const C = { bg:'#080d18', bg2:'#0d1526', bg3:'#111d35', blue:'#5fc8e8', red:'#ef4444', green:'#22c55e', yellow:'#facc15', orange:'#f97316', white:'#e8f0fe', muted:'#4a5a7a', border:'#1e3050' };

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
  stats:{ intercepts:0, hits:0, score:0, shotsFired:0, misses:[] },
  targetStatus:{},
  counts:{ 'iron-dome':0,pac3:0,arrow2:0,thaad:0,sm3:0,arrow3:0,'green-pine':0,xband:0,'scud-b':0,'scud-c':0,shahab3:0,ghadr1:0,icbm:0 },
  ngScenario:'defense', ngDifficulty:'medium',
  attackPlanned:[],     // {defId, launchX_km, launchY_km, targetId}
  attackPhase:'launcher', pendingLaunchX_km:null, pendingLaunchY_km:null, pendingDefId:null,
  stars:[], starsSeeded:false,
  _suppressNextClick: false,
};

// ── INIT ───────────────────────────────────────────────────────────────────
const canvas = document.getElementById('main-canvas');
const ctx    = canvas.getContext('2d');

function init() {
  resizeCanvas();
  window.addEventListener('resize', () => {
    // On iOS, browser zoom fires resize via visualViewport — skip if page is zoomed
    if (window.visualViewport && window.visualViewport.scale !== 1) return;
    resizeCanvas();
  });
  bindUI();
  resetToIdle();
  initDesktopJoystick();
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
  document.getElementById('ng-confirm')?.addEventListener('click', confirmNewGame);

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

  // ── Mouse (desktop) ────────────────────────────────────────────────────────
  let _mouse = { down:false, button:0, startX:0, startY:0, lastX:0, lastY:0, dragged:false };
  let _mouseLongPress = null;

  function _onMouseDown(e) {
    _mouse.down    = true;
    _mouse.button  = e.button || 0;
    _mouse.startX  = _mouse.lastX = e.clientX;
    _mouse.startY  = _mouse.lastY = e.clientY;
    _mouse.dragged = false;
    if (e.button === 2 && e.preventDefault) e.preventDefault();
    if (!window.MOBILE_MODE && (e.button || 0) === 0 && (state.phase === 'deploy' || state.phase === 'idle')) {
      _mouseLongPress = setTimeout(() => {
        _mouseLongPress = null;
        if (_mouse.dragged) return;
        const rect = canvas.getBoundingClientRect();
        const px = (_mouse.startX - rect.left) * (canvas.width / rect.width);
        const py = (_mouse.startY - rect.top)  * (canvas.height / rect.height);
        const { xKm, yKm } = canvasToWorld(px, py);
        const hit = findBatteryNear(xKm, yKm);
        if (hit) { enterMoveMode(hit.id); _mouse.down = false; }
      }, 500);
    }
  }

  function _onMouseMove(e) {
    if (!_mouse.down) { if (!window.MOBILE_MODE) onCanvasMouseMove(e); return; }
    const dx = e.clientX - _mouse.lastX;
    const dy = e.clientY - _mouse.lastY;
    if (!_mouse.dragged && Math.hypot(e.clientX - _mouse.startX, e.clientY - _mouse.startY) > 5) {
      _mouse.dragged = true;
      if (_mouseLongPress) { clearTimeout(_mouseLongPress); _mouseLongPress = null; }
    }
    if (_mouse.dragged) {
      if (_mouse.button === 0) { VIEW.panX += dx; VIEW.panY += dy; }
      else { adjustYaw(dx * 0.008); adjustTilt(-dy * 0.008); }
    }
    _mouse.lastX = e.clientX;
    _mouse.lastY = e.clientY;
  }

  function _onMouseUp(e) {
    if (_mouseLongPress) { clearTimeout(_mouseLongPress); _mouseLongPress = null; }
    if (!_mouse.dragged) onCanvasClick(e);
    _mouse.down = false; _mouse.dragged = false;
  }

  canvas.addEventListener('mousedown',  _onMouseDown);
  canvas.addEventListener('mousemove',  _onMouseMove);
  canvas.addEventListener('mouseup',    _onMouseUp);
  canvas.addEventListener('mouseleave', () => {
    hideTooltip(); _mouse.down = false;
    if (_mouseLongPress) { clearTimeout(_mouseLongPress); _mouseLongPress = null; }
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    if (e.ctrlKey) {
      const rect = canvas.getBoundingClientRect();
      const cx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const cy = (e.clientY - rect.top)  * (canvas.height / rect.height);
      zoomAround(cx, cy, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    } else if (e.deltaMode === 0) {
      adjustYaw(e.deltaX * 0.003);
      adjustTilt(e.deltaY * 0.003);
    } else {
      zoomAround(canvas.width * 0.5, canvas.height * 0.5, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }
  }, { passive: false });

  // ── Touch debug overlay (enabled with ?debug=1 in URL) ───────────────────
  const _dbg = new URLSearchParams(location.search).get('debug') === '1';
  let _dbgEl = null;
  if (_dbg) {
    _dbgEl = document.createElement('div');
    Object.assign(_dbgEl.style, {
      position:'fixed', top:'50px', left:'4px', zIndex:'99999',
      background:'rgba(0,0,0,0.82)', color:'#0f0', fontFamily:'monospace',
      fontSize:'11px', padding:'6px 8px', borderRadius:'6px',
      pointerEvents:'none', lineHeight:'1.6', maxWidth:'220px',
      border:'1px solid #0f0', whiteSpace:'pre'
    });
    document.body.appendChild(_dbgEl);
  }
  function _dbgLog(action, extra) {
    if (!_dbgEl) return;
    const t = new Date().toISOString().slice(14,23);
    const line = `${t} ${action}${extra ? ' '+extra : ''}`;
    const lines = (_dbgEl.textContent || '').split('\n').filter(Boolean);
    lines.unshift(line);
    _dbgEl.textContent = lines.slice(0,12).join('\n');
  }
  window._dbgLog = _dbgLog;
  function _dbgState() {
    if (!_dbgEl) return;
    _dbgEl.style.borderColor = _drag.active ? '#0f0' : '#f80';
    _dbgLog(`act=${_drag.active?1:0} mv=${_drag.moved?1:0}`);
  }

  // ── Touch: pan/pinch — original AIRWAR code ────────────────────────────────
  const touchTarget = document.getElementById('canvas-area') || canvas;
  let _drag = { active:false, startX:0, startY:0, lastX:0, lastY:0,
                moved:false, dist0:0, angle0:0, midX:0, midY:0 };
  let _touchLongPress = null;

  touchTarget.addEventListener('touchstart', e => {
    e.preventDefault();
    hideTooltip();
    if (e.touches.length === 1) {
      _drag.active = true;
      _drag.startX = _drag.lastX = e.touches[0].clientX;
      _drag.startY = _drag.lastY = e.touches[0].clientY;
      _drag.moved  = false;
      _dbgLog(`START1 tgt=${e.target.id||e.target.tagName}`, `x=${Math.round(e.touches[0].clientX)}`);
    } else if (e.touches.length >= 2) {
      if (_touchLongPress) { clearTimeout(_touchLongPress); _touchLongPress = null; }
      _drag.active = false;
      const t0 = e.touches[0], t1 = e.touches[1];
      _drag.dist0  = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      _drag.angle0 = Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX);
      _drag.midX   = (t0.clientX + t1.clientX) * 0.5;
      _drag.midY   = (t0.clientY + t1.clientY) * 0.5;
      _drag.moved  = true;
      _dbgLog(`START${e.touches.length} PINCH`);
    }
  }, { passive: false });

  touchTarget.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 1 && _drag.active) {
      const dx = e.touches[0].clientX - _drag.lastX;
      const dy = e.touches[0].clientY - _drag.lastY;
      VIEW.panX += dx; VIEW.panY += dy;
      _drag.lastX = e.touches[0].clientX;
      _drag.lastY = e.touches[0].clientY;
      if (Math.hypot(e.touches[0].clientX - _drag.startX, e.touches[0].clientY - _drag.startY) > 12) {
        if (!_drag.moved) _dbgLog('MOVED→pan');
        _drag.moved = true;
        if (_touchLongPress) { clearTimeout(_touchLongPress); _touchLongPress = null; }
      }
    } else if (e.touches.length === 1 && !_drag.active) {
      _dbgLog('MOVE1 but active=false!');
    } else if (e.touches.length >= 2) {
      const t0 = e.touches[0], t1 = e.touches[1];
      const newDist  = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      const newAngle = Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX);
      const newMidX  = (t0.clientX + t1.clientX) * 0.5;
      const newMidY  = (t0.clientY + t1.clientY) * 0.5;
      const rect     = canvas.getBoundingClientRect();
      const cx = (_drag.midX - rect.left) * (canvas.width  / rect.width);
      const cy = (_drag.midY - rect.top)  * (canvas.height / rect.height);
      if (_drag.dist0 > 0) zoomAround(cx, cy, newDist / _drag.dist0);
      VIEW.panX += newMidX - _drag.midX;
      if (_activePreset === 'iso') {
        let dAngle = newAngle - _drag.angle0;
        if (dAngle >  Math.PI) dAngle -= Math.PI * 2;
        if (dAngle < -Math.PI) dAngle += Math.PI * 2;
        MAP_YAW += dAngle;
        MAP_TILT = Math.max(TILT_MIN, Math.min(TILT_MAX, MAP_TILT - (newMidY - _drag.midY) * 0.012));
        computeIso();
      }
      _drag.dist0  = newDist;
      _drag.angle0 = newAngle;
      _drag.midX   = newMidX;
      _drag.midY   = newMidY;
    }
  }, { passive: false });

  touchTarget.addEventListener('touchend', e => {
    e.preventDefault();
    if (_touchLongPress) { clearTimeout(_touchLongPress); _touchLongPress = null; }
    if (!_drag.moved && e.changedTouches.length === 1) {
      const t    = e.changedTouches[0];
      const rect = canvas.getBoundingClientRect();
      const px   = (t.clientX - rect.left) * (canvas.width  / rect.width);
      const py   = (t.clientY - rect.top)  * (canvas.height / rect.height);
      _dbgLog('END→CLICK', `x=${Math.round(px)} y=${Math.round(py)} sel=${state.selectedUnitId||'none'} sc=${state.scenario}`);
      onCanvasClick({ clientX: t.clientX, clientY: t.clientY, _px: px, _py: py });
    } else {
      _dbgLog(`END mv=${_drag.moved?1:0} ch=${e.changedTouches.length}`);
    }
    _drag.active = false;
  }, { passive: false });

  touchTarget.addEventListener('touchcancel', () => {
    if (_touchLongPress) { clearTimeout(_touchLongPress); _touchLongPress = null; }
    _drag.active = false;
    _drag.moved  = true;
    _dbgLog('CANCEL');
    hideTooltip();
  });

  // Also watch for touches that land OUTSIDE touchTarget (page scroll culprit)
  if (_dbg) {
    document.addEventListener('touchstart', e => {
      if (!touchTarget.contains(e.target)) {
        _dbgLog(`DOC-START tgt=${e.target.id||e.target.tagName}`, `n=${e.touches.length}`);
      }
    }, { passive: true });
  }

  if (window.MOBILE_MODE) {
    document.addEventListener('gesturestart',  e => e.preventDefault(), { passive: false });
    document.addEventListener('gesturechange', e => e.preventDefault(), { passive: false });
  }


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
      if (_infoPopupActiveId === id) { closeUnitInfoPopup(); return; }
      showUnitInfoPopup(id, btn);
    })
  );
  document.getElementById('uip-close')?.addEventListener('click', closeUnitInfoPopup);
  document.addEventListener('click', e => {
    if (!e.target.closest('#unit-info-popup') && !e.target.closest('.unit-info-btn'))
      closeUnitInfoPopup();
  });

  document.addEventListener('keydown', e => {
    if (e.key === ' ' && !e.target.matches('input,button,textarea')) {
      e.preventDefault();
      if (state.phase === 'simulate') state.simPlaying = !state.simPlaying;
      else if (state.phase === 'replay') toggleScrubPlay();
    }
    if ((e.key === 'n'||e.key==='N') && !e.target.matches('input,textarea')) openModal('modal-new-game');
    if (e.key === 'Escape') { state.selectedUnitId = null; document.querySelectorAll('.unit-card').forEach(c=>c.classList.remove('selected')); if (state.movingBatteryId !== null) { state.movingBatteryId = null; canvas.style.cursor = ''; } }
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

  document.querySelectorAll('.view-preset-btn').forEach(btn =>
    btn.addEventListener('click', () => setViewPreset(btn.dataset.preset)));
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
  if (state._suppressNextClick) { state._suppressNextClick = false; _dbgLog?.('CLICK suppressed'); return; }
  if (state.phase === 'simulate' || state.phase === 'replay') { _dbgLog?.(`CLICK blocked phase=${state.phase}`); return; }
  const rect = canvas.getBoundingClientRect();
  const px = e._px ?? (e.clientX - rect.left) * (canvas.width / rect.width);
  const py = e._py ?? (e.clientY - rect.top)  * (canvas.height / rect.height);
  const { xKm, yKm } = canvasToWorld(px, py);
  _dbgLog?.(`CLICK x=${Math.round(xKm)}km ph=${state.phase}`);
  if (state.scenario === 'defense') handleDefenseClick(xKm, yKm, px, py);
  else handleAttackClick(xKm, yKm, px, py);
}

function handleDefenseClick(xKm, yKm, px, py) {
  // Move-handle hit test (screen-space, before any world-space checks)
  const HIT_R = window.MOBILE_MODE ? 22 : 14;
  const handle = _batteryMoveHandles.find(h => Math.hypot(px - h.sx, py - h.sy) < HIT_R);
  if (handle) { enterMoveMode(handle.id); return; }

  if (xKm < FRIENDLY_X_MIN) { _dbgLog?.(`REJECT xKm=${Math.round(xKm)}<${FRIENDLY_X_MIN}`); showToast('פרוס רק באזור הידידותי (צד ימין)', 'warn'); return; }

  // Completing a move: place battery at new position
  if (state.movingBatteryId !== null) {
    const bat = state.placedBatteries.find(b => b.id === state.movingBatteryId);
    if (bat) {
      bat.posX_km = xKm;
      bat.posY_km = yKm;
      showToast('סוללה הוזזה', 'success');
    }
    state.movingBatteryId = null;
    canvas.style.cursor = '';
    // Restore selected unit so placement can continue immediately
    if (state._savedUnitId) {
      state.selectedUnitId = state._savedUnitId;
      state._savedUnitId = null;
      const card = document.querySelector(`.unit-card[data-id="${state.selectedUnitId}"]`);
      if (card) card.classList.add('selected');
    }
    updateBatteryStatusPanel();
    updateLimitsUI();
    return;
  }

  if (!state.selectedUnitId) { _dbgLog?.(`NO-UNIT sel=${state.selectedUnitId} ph=${state.phase}`); showToast('בחר יחידה מהרשימה תחילה', 'warn'); return; }

  const unitId = state.selectedUnitId;
  const isInterceptor = !!INTERCEPTOR_DEFS[unitId];
  const def = isInterceptor ? INTERCEPTOR_DEFS[unitId] : RADAR_DEFS[unitId];
  if (!def) { _dbgLog?.(`NO-DEF id=${unitId}`); return; }

  if (getAvailable(unitId) <= 0) {
    _dbgLog?.(`NO-AVAIL ${unitId}`);
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
    state.pendingDefId      = unitId;
    state.attackPhase = 'target';
    const reachable = TARGETS.filter(t => {
      const d = Math.hypot(t.posX_km - xKm, (t.posY_km ?? MAP_D_KM*0.5) - (yKm ?? MAP_D_KM*0.5));
      return d >= (THREAT_DEFS[unitId].rangeMin||0) && d <= THREAT_DEFS[unitId].rangekm;
    });
    if (!reachable.length) {
      showToast(`${THREAT_DEFS[unitId].name}: אין יעדים בטווח מהנקודה הזו — נסה עמדה קרובה יותר לגבול`, 'warn');
      state.attackPhase = 'launcher'; state.pendingLaunchX_km = null; state.pendingLaunchY_km = null; state.pendingDefId = null;
      return;
    }
    setCanvasHint(`בחר יעד — ${reachable.length} יעדים בטווח (${THREAT_DEFS[unitId].rangeMin||0}–${THREAT_DEFS[unitId].rangekm}km)`);
    showToast(`בחר יעד — יעדים בטווח: ${reachable.map(t=>t.name).join(', ')}`, 'info', 4000);
  } else {
    const target = findTargetNear(xKm, yKm);
    if (!target) { showToast('לחץ ישירות על אייקון יעד', 'warn'); return; }
    const unitId = state.pendingDefId;
    const def = THREAT_DEFS[unitId];
    if (!def) { state.attackPhase = 'launcher'; return; }
    const dist = Math.round(Math.hypot(
      target.posX_km - state.pendingLaunchX_km,
      (target.posY_km ?? MAP_D_KM*0.5) - (state.pendingLaunchY_km ?? MAP_D_KM*0.5)
    ));
    if (dist > def.rangekm || (def.rangeMin && dist < def.rangeMin)) {
      const reason = dist > def.rangekm
        ? `רחוק מדי (${dist}km > ${def.rangekm}km)`
        : `קרוב מדי (${dist}km < ${def.rangeMin}km)`;
      showToast(`${def.name}: יעד לא בטווח — ${reason}`, 'warn', 4000);
      return;
    }
    state.attackPlanned.push({ defId:unitId, launchX_km:state.pendingLaunchX_km, launchY_km:state.pendingLaunchY_km, targetId:target.id });
    state.attackPhase = 'launcher';
    state.pendingLaunchX_km = null;
    state.pendingLaunchY_km = null;
    state.pendingDefId = null;
    updateLimitsUI();
    setCanvasHint(`${def.name} → ${target.name} (${state.attackPlanned.length} טילים מתוכננים). הוסף עוד או לחץ שגר.`);
    showToast(`${def.name} מכוון ל${target.name}`, 'success');
  }
}

function enterMoveMode(batteryId) {
  state.movingBatteryId = batteryId;
  state._savedUnitId = state.selectedUnitId;
  state.selectedUnitId = null;
  document.querySelectorAll('.unit-card').forEach(c => c.classList.remove('selected'));
  canvas.style.cursor = 'move';
  const bat = state.placedBatteries.find(b => b.id === batteryId);
  const def = bat ? (INTERCEPTOR_DEFS[bat.defId] || RADAR_DEFS[bat.defId]) : null;
  showToast(`${def?.name || ''} — לחץ על מיקום חדש להזזה`, 'info');
}

function removeBattery(batteryId) {
  state.placedBatteries = state.placedBatteries.filter(b => b.id !== batteryId);
  if (state.movingBatteryId === batteryId) { state.movingBatteryId = null; canvas.style.cursor = ''; }
  updateBatteryStatusPanel();
  updateLimitsUI();
}

function findBatteryNearScreen(screenPx, screenPy) {
  return state.placedBatteries.find(b => {
    const sp = isoToCanvas(b.posX_km, b.posY_km ?? MAP_D_KM*0.5, 0);
    return Math.hypot(sp.x - screenPx, sp.y - screenPy) < 14;
  }) || null;
}

function findBatteryNear(xKm, yKm) {
  const sp = isoToCanvas(xKm, yKm ?? MAP_D_KM*0.5, 0);
  return findBatteryNearScreen(sp.x, sp.y);
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
  state.endingAt        = null;
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
  state.stats = { intercepts:0, hits:0, score:0, shotsFired:0, misses:[] };
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
function randomizeTargets() {
  TARGETS.forEach(t => {
    t.posX_km = Math.round(t.baseX + (Math.random() - 0.5) * 300);
    t.posY_km = Math.round(t.baseY + (Math.random() - 0.5) * 200);
    t.posX_km = Math.max(FRIENDLY_X_MIN + 60, Math.min(MAP_W_KM - 60, t.posX_km));
    t.posY_km = Math.max(30, Math.min(MAP_D_KM - 30, t.posY_km));
  });
}

function confirmNewGame() {
  state.scenario   = state.ngScenario;
  state.difficulty = state.ngDifficulty;
  randomizeTargets();
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
  state.stats = { intercepts:0, hits:0, score:0, shotsFired:0, misses:[] };
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
    const rangeMin = def.rangeMin || 0;
    const rangeMax = def.rangekm;

    let launchX, launchY, target, targetX, targetY, actualDist;
    let found = false;
    const launchCandidates = zone.map(z => z + (Math.random()-0.5)*50);
    outer:
    for (const lx of launchCandidates) {
      const shuffled = [...TARGETS].sort(() => Math.random()-0.5);
      for (const t of shuffled) {
        const dist = Math.hypot(t.posX_km - lx, t.posY_km - (MAP_D_KM * 0.5));
        if (dist >= rangeMin && dist <= rangeMax) {
          launchX = lx; launchY = MAP_D_KM * 0.12 + Math.random() * MAP_D_KM * 0.76;
          target = t; targetX = t.posX_km; targetY = t.posY_km;
          actualDist = Math.hypot(targetX - launchX, targetY - launchY);
          found = true;
          break outer;
        }
      }
    }
    if (!found) {
      // fallback: pick closest valid target ignoring rangeMin
      launchX = zone[i % zone.length] + (Math.random()-0.5)*50;
      launchY = MAP_D_KM * 0.12 + Math.random() * MAP_D_KM * 0.76;
      target = TARGETS.reduce((best, t) => {
        const d = Math.hypot(t.posX_km - launchX, t.posY_km - launchY);
        return (!best || Math.abs(d - rangeMax*0.7) < Math.abs(Math.hypot(best.posX_km - launchX, best.posY_km - launchY) - rangeMax*0.7)) ? t : best;
      }, null);
      targetX = target.posX_km; targetY = target.posY_km;
      actualDist = Math.hypot(targetX - launchX, targetY - launchY);
    }
    const hmax    = def.hmaxKm ?? (Math.max(def.rangekm, actualDist) * 0.18);
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
    const hmax   = def.hmaxKm ?? (def.rangekm * 0.18);
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

    if (state.threats.every(t => !t.active) && allWavesFired()) {
      if (!state.endingAt) state.endingAt = state.simTime;
      if (state.simTime - state.endingAt >= 2000) endSimulation();
    } else {
      state.endingAt = null;
    }
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

// ── RADAR SECTOR CHECK ─────────────────────────────────────────────────────
// Returns true if `threat` falls within the battery's 120° detection sector.
// Interceptor batteries face FACE=π (toward enemy / left). Dedicated radar
// batteries (Green Pine, X-Band) have 360° coverage.
function isThreatInSector(battery, threat) {
  const def = RADAR_DEFS[battery.defId];
  if (def) return true; // dedicated radar: full 360°
  const dx = threat.posX_km - battery.posX_km;
  const dy = (threat.posY_km ?? MAP_D_KM * 0.5) - (battery.posY_km ?? MAP_D_KM * 0.5);
  let dAngle = Math.atan2(dy, dx) - Math.PI; // FACE = π
  while (dAngle >  Math.PI) dAngle -= 2 * Math.PI;
  while (dAngle < -Math.PI) dAngle += 2 * Math.PI;
  return Math.abs(dAngle) <= Math.PI / 3; // ±60°
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
      if (dist <= effRange && isThreatInSector(b, threat)) {
        threat.detected = true;
        threat.detectedTime = state.simTime;
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
    .filter(t => !t.suppressEngageUntil || state.simTime >= t.suppressEngageUntil)
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
// travelTime is set to timeToFp so the interceptor arrives exactly when the threat reaches the intercept point.
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
    const timeToFp = (fp - threat.t) * threat.duration;
    if (timeToFp < 400 || timeToFp >= remainingMs - 200) continue;
    return { targetX_km: tx, targetY_km: ty, targetAlt_km: ta, travelTime: timeToFp };
  }
  return null;
}

function canEngage(battery, threat) {
  if (!battery.active || battery.reloading) return false;
  if (battery.ammoRemaining <= 0) return false;
  const def = INTERCEPTOR_DEFS[battery.defId];
  if (!def) return false;
  if (def.targetList && !def.targetList.includes(threat.defId)) return false;
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
    showToast(`${def.name} — הקצאת מיירטים נוצלה, טוען...`, 'warn');
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

  // Radar guidance: self-radar valid only if threat is within detRange AND within 120° sector.
  // External dedicated radars (Green Pine / X-Band) have 360° coverage and can guide from any angle.
  const selfRange = battery ? effectiveDetRange(battery.defId, threat.defId, threat.t) : 0;
  const selfDist  = battery ? Math.hypot(threat.posX_km - battery.posX_km, (threat.posY_km ?? MAP_D_KM*0.5) - (battery.posY_km ?? MAP_D_KM*0.5)) : Infinity;
  const selfContact = battery && selfDist <= selfRange && isThreatInSector(battery, threat);
  const extContact  = state.placedBatteries.some(b => {
    if (b.type !== 'radar') return false;
    const rd = RADAR_DEFS[b.defId];
    if (!rd) return false;
    if (rd.supportedInterceptors && !rd.supportedInterceptors.includes(im.defId)) return false;
    return Math.hypot(threat.posX_km - b.posX_km, (threat.posY_km ?? MAP_D_KM*0.5) - (b.posY_km ?? MAP_D_KM*0.5)) <= rd.range;
  });
  if (!selfContact && !extContact) {
    if (battery) threat.engagedBy.delete(battery.id);
    threat.suppressEngageUntil = state.simTime + 1200;
    const pos = isoToCanvas(im.targetX_km, im.targetY_km ?? MAP_D_KM*0.5, im.targetAlt_km);
    spawnExplosion(pos.x, pos.y, C.red, 14);
    const behindBattery = battery && threat.posX_km > battery.posX_km;
    const reason = behindBattery
      ? 'אובדן מגע מכ"מ — האיום חצה את קו הסוללה (מחוץ למגזר גילוי)'
      : 'אובדן מגע מכ"מ — המטרה יצאה מטווח גילוי';
    addLabel(pos.x, pos.y - 20, 'אבד מגע מכ"מ ✗', C.red, 2800);
    showToast(`${INTERCEPTOR_DEFS[im.defId]?.name||''} — אבד מגע מכ"מ`, 'warn');
    const tgt = TARGETS.find(t => t.id === threat.targetId);
    state.stats.misses.push({
      interceptorName: INTERCEPTOR_DEFS[im.defId]?.name || im.defId,
      batteryPos: battery ? Math.round(battery.posX_km) : '?',
      threatName: threat.def.name,
      targetName: tgt?.name || threat.targetId,
      reason,
    });
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
    if (battery) threat.engagedBy.delete(battery.id);
    threat.suppressEngageUntil = state.simTime + 1200;
    spawnExplosion(pos.x, pos.y, C.red, 12);
    addLabel(pos.x, pos.y-18, `החטיא (${Math.round(finalPk*100)}%)`, C.red, 2000);
    showToast(`${INTERCEPTOR_DEFS[im.defId].name} החטיא — PK=${Math.round(finalPk*100)}%`, 'warn');
    const tgt2 = TARGETS.find(t => t.id === threat.targetId);
    const mods = [];
    if (threat.def.rcs < 0.2) mods.push('טיל עם חתימה רדארית קטנה');
    if (threat.def.termManeuver) mods.push('תמרון סיומי');
    state.stats.misses.push({
      interceptorName: INTERCEPTOR_DEFS[im.defId]?.name || im.defId,
      batteryLabel: battery ? `${(INTERCEPTOR_DEFS[battery.defId]||{}).name||''} (${Math.round(battery.posX_km)}km)` : 'לא ידוע',
      threatName: threat.def.name,
      targetName: tgt2?.name || threat.targetId,
      reason: `החטאת PK (${Math.round(finalPk*100)}%)${mods.length ? ' — ' + mods.join(', ') : ''}`,
    });
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
      const compatible = inRange.filter(b => {
        const def = INTERCEPTOR_DEFS[b.defId];
        return !def.targetList || def.targetList.includes(threat.defId);
      });
      if (compatible.length === 0) {
        const names = [...new Set(inRange.map(b => INTERCEPTOR_DEFS[b.defId].name))].join(', ');
        reasons.push({ type:'incompatible', text:`סוללות בטווח (${names}) אינן מיועדות ל-${threat.def.name}` });
      } else {
        const withAmmo = compatible.filter(b => b.ammoRemaining > 0);
        if (withAmmo.length === 0) {
          reasons.push({ type:'noammo', text:'כל הסוללות בטווח מוצו מתחמושת — נדרשות שכבות נוספות' });
        } else {
          reasons.push({ type:'assign', text:'סוללות זמינות לא הוקצו — ייתכן עיכוב תגובה אוטומטית' });
        }
      }
    }
  } else {
    reasons.push({ type:'miss', text:`${threat.shotsReceived} מיירט${threat.shotsReceived > 1 ? 'ים' : ''} נורו — כולם החטיאו (כישלון הסתברותי)` });
    if (threat.def.termManeuver) reasons.push({ type:'maneuver', text:'תמרון סיומי הפחית משמעותית את הסתברות היירוט' });
    if (threat.def.rcs < 0.2)    reasons.push({ type:'stealth',  text:'חתימה רדארית קטנה — קשה לנעילה ולכיוון המיירט' });
  }
  return reasons;
}

function generateRecommendations() {
  const recs = [];
  if (state.scenario !== 'defense') {
    const sc = state.stats.score;
    if (sc < 50) recs.push('ריכז טילים על יעדים בעלי ערך גבוה במקום פיזור');
    if (sc < 80) recs.push('שגר גלי מטח — מספר טילים בו-זמנית מכביד על מערך ההגנה');
    recs.push('Shahab-3/Ghadr-1 קשים יותר לגילוי ולמניעה — חתימה רדארית קטנה מקשה על כיוון המיירט');
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
  if (types.has('incompatible')) recs.push('התאם סוללות ליירוט לסוגי האיומים — Iron Shield/PAC-3 אינן מכסות Shahab-3 ומעלה');
  if (types.has('stealth'))   recs.push('לאיומים עם חתימה רדארית קטנה — פרוס X-Band לגילוי מוקדם מ-300km ומעלה');

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

  // Miss log
  const missSec = document.getElementById('res-miss-section');
  const missEl  = document.getElementById('res-miss-log');
  if (missEl && missSec) {
    const misses = state.stats.misses;
    if (misses.length > 0) {
      missSec.style.display = '';
      missEl.innerHTML = misses.map((m, i) =>
        `<div class="miss-row">
          <span class="miss-num">${i+1}.</span>
          <span class="miss-interceptor">${m.interceptorName}</span>
          <span class="miss-sep">◂</span>
          <span class="miss-battery">${m.batteryLabel}</span>
          <span class="miss-sep">▸</span>
          <span class="miss-threat">${m.threatName}</span>
          <span class="miss-arrow">→</span>
          <span class="miss-target">${m.targetName}</span>
          <div class="miss-reason">${m.reason}</div>
        </div>`
      ).join('');
    } else {
      missSec.style.display = 'none';
    }
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
  drawRangeNotches();
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
  drawThreatLegend();
  drawEndOfSimBanner();
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

  ctx.font = '11px Share Tech Mono, monospace';
  ctx.fillStyle = 'rgba(95,200,232,0.55)';
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
    ctx.strokeStyle = 'rgba(95,200,232,0.08)';
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    ctx.fillStyle = 'rgba(95,200,232,0.70)';
    ctx.font = '11px Share Tech Mono, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(alt+'km', p1.x + 4, p1.y - 3);
  });
}

// ── RANGE NOTCHES ──────────────────────────────────────────────────────────
function drawRangeNotches() {
  const STEP = 200;
  const majorEvery = 600;
  ctx.save();

  for (let offset = STEP; offset < MAP_W_KM - FRIENDLY_X_MIN; offset += STEP) {
    const x = FRIENDLY_X_MIN + offset;
    if (x >= MAP_W_KM) break;

    const isMajor = (offset % majorEvery === 0);

    let p0, p1;
    if (_activePreset === 'side') {
      p0 = isoToCanvas(x, MAP_D_KM * 0.5, 0);
      p1 = isoToCanvas(x, MAP_D_KM * 0.5, Math.max(MAP_H_KM, 200));
    } else {
      p0 = isoToCanvas(x, 0, 0);
      p1 = isoToCanvas(x, MAP_D_KM, 0);
      if (Math.abs(p0.y - p1.y) < 2) continue;
    }

    ctx.setLineDash([3, 5]);
    ctx.lineWidth = isMajor ? 1.2 : 0.7;
    ctx.strokeStyle = isMajor ? 'rgba(95,200,232,0.45)' : 'rgba(95,200,232,0.18)';
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    ctx.setLineDash([]);

    const botPt = p0.y > p1.y ? p0 : p1;
    ctx.font = isMajor ? 'bold 12px Share Tech Mono, monospace' : '11px Share Tech Mono, monospace';
    ctx.fillStyle = isMajor ? 'rgba(95,200,232,0.90)' : 'rgba(95,200,232,0.55)';
    ctx.textAlign = 'center';
    ctx.fillText(offset + 'km', botPt.x, botPt.y + 16);
  }

  ctx.restore();
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
  const inTargetPhase = state.scenario === 'attack' && state.attackPhase === 'target' && state.pendingDefId;
  const pendingDef    = inTargetPhase ? THREAT_DEFS[state.pendingDefId] : null;

  TARGETS.forEach(t => {
    const hit = state.targetStatus[t.id]==='hit';

    let inRange = true;
    if (inTargetPhase && pendingDef) {
      const dist = Math.hypot(t.posX_km - state.pendingLaunchX_km, (t.posY_km ?? MAP_D_KM*0.5) - (state.pendingLaunchY_km ?? MAP_D_KM*0.5));
      inRange = dist >= (pendingDef.rangeMin || 0) && dist <= pendingDef.rangekm;
    }

    const col = hit ? C.red : inRange ? C.green : C.muted;
    const pos = isoToCanvas(t.posX_km, t.posY_km, 0);
    const top = isoToCanvas(t.posX_km, t.posY_km, 8);

    ctx.strokeStyle = col+'44'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pos.x, pos.y); ctx.lineTo(top.x, top.y); ctx.stroke();

    ctx.font = '15px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.globalAlpha = hit ? 0.4 : inRange ? 0.95 : 0.25;
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
  _batteryMoveHandles = [];
  state.placedBatteries.forEach(b => {
    if (b.hidden && state.noIntel) return;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.setLineDash([]);
    const isInterceptor = b.type === 'interceptor';
    const def = isInterceptor ? INTERCEPTOR_DEFS[b.defId] : RADAR_DEFS[b.defId];
    if (!def) return;
    const pos = isoToCanvas(b.posX_km, b.posY_km ?? MAP_D_KM*0.5, 0);
    const col = def.color;

    if (state.showRanges) {
      const bX = b.posX_km, bY = b.posY_km ?? MAP_D_KM * 0.5;
      const FACE = Math.PI;
      const HALF = Math.PI / 3;
      const A0 = FACE - HALF, A1 = FACE + HALF;
      const N  = 28;

      function hArc(r, alt, move) {
        for (let i = 0; i <= N; i++) {
          const a = A0 + (A1 - A0) * i / N;
          const p = isoToCanvas(bX + r * Math.cos(a), bY + r * Math.sin(a), alt);
          if (move && i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
      }

      function vArc(angle, radius) {
        for (let i = 0; i <= N; i++) {
          const theta = (Math.PI / 2) * i / N;
          const h   = radius * Math.cos(theta);
          const alt = radius * Math.sin(theta);
          const p = isoToCanvas(bX + h * Math.cos(angle), bY + h * Math.sin(angle), alt);
          if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
      }

      // ── Detection bubble (drawn first so intercept arcs appear on top) ───────
      const detRange = isInterceptor ? def.detRange : def.range;
      if (detRange) {
        const dc = '#4ade80';

        // Ground footprint
        const base1 = isoToCanvas(bX, bY, 0);
        ctx.beginPath(); ctx.moveTo(base1.x, base1.y);
        hArc(detRange, 0, false);
        ctx.closePath();
        ctx.fillStyle = dc + '0e'; ctx.fill();
        ctx.strokeStyle = dc + '60'; ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 8]); ctx.stroke(); ctx.setLineDash([]);

        // Vertical quarter-circle arcs at sector edges and centre
        ctx.strokeStyle = dc + '75'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
        [A0, A1, FACE].forEach(a => {
          ctx.beginPath(); vArc(a, detRange); ctx.stroke();
        });

        // Mid-elevation ring
        const midH = detRange * Math.SQRT1_2;
        const midAlt = detRange * Math.SQRT1_2;
        ctx.beginPath(); hArc(midH, midAlt, true);
        ctx.strokeStyle = dc + '50'; ctx.lineWidth = 1.2; ctx.setLineDash([3, 7]); ctx.stroke(); ctx.setLineDash([]);
      }

      // ── Intercept envelope — dome bubble ────────────────────────────────────
      if (isInterceptor && def.altMin !== undefined) {
        const R  = def.range;
        const ic = '#f97316';

        // Dome arc: from edge of ground circle (R, alt=0) curving to apex (0, altMax)
        function interceptDomeArc(angle) {
          for (let i = 0; i <= N; i++) {
            const theta = (Math.PI / 2) * i / N;
            const h   = R * Math.cos(theta);
            const alt = def.altMax * Math.sin(theta);
            const p = isoToCanvas(bX + h * Math.cos(angle), bY + h * Math.sin(angle), alt);
            if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
          }
        }

        // Ground footprint
        const base0 = isoToCanvas(bX, bY, 0);
        ctx.beginPath(); ctx.moveTo(base0.x, base0.y);
        hArc(R, 0, false);
        ctx.closePath();
        ctx.fillStyle = ic + '18'; ctx.fill();
        ctx.strokeStyle = ic + '70'; ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 6]); ctx.stroke(); ctx.setLineDash([]);

        // Dome face fill: A0 dome arc → A1 dome arc reversed → ground arc back
        ctx.beginPath();
        interceptDomeArc(A0);
        for (let i = N; i >= 0; i--) {
          const theta = (Math.PI / 2) * i / N;
          const h = R * Math.cos(theta), alt = def.altMax * Math.sin(theta);
          const p = isoToCanvas(bX + h * Math.cos(A1), bY + h * Math.sin(A1), alt);
          ctx.lineTo(p.x, p.y);
        }
        for (let i = N; i >= 0; i--) {
          const a = A0 + (A1 - A0) * i / N;
          const p = isoToCanvas(bX + R * Math.cos(a), bY + R * Math.sin(a), 0);
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.fillStyle = ic + '28'; ctx.fill();

        // Dome arcs at sector edges and centre (vertical curves — like detection vArc)
        ctx.shadowColor = ic; ctx.shadowBlur = 5;
        ctx.strokeStyle = ic + 'c0'; ctx.lineWidth = 2.0; ctx.setLineDash([]);
        [A0, A1, FACE].forEach(a => {
          ctx.beginPath(); interceptDomeArc(a); ctx.stroke();
        });
        ctx.shadowBlur = 0;

        // Mid-elevation ring (45° up the dome)
        const midH   = R   * Math.SQRT1_2;
        const midAlt = def.altMax * Math.SQRT1_2;
        ctx.beginPath(); hArc(midH, midAlt, true);
        ctx.strokeStyle = ic + '55'; ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 7]); ctx.stroke(); ctx.setLineDash([]);

        // Floor ring (altMin) — shows where effective interception begins
        if (def.altMin > 0) {
          const floorH = R * Math.sqrt(Math.max(0, 1 - (def.altMin / def.altMax) ** 2));
          ctx.beginPath(); hArc(floorH, def.altMin, true);
          ctx.strokeStyle = ic + '80'; ctx.lineWidth = 1.2;
          ctx.setLineDash([4, 5]); ctx.stroke(); ctx.setLineDash([]);
        }
      }
    }

    drawBatteryIcon(pos.x, pos.y, col, b.reloading, def.short || '');

    // Move handle — small ✥ badge, top-right of battery icon
    if ((state.phase === 'deploy' || state.phase === 'idle') && b.id !== state.movingBatteryId) {
      const hx = pos.x + 18, hy = pos.y - 15, hr = 9;
      _batteryMoveHandles.push({ id: b.id, sx: hx, sy: hy });
      ctx.save();
      ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(8,13,24,0.92)'; ctx.fill();
      ctx.strokeStyle = '#fde047'; ctx.lineWidth = 1.5; ctx.stroke();
      // 4-direction arrow cross
      ctx.strokeStyle = '#fde047'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(hx, hy - 5); ctx.lineTo(hx, hy + 5); // vertical
      ctx.moveTo(hx - 5, hy); ctx.lineTo(hx + 5, hy); // horizontal
      ctx.stroke();
      ctx.restore();
    }

    if (b.id === state.movingBatteryId) {
      const pulse = 0.5 + 0.5*Math.sin(Date.now()*0.008);
      ctx.beginPath(); ctx.arc(pos.x, pos.y, 16+pulse*4, 0, Math.PI*2);
      ctx.strokeStyle = 'rgba(255,255,100,0.7)'; ctx.lineWidth=2; ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.font = 'bold 10px Rajdhani, sans-serif'; ctx.fillStyle = col;
    ctx.fillText(def.name, pos.x, pos.y + 22);
    if (isInterceptor) {
      const ammoFrac = b.ammoRemaining / b.maxAmmo;
      const ac = ammoFrac>0.5?C.green:ammoFrac>0.2?C.orange:C.red;
      ctx.font = '9px Share Tech Mono, monospace'; ctx.fillStyle = ac;
      ctx.fillText(b.ammoRemaining+'/'+b.maxAmmo, pos.x, pos.y+33);
      if (b.reloading) {
        const frac = 1 - b.reloadTimer/(INTERCEPTOR_DEFS[b.defId]?.reloadTime||1);
        ctx.fillStyle=C.orange+'55'; ctx.fillRect(pos.x-18,pos.y+36,36*frac,3);
        ctx.strokeStyle=C.orange+'55'; ctx.lineWidth=1; ctx.strokeRect(pos.x-18,pos.y+36,36,3);
        ctx.font='8px Rajdhani'; ctx.fillStyle=C.orange; ctx.fillText('טוען',pos.x,pos.y+46);
      }
    }
    ctx.restore();
  });
}

function drawBatteryIcon(x, y, color, reloading, label) {
  const col = reloading ? C.orange : color;
  const R = 14;
  ctx.save();
  ctx.shadowColor = col;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    i === 0 ? ctx.moveTo(x + R * Math.cos(a), y + R * Math.sin(a))
             : ctx.lineTo(x + R * Math.cos(a), y + R * Math.sin(a));
  }
  ctx.closePath();
  ctx.fillStyle = col + '28';
  ctx.fill();
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.font = 'bold 8px Rajdhani, sans-serif';
  ctx.fillStyle = col;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y + 1);
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

function threatStatusColor(threat) {
  if (state.interceptorMissiles.some(im => im.threatId === threat.id && im.active)) return C.orange;
  if (state.placedBatteries.some(b => canEngage(b, threat))) return C.yellow;
  const hasRadar = state.placedBatteries.some(b => {
    if (b.type === 'radar') {
      const rd = RADAR_DEFS[b.defId];
      return rd && Math.hypot(threat.posX_km - b.posX_km, (threat.posY_km ?? MAP_D_KM*0.5) - (b.posY_km ?? MAP_D_KM*0.5)) <= rd.range;
    }
    const range = effectiveDetRange(b.defId, threat.defId, threat.t);
    return Math.hypot(threat.posX_km - b.posX_km, (threat.posY_km ?? MAP_D_KM*0.5) - (b.posY_km ?? MAP_D_KM*0.5)) <= range;
  });
  return hasRadar ? C.green : C.white;
}

function drawThreatLegend() {
  if (state.phase !== 'simulate' && state.phase !== 'replay') return;
  const items = [
    { color: C.orange, label: 'כתום — ירוט בביצוע' },
    { color: C.yellow, label: 'צהוב — במעטפת ירוט'  },
    { color: C.green,  label: 'ירוק — מגע מכ"מ'    },
    { color: C.white,  label: 'לבן — מחוץ למעטפת'  },
  ];
  const pad = 8, lineH = 16, dotR = 5;
  const boxW = 148, boxH = pad * 2 + items.length * lineH;
  const bx = 8, by = canvas.height - boxH - 38;
  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = '#0d1526'; ctx.strokeStyle = '#1e3050'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 4); ctx.fill(); ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.font = '11px Rajdhani, sans-serif'; ctx.textBaseline = 'middle';
  items.forEach((item, i) => {
    const cy = by + pad + i * lineH + lineH * 0.5;
    ctx.beginPath(); ctx.arc(bx + pad + dotR, cy, dotR, 0, Math.PI * 2);
    ctx.fillStyle = item.color; ctx.fill();
    ctx.fillStyle = '#c8d8f0'; ctx.textAlign = 'right';
    ctx.fillText(item.label, bx + boxW - pad, cy);
  });
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
    let color = threatStatusColor(threat);

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
    }

    if (threat.altKm > 3) {
      ctx.font = '9px Share Tech Mono, monospace'; ctx.fillStyle = color + 'cc';
      ctx.textAlign = 'center'; ctx.fillText(Math.round(threat.altKm) + 'km', pos.x, pos.y - radius - 5);
    }
    ctx.font = 'bold 12px Rajdhani, sans-serif'; ctx.fillStyle = color;
    ctx.textAlign = 'center'; ctx.fillText(threat.def.name, pos.x, pos.y + radius + 14);

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
function drawEndOfSimBanner() {
  if (!state.endingAt) return;
  const elapsed = state.simTime - state.endingAt;
  const alpha = Math.min(1, elapsed / 400);
  const cx = canvas.width / 2, cy = canvas.height * 0.38;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = 'bold 28px Rajdhani, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = C.blue; ctx.shadowBlur = 24;
  ctx.fillStyle = C.blue;
  ctx.fillText('— סיום סימולציה —', cx, cy);
  ctx.font = '13px Share Tech Mono, monospace';
  ctx.fillStyle = C.muted;
  ctx.shadowBlur = 0;
  ctx.fillText('END OF SIMULATION', cx, cy + 30);
  ctx.restore();
}

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
    const hmax2 = def?.hmaxKm ?? ((def?.rangekm||300)*0.18);

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

    const canEdit = (state.phase === 'deploy' || state.phase === 'idle');
    const moveBtn = canEdit ? `<button class="batt-btn batt-btn-move" onclick="enterMoveMode(${b.id})">הזז</button>` : '';
    const delBtn  = canEdit ? `<button class="batt-btn batt-btn-del"  onclick="removeBattery(${b.id})">הסר</button>` : '';
    html += `<div class="battery-status-card" style="padding:5px 8px;margin-bottom:4px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;font-size:11px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="color:${def.color};font-weight:700;">${def.name}</span>
        <span style="display:flex;align-items:center;gap:3px;">${moveBtn}${delBtn}<span style="font-family:var(--font-mono);font-size:10px;color:var(--muted);">${Math.round(b.posX_km)}km</span></span>
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

  const radars = state.placedBatteries.filter(b => b.type === 'radar');
  if (radars.length) {
    html += '<div class="sidebar-section-header blue" style="font-size:10px;margin-top:6px;">מכ"מים פרוסים</div>';
    radars.forEach(b => {
      const def = RADAR_DEFS[b.defId]; if (!def) return;
      const canEdit = (state.phase === 'deploy' || state.phase === 'idle');
      const moveBtn = canEdit ? `<button class="batt-btn batt-btn-move" onclick="enterMoveMode(${b.id})">הזז</button>` : '';
      const delBtn  = canEdit ? `<button class="batt-btn batt-btn-del"  onclick="removeBattery(${b.id})">הסר</button>` : '';
      html += `<div style="padding:4px 8px;margin-bottom:4px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;font-size:11px;display:flex;justify-content:space-between;align-items:center;">
        <span style="color:${def.color};font-weight:700;">${def.name}</span>
        <span style="display:flex;align-items:center;gap:3px;">${moveBtn}${delBtn}<span style="font-family:var(--font-mono);font-size:10px;color:var(--muted);">${Math.round(b.posX_km)}km</span></span>
      </div>`;
    });
  }

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

// ── UNIT INFO POPUP ────────────────────────────────────────────────────────
let _infoPopupActiveId = null;

function closeUnitInfoPopup() {
  _infoPopupActiveId = null;
  document.getElementById('unit-info-popup')?.classList.add('hidden');
  document.querySelectorAll('.unit-info-btn.active').forEach(b => b.classList.remove('active'));
}

function showUnitInfoPopup(id, btn) {
  const popup = document.getElementById('unit-info-popup');
  if (!popup) return;
  _infoPopupActiveId = id;

  const iDef = INTERCEPTOR_DEFS[id];
  const rDef = RADAR_DEFS[id];
  const tDef = THREAT_DEFS[id];
  const def  = iDef || rDef || tDef;
  const color = def?.color || '#5fc8e8';

  document.getElementById('uip-dot').style.background  = color;
  document.getElementById('uip-name').textContent       = def?.name || id;
  document.getElementById('uip-body').innerHTML         = buildUnitInfoHTML(id);

  document.querySelectorAll('.unit-info-btn.active').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');

  popup.classList.remove('hidden');

  if (!window.MOBILE_MODE) {
    requestAnimationFrame(() => {
      const rect = btn?.getBoundingClientRect();
      const pw = popup.offsetWidth, ph = popup.offsetHeight;
      let left = (rect?.left ?? 200) - pw - 10;
      if (left < 8) left = (rect?.right ?? 200) + 10;
      let top = Math.max(8, Math.min(rect?.top ?? 100, window.innerHeight - ph - 8));
      popup.style.left = left + 'px';
      popup.style.top  = top  + 'px';
    });
  }
}

function buildUnitInfoHTML(id) {
  const iDef = INTERCEPTOR_DEFS[id];
  const rDef = RADAR_DEFS[id];
  const tDef = THREAT_DEFS[id];

  function row(label, val) {
    return `<div class="uip-row"><span class="uip-label">${label}</span><span class="uip-val">${val}</span></div>`;
  }
  function pkColor(pk) {
    if (pk >= 0.80) return 'var(--green)';
    if (pk >= 0.50) return '#facc15';
    return '#f97316';
  }

  if (iDef) {
    const pkEntries = PK_MATRIX[id] || {};
    const pkRows = (iDef.targetList || []).map(tid => {
      const pk = pkEntries[tid];
      const name = THREAT_DEFS[tid]?.name || tid;
      const pct  = pk !== undefined ? Math.round(pk * 100) : null;
      const bar  = pct !== null
        ? `<div class="uip-pk-bar"><div class="uip-pk-bar-fill" style="width:${pct}%;background:${pkColor(pk)}"></div></div>`
        : '';
      return `<tr>
        <td>${name}</td>
        <td style="color:${pct !== null ? pkColor(pk) : 'var(--muted)'}">${pct !== null ? pct+'%' : '—'}</td>
        <td>${bar}</td>
      </tr>`;
    }).join('');

    return `
      ${row('גילוי עצמי', iDef.detRange + ' km')}
      ${row('טווח ירי', iDef.range + ' km')}
      ${row('גובה יירוט', iDef.altMin + '–' + iDef.altMax + ' km')}
      ${row('מיירטים', iDef.magazine)}
      ${row('בו-זמניים', iDef.maxSim)}
      ${row('זמן טעינה', (iDef.reloadTime / 1000) + ' שנ׳')}
      <div class="uip-divider"></div>
      <div class="uip-sub">הסתברות יירוט (PK)</div>
      <table class="uip-pk-table">${pkRows || '<tr><td colspan="3" style="color:var(--muted)">—</td></tr>'}</table>
    `;
  }

  if (rDef) {
    const names = (rDef.supportedInterceptors || [])
      .map(sid => INTERCEPTOR_DEFS[sid]?.name || sid);
    return `
      ${row('טווח גילוי', rDef.range + ' km')}
      <div class="uip-divider"></div>
      <div class="uip-sub">מערכות נתמכות</div>
      <div class="uip-tags">${names.map(n => `<span class="uip-tag">${n}</span>`).join('')}</div>
    `;
  }

  if (tDef) {
    const hmax = tDef.hmaxKm ?? Math.round(tDef.rangekm * 0.18);
    const rcsLabel = tDef.rcs >= 0.8 ? 'גדול' : tDef.rcs >= 0.3 ? 'בינוני' : tDef.rcs >= 0.1 ? 'קטן' : 'מאוד קטן';
    const rangeStr = tDef.rangeMin ? `${tDef.rangeMin}–${tDef.rangekm} km` : `${tDef.rangekm} km`;
    const interceptors = Object.entries(INTERCEPTOR_DEFS)
      .filter(([, d]) => d.targetList?.includes(id))
      .map(([, d]) => `<span class="uip-tag">${d.name}</span>`).join('');
    return `
      ${row('טווח', rangeStr)}
      ${row('גובה שיא', hmax + ' km')}
      ${row('RCS', tDef.rcs + ' — ' + rcsLabel)}
      ${row('עלייה חמקנית', tDef.stealthAscent ? 'כן' : 'לא')}
      ${row('תמרון סיומי', tDef.termManeuver ? 'כן ⚠' : 'לא')}
      <div class="uip-divider"></div>
      <div class="uip-sub">מיירטים יעילים</div>
      <div class="uip-tags">${interceptors || '<span style="color:var(--muted);font-size:12px">—</span>'}</div>
    `;
  }

  return `<div style="color:var(--muted);font-size:13px;padding:4px 0">${INTERCEPTOR_INFO[id] || '—'}</div>`;
}

// ── TOAST / MODAL ──────────────────────────────────────────────────────────
function showToast(msg, type='info', dur=2800) {
  const c = document.getElementById('toast-container'); if(!c) return;
  const simActive = state.phase==='simulate' || state.phase==='replay';
  if (simActive && (type==='success'||type==='warn')) dur = 1800;
  const MAX = simActive ? 3 : 6;
  while (c.children.length >= MAX) c.firstChild.remove();
  const t = document.createElement('div');
  t.className=`toast ${type}`; t.textContent=msg;
  c.appendChild(t); setTimeout(()=>t.remove(), dur);
}
let instrCurrentPage = 1;
function instrGoTo(n) {
  const pages = document.querySelectorAll('.instr-page');
  const total = pages.length;
  instrCurrentPage = Math.max(1, Math.min(total, n));
  pages.forEach((p, i) => p.classList.toggle('active', i + 1 === instrCurrentPage));
  const ind = document.getElementById('instr-page-num');
  if (ind) ind.textContent = instrCurrentPage + ' / ' + total;
  const prev = document.getElementById('instr-btn-prev');
  const next = document.getElementById('instr-btn-next');
  if (prev) prev.disabled = instrCurrentPage === 1;
  if (next) next.disabled = instrCurrentPage === total;
  const body = document.querySelector('#modal-instructions .modal-body');
  if (body) body.scrollTop = 0;
}

function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
  if (id === 'modal-instructions') instrGoTo(1);
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

// ── DESKTOP JOYSTICK ───────────────────────────────────────────────────────
function initDesktopJoystick() {
  if (window.MOBILE_MODE) return;
  const jEl = document.getElementById('desk-joystick');
  const rc  = document.getElementById('desk-joy-canvas');
  if (!jEl || !rc) return;
  const rctx = rc.getContext('2d');
  const W = rc.width, H = rc.height;
  const cx = W / 2, cy = H / 2;
  const R  = W / 2 - 3;

  function arrowHead(x1, y1, x2, y2, hw) {
    const a = Math.atan2(y2 - y1, x2 - x1);
    rctx.moveTo(x2, y2);
    rctx.lineTo(x2 - hw * Math.cos(a - 0.45), y2 - hw * Math.sin(a - 0.45));
    rctx.moveTo(x2, y2);
    rctx.lineTo(x2 - hw * Math.cos(a + 0.45), y2 - hw * Math.sin(a + 0.45));
  }

  function draw(tx, ty) {
    rctx.clearRect(0, 0, W, H);
    const bg = rctx.createRadialGradient(cx - 6, cy - 6, 2, cx, cy, R);
    bg.addColorStop(0, 'rgba(18,45,80,0.92)');
    bg.addColorStop(1, 'rgba(6,14,28,0.95)');
    rctx.beginPath(); rctx.arc(cx, cy, R, 0, Math.PI * 2);
    rctx.fillStyle = bg; rctx.fill();
    rctx.strokeStyle = 'rgba(95,200,232,0.32)'; rctx.lineWidth = 1.5; rctx.stroke();

    const gr = R * 0.38;
    rctx.strokeStyle = 'rgba(95,200,232,0.55)'; rctx.lineWidth = 1.2;
    rctx.beginPath(); rctx.arc(cx, cy, gr, 0, Math.PI * 2); rctx.stroke();
    rctx.strokeStyle = 'rgba(95,200,232,0.22)'; rctx.lineWidth = 0.8;
    [-0.55, 0, 0.55].forEach(f => {
      const ly = cy + f * gr, lw = Math.sqrt(Math.max(0, gr * gr - (f * gr) ** 2));
      rctx.beginPath(); rctx.ellipse(cx, ly, lw, lw * 0.32, 0, 0, Math.PI * 2); rctx.stroke();
    });
    rctx.beginPath(); rctx.ellipse(cx, cy, gr * 0.32, gr, 0, 0, Math.PI * 2); rctx.stroke();

    const ya = R * 0.80;
    rctx.strokeStyle = 'rgba(95,200,232,0.75)'; rctx.lineWidth = 1.8;
    rctx.beginPath(); rctx.arc(cx, cy, ya, Math.PI * 0.62, Math.PI * 0.98); rctx.stroke();
    const la = Math.PI * 0.98;
    rctx.beginPath(); arrowHead(cx + ya * Math.cos(la - 0.12), cy + ya * Math.sin(la - 0.12), cx + ya * Math.cos(la), cy + ya * Math.sin(la), 5); rctx.stroke();
    rctx.beginPath(); rctx.arc(cx, cy, ya, Math.PI * 1.02, Math.PI * 1.38); rctx.stroke();
    const ra = Math.PI * 1.02;
    rctx.beginPath(); arrowHead(cx + ya * Math.cos(ra + 0.12), cy + ya * Math.sin(ra + 0.12), cx + ya * Math.cos(ra), cy + ya * Math.sin(ra), 5); rctx.stroke();

    rctx.strokeStyle = 'rgba(95,200,232,0.50)'; rctx.lineWidth = 1.5;
    const tv = R * 0.82;
    rctx.beginPath(); rctx.moveTo(cx, cy - tv); rctx.lineTo(cx, cy - tv + 12); rctx.stroke();
    rctx.beginPath(); arrowHead(cx, cy - tv + 6, cx, cy - tv, 5); rctx.stroke();
    rctx.beginPath(); rctx.moveTo(cx, cy + tv); rctx.lineTo(cx, cy + tv - 12); rctx.stroke();
    rctx.beginPath(); arrowHead(cx, cy + tv - 6, cx, cy + tv, 5); rctx.stroke();

    if (tx !== null) {
      rctx.beginPath(); rctx.arc(cx + tx, cy + ty, 6, 0, Math.PI * 2);
      rctx.fillStyle = 'rgba(95,200,232,0.88)'; rctx.fill();
      rctx.strokeStyle = '#fff'; rctx.lineWidth = 1; rctx.stroke();
    }
  }

  draw(null, null);

  let _j = { active:false, lx:0, ly:0, tx:0, ty:0, snapId:0 };
  const SENS = 0.008, TMAX = R * 0.42;

  jEl.addEventListener('mousedown', e => {
    e.preventDefault(); e.stopPropagation();
    _j.active = true; _j.snapId++;
    _j.lx = e.clientX; _j.ly = e.clientY;
    _j.tx = 0; _j.ty = 0;
  });

  document.addEventListener('mousemove', e => {
    if (!_j.active) return;
    const dx = e.clientX - _j.lx, dy = e.clientY - _j.ly;
    _j.lx = e.clientX; _j.ly = e.clientY;
    _j.tx = Math.max(-TMAX, Math.min(TMAX, _j.tx + dx));
    _j.ty = Math.max(-TMAX, Math.min(TMAX, _j.ty + dy));
    adjustYaw(dx * SENS);
    adjustTilt(-dy * SENS);
    draw(_j.tx, _j.ty);
  });

  document.addEventListener('mouseup', e => {
    if (!_j.active) return;
    _j.active = false;
    const id = ++_j.snapId;
    let tx = _j.tx, ty = _j.ty;
    function snap() {
      if (_j.snapId !== id) return;
      tx *= 0.7; ty *= 0.7;
      draw(Math.abs(tx) < 0.5 ? null : tx, Math.abs(ty) < 0.5 ? null : ty);
      if (Math.abs(tx) >= 0.5 || Math.abs(ty) >= 0.5) requestAnimationFrame(snap);
    }
    requestAnimationFrame(snap);
  });
}

// ── BOOT ───────────────────────────────────────────────────────────────────
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
