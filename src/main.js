import * as THREE from 'three';
import { buildCity, CITY } from './city.js';
import { createHumanoid } from './humanoid.js';
import { createScooter, SCOOTER, updateScooterVisual } from './scooter.js';
import { createCrowd, nearestCop, scareCrowd } from './npc.js';
import { GameAudio } from './audio.js';
import {
  angleDiff, clamp, damp, dampAngle, dist2D, formatMoney, resolveCircleAABB,
} from './utils.js';

const PARAMS = new URLSearchParams(location.search);
const TEST_MODE_EARLY = PARAMS.has('test');
const FORCE_TOUCH = PARAMS.has('touch');
const MOBILE = FORCE_TOUCH || window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
const STREAM_RADIUS = TEST_MODE_EARLY ? 2 : (MOBILE ? 1 : 2);
if (MOBILE) document.documentElement.classList.add('touch');
if (TEST_MODE_EARLY) {
  const report = (msg) => {
    const box = document.getElementById('test-results');
    if (!box) return;
    box.classList.remove('hidden');
    box.dataset.ready = '1';
    box.dataset.summary = 'error';
    box.textContent = msg;
  };
  window.addEventListener('error', (e) => report(`ERROR: ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}\n${e.error && e.error.stack ? e.error.stack : ''}`));
  window.addEventListener('unhandledrejection', (e) => report(`REJECTION: ${e.reason && e.reason.stack ? e.reason.stack : e.reason}`));
}

const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const audio = new GameAudio();

/* ------------------------------------------------------------------ */
/* Renderer / scene                                                    */
/* ------------------------------------------------------------------ */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !MOBILE, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MOBILE ? 1.35 : 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = !MOBILE;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#b8d2ea');
scene.fog = new THREE.Fog('#b8d2ea', MOBILE ? 78 : 105, MOBILE ? 240 : 335);

const camera = new THREE.PerspectiveCamera(window.innerHeight > window.innerWidth ? 72 : 58, window.innerWidth / window.innerHeight, 0.1, 900);

function makeSky() {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#3f7fbd');
  g.addColorStop(0.42, '#94bfe3');
  g.addColorStop(0.72, '#d9e6ef');
  g.addColorStop(1, '#f4e3c8');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(700, 24, 16),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false, fog: false })
  );
  scene.add(sky);
}
makeSky();

const hemi = new THREE.HemisphereLight('#d7e8ff', '#6d6659', 1.25);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffe0b0', 2.35);
sun.position.set(95, 150, 55);
sun.castShadow = !MOBILE;
sun.shadow.mapSize.set(MOBILE ? 1024 : 2048, MOBILE ? 1024 : 2048);
sun.shadow.camera.near = 20;
sun.shadow.camera.far = 420;
sun.shadow.camera.left = -105;
sun.shadow.camera.right = 105;
sun.shadow.camera.top = 105;
sun.shadow.camera.bottom = -105;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.035;
scene.add(sun);
scene.add(sun.target);
const fill = new THREE.DirectionalLight('#a8c9ff', 0.5);
fill.position.set(-80, 60, -70);
scene.add(fill);

/* ------------------------------------------------------------------ */
/* World                                                               */
/* ------------------------------------------------------------------ */
const world = buildCity(scene, STREAM_RADIUS);
const crowd = createCrowd(scene, world, {
  mobile: MOBILE,
  pedCount: MOBILE ? 15 : 22,
  copCount: MOBILE ? 6 : 7,
});
const scooter = createScooter(scene);

/* ------------------------------------------------------------------ */
/* Player                                                              */
/* ------------------------------------------------------------------ */
const playerHuman = createHumanoid({
  player: true, shadow: true, skin: '#c98d61', hair: '#2a1c12',
  shirt: '#20242c', pants: '#2f3a4a', shoes: '#ece8dd', height: 1.0,
});
scene.add(playerHuman.root);

const player = {
  human: playerHuman,
  position: new THREE.Vector3(0, 0, 8),
  heading: Math.PI,
  onFoot: true,
  speed: 0,
  vy: 0,
  onGround: true,
  steer: 0,
  wheelie: 0,
  wheelieActive: false,
  wheelieScored: false,
  radius: 0.38,
  health: 100,
};
playerHuman.root.position.copy(player.position);
playerHuman.root.rotation.y = player.heading;

const game = {
  stars: 0,
  cash: 0,
  heat: 0,
  decay: 0,
  time: 0,
  running: false,
  busted: false,
  paused: false,
  robbery: null,
  shake: 0,
  scooterSpawned: false,
  nearestShop: null,
  nearestCop: null,
  crowd,
  world,
  scooter,
  player,
  collisions: 0,
  wheelieStars: 0,
};

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */
const keys = new Set();
const input = {
  forward: 0, back: 0, left: 0, right: 0, sprint: false, jump: false,
  tx: 0, ty: 0, mag: 0, touchJump: false, touchSprint: false,
};
function syncInput() {
  const kx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + input.tx;
  const ky = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) + input.ty;
  input.forward = clamp(ky, 0, 1);
  input.back = clamp(-ky, 0, 1);
  input.left = clamp(-kx, 0, 1);
  input.right = clamp(kx, 0, 1);
  input.mag = clamp(Math.hypot(kx, ky), 0, 1);
  input.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight') || input.touchSprint;
  input.jump = keys.has('Space') || input.touchJump;
}

const cam = { yaw: Math.PI, pitch: 0.17, lastMouse: -9999, dist: 5.0 };
let pointerLocked = false;

window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  syncInput();
  if (e.repeat) return;
  if (e.code === 'KeyF' && game.running && !game.paused) interactRide();
  if (e.code === 'KeyE' && game.running && !game.paused) interactAction();
  if (e.code === 'KeyM') {
    audio.setMuted(!audio.muted);
    toast(audio.muted ? 'Audio muted' : 'Audio on', audio.muted ? 'bad' : 'good', '♪');
  }
  if (e.code === 'Escape' && game.running && !game.busted && !game.paused) setPaused(true);
});
window.addEventListener('keyup', (e) => { keys.delete(e.code); syncInput(); });

canvas.addEventListener('mousedown', () => {
  if (!MOBILE && game.running && !game.paused && !game.busted) canvas.requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  if (!MOBILE && !pointerLocked && game.running && !game.busted && !game.paused) setPaused(true);
});
document.addEventListener('mousemove', (e) => {
  if (!pointerLocked) return;
  cam.yaw -= e.movementX * 0.0021;
  cam.pitch = clamp(cam.pitch + e.movementY * 0.0016, -0.12, 0.86);
  cam.lastMouse = performance.now();
});

function setPaused(on) {
  game.paused = on;
  $('pause').classList.toggle('hidden', !on);
}

$('resume-btn').addEventListener('click', () => {
  setPaused(false);
  if (!MOBILE) canvas.requestPointerLock();
});

/* ------------------------------------------------------------------ */
/* Touch controls                                                      */
/* ------------------------------------------------------------------ */
const stickEl = $('touch-stick');
const knobEl = $('touch-knob');
let stickId = null;

function updateStick(e) {
  if (!stickEl) return;
  const r = stickEl.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let dx = e.clientX - cx, dy = e.clientY - cy;
  const max = r.width * 0.34;
  const len = Math.hypot(dx, dy);
  if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max; }
  if (knobEl) knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
  input.tx = dx / max;
  input.ty = -dy / max;
  syncInput();
}
function endStick(e) {
  if (stickId !== null && e.pointerId !== stickId) return;
  stickId = null;
  input.tx = 0; input.ty = 0;
  if (knobEl) knobEl.style.transform = 'translate(0px, 0px)';
  syncInput();
}
if (stickEl) {
  stickEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    stickId = e.pointerId;
    updateStick(e);
    try { stickEl.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
  });
  stickEl.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) { e.preventDefault(); updateStick(e); } });
  stickEl.addEventListener('pointerup', endStick);
  stickEl.addEventListener('pointercancel', endStick);
}

let lookId = null, lookX = 0, lookY = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (!MOBILE || !game.running || game.paused || game.busted) return;
  lookId = e.pointerId; lookX = e.clientX; lookY = e.clientY;
});
window.addEventListener('pointermove', (e) => {
  if (e.pointerId !== lookId) return;
  const dx = e.clientX - lookX, dy = e.clientY - lookY;
  lookX = e.clientX; lookY = e.clientY;
  cam.yaw -= dx * 0.0052;
  cam.pitch = clamp(cam.pitch + dy * 0.0034, -0.12, 0.86);
  cam.lastMouse = performance.now();
});
window.addEventListener('pointerup', (e) => { if (e.pointerId === lookId) lookId = null; });
window.addEventListener('pointercancel', (e) => { if (e.pointerId === lookId) lookId = null; });

function bindTouchButton(id, fn) {
  const el = $(id);
  if (!el) return;
  el.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    fn();
  });
}

if (MOBILE) {
  bindTouchButton('touch-ride', () => { if (game.running && !game.paused) interactRide(); });
  bindTouchButton('touch-action', () => { if (game.running && !game.paused) interactAction(); });
  bindTouchButton('touch-pause', () => { if (game.running && !game.busted) setPaused(true); });
  const jumpEl = $('touch-jump');
  if (jumpEl) {
    jumpEl.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      input.touchJump = true; jumpEl.classList.add('pressed'); syncInput();
    });
    const release = (e) => {
      if (e) e.preventDefault();
      input.touchJump = false; jumpEl.classList.remove('pressed'); syncInput();
    };
    jumpEl.addEventListener('pointerup', release);
    jumpEl.addEventListener('pointercancel', release);
    jumpEl.addEventListener('pointerleave', release);
  }
  const runEl = $('touch-run');
  if (runEl) runEl.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    input.touchSprint = !input.touchSprint;
    runEl.classList.toggle('active', input.touchSprint);
    syncInput();
  });
}

/* ------------------------------------------------------------------ */
/* HUD helpers                                                         */
/* ------------------------------------------------------------------ */
const starsEl = $('stars');
for (let i = 0; i < 5; i++) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.classList.add('star');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  p.setAttribute('points', '12,1.8 15.1,8.4 22.4,9.2 17,14.3 18.5,21.6 12,17.9 5.5,21.6 7,14.3 1.6,9.2 8.9,8.4');
  p.setAttribute('fill', 'currentColor');
  svg.appendChild(p);
  starsEl.appendChild(svg);
}
const starEls = [...starsEl.children];

function renderStars(bump = -1) {
  starEls.forEach((el, i) => {
    el.classList.toggle('on', i < game.stars);
    if (i === bump) {
      el.classList.remove('pulse');
      void el.offsetWidth;
      el.classList.add('pulse');
    }
  });
}

function setCash(v, animate = true) {
  game.cash = Math.max(0, Math.round(v));
  $('cash-value').textContent = formatMoney(game.cash);
  if (animate) {
    const el = $('cash-value');
    el.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.12)', color: '#67f5a0' }, { transform: 'scale(1)' }],
      { duration: 420, easing: 'ease-out' }
    );
  }
}

function toast(text, kind = '', icon = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = icon ? `<span class="ticon">${icon}</span><span>${text}</span>` : `<span>${text}</span>`;
  $('toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 320);
  }, 2600);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function groundHeightAt(x, z) {
  const start = -CITY.half + CITY.road;
  const rx = x - start, rz = z - start;
  if (rx < 0 || rz < 0) return 0;
  const ix = Math.floor(rx / CITY.pitch);
  const iz = Math.floor(rz / CITY.pitch);
  if (ix < 0 || iz < 0 || ix >= CITY.grid || iz >= CITY.grid) return 0;
  const lx = rx - ix * CITY.pitch, lz = rz - iz * CITY.pitch;
  if (lx <= CITY.block && lz <= CITY.block) return 0.24;
  return 0;
}

function collidesAt(x, z, radius) {
  for (const c of world.colliders) {
    if (x + radius < c.minX || x - radius > c.maxX || z + radius < c.minZ || z - radius > c.maxZ) continue;
    const nx = clamp(x, c.minX, c.maxX), nz = clamp(z, c.minZ, c.maxZ);
    if ((x - nx) ** 2 + (z - nz) ** 2 < radius * radius) return true;
  }
  return false;
}

function moveCircle(pos, dx, dz, radius) {
  pos.x += dx;
  pos.z += dz;
  for (const c of world.colliders) {
    if (pos.x + radius < c.minX || pos.x - radius > c.maxX || pos.z + radius < c.minZ || pos.z - radius > c.maxZ) continue;
    resolveCircleAABB(pos, radius, c);
  }
  pos.x = clamp(pos.x, -CITY.half + 0.8, CITY.half - 0.8);
  pos.z = clamp(pos.z, -CITY.half + 0.8, CITY.half - 0.8);
}

let nearScooter = false;
let nearShop = null;

function nearestShopAt(x, z, maxDist = 3.6) {
  let best = null, bd = maxDist;
  for (const s of world.shops) {
    const d = dist2D(x, z, s.door.x, s.door.z);
    if (d < bd) { bd = d; best = s; }
  }
  return best ? { shop: best, dist: bd } : null;
}

/* ------------------------------------------------------------------ */
/* Scooter: summon, mount, dismount                                    */
/* ------------------------------------------------------------------ */
function mountScooter(alwaysSummon = true) {
  if (alwaysSummon || !game.scooterSpawned) {
    const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
    let sx = player.position.x + fx * 2.2;
    let sz = player.position.z + fz * 2.2;
    if (collidesAt(sx, sz, 0.85)) { sx = player.position.x; sz = player.position.z; }
    const gy = groundHeightAt(sx, sz);
    scooter.root.position.set(sx, gy, sz);
    scooter.root.rotation.y = player.heading;
    scooter.root.visible = true;
    scooter.summonT = 0.9;
    game.scooterSpawned = true;
    audio.summon();
    toast('Kukirin G4 Master delivered', 'good', '⚡');
  }
  player.onFoot = false;
  player.speed = 0;
  player.vy = 0;
  player.onGround = true;
  player.wheelie = 0;
  playerHuman.sitting = false;
  playerHuman.riding = true;
  scooter.riderAttach.add(playerHuman.root);
  playerHuman.root.position.set(0, 0, 0);
  playerHuman.root.rotation.set(0, 0, 0);
  playerHuman.animate(0.016, 0);
  player.position.copy(scooter.root.position);
  cam.lastMouse = -9999;
}

function getOffScooter() {
  if (player.onFoot) return;
  if (Math.abs(player.speed) > 4.5) {
    toast('Slow down before hopping off!', 'bad', '!');
    return;
  }
  const h = player.heading;
  const right = new THREE.Vector3(Math.cos(h), 0, -Math.sin(h));
  let spot = scooter.root.position.clone().addScaledVector(right, 1.3);
  if (collidesAt(spot.x, spot.z, 0.55)) spot = scooter.root.position.clone().addScaledVector(right, -1.3);
  if (collidesAt(spot.x, spot.z, 0.55)) spot = scooter.root.position.clone().addScaledVector(new THREE.Vector3(-Math.sin(h), 0, -Math.cos(h)), 1.6);
  player.position.set(spot.x, groundHeightAt(spot.x, spot.z), spot.z);
  scene.add(playerHuman.root);
  playerHuman.root.position.copy(player.position);
  playerHuman.root.rotation.set(0, player.heading, 0);
  playerHuman.sitting = false;
  playerHuman.riding = false;
  playerHuman.animate(0.016, 0);
  player.onFoot = true;
  player.speed = 0;
  player.wheelie = 0;
  player.wheelieActive = false;
  cam.lastMouse = -9999;
}

function interactRide() {
  if (game.robbery || game.busted) return;
  if (player.onFoot) mountScooter(true);
  else getOffScooter();
}

function interactAction() {
  if (game.busted) return;
  if (player.onFoot) {
    const shopHit = nearestShopAt(player.position.x, player.position.z, 3.6);
    if (shopHit) { tryRob(shopHit.shop); return; }
    if (nearScooter && game.scooterSpawned) { mountScooter(false); return; }
    toast('Find a shop counter or summon your G4 with F', '', 'i');
  }
}

/* ------------------------------------------------------------------ */
/* Crime / wanted                                                      */
/* ------------------------------------------------------------------ */
let robberyTime = 3.2;
const TEST_MODE = new URLSearchParams(location.search).has('test');
if (TEST_MODE) robberyTime = 0.9;

function addWanted(n, reason) {
  const before = game.stars;
  game.stars = clamp(game.stars + n, 0, 5);
  game.heat = 42;
  game.decay = 0;
  renderStars(game.stars - 1);
  audio.star();
  audio.setWanted(game.stars > 0);
  $('siren-flash').style.display = game.stars > 0 ? 'block' : 'none';
  if (game.stars > before) {
    const label = reason === 'WHEELIE' ? 'Reckless wheelie' : 'Robbery in progress';
    toast(`${label} — ${game.stars}★ wanted`, 'bad', '★');
  }
}

function copSeesPlayer(cop) {
  const dx = player.position.x - cop.human.root.position.x;
  const dz = player.position.z - cop.human.root.position.z;
  const d = Math.hypot(dx, dz) || 1;
  const fx = Math.sin(cop.human.root.rotation.y);
  const fz = Math.cos(cop.human.root.rotation.y);
  return (dx / d) * fx + (dz / d) * fz > 0.15;
}

function tryRob(shop) {
  if (game.robbery) return;
  if (game.time < (shop.lootedUntil || 0)) {
    toast(`${shop.name} is cleaned out — try another block`, 'bad', '$');
    return;
  }
  game.robbery = { shop, t: 0, dur: robberyTime };
  addWanted(1, 'ROBBERY');
  audio.alarm();
  scareCrowd(crowd, player.position.x, player.position.z, 52);
  toast(`${shop.name}: grab the cash and go!`, 'gold', '$');
}

function finishRobbery() {
  const r = game.robbery;
  if (!r) return;
  const reward = 260 + Math.round(Math.random() * 240) + game.stars * 55;
  setCash(game.cash + reward);
  r.shop.lootedUntil = game.time + 80;
  world.rememberShopLoot(r.shop);
  game.robbery = null;
  audio.cash();
  toast(`Loot secured +${formatMoney(reward)}`, 'good', '$');
}

function updateCrime(dt) {
  const r = game.robbery;
  if (!r) return;
  const d = dist2D(player.position.x, player.position.z, r.shop.door.x, r.shop.door.z);
  if (player.onFoot && d < 4.4) {
    r.t += dt;
    if (r.t >= r.dur) finishRobbery();
  } else if (d >= 4.4) {
    game.robbery = null;
    toast('You left the till — alarm is still ringing', 'bad', '!');
  }
}

function updateWanted(dt) {
  if (game.stars <= 0) return;
  if (game.heat > 0) {
    game.heat -= dt;
    return;
  }
  const nc = nearestCop(crowd, player.position.x, player.position.z);
  if (nc.dist < 26 || game.robbery) { game.decay = 0; return; }
  game.decay += dt;
  if (game.decay > 14) {
    game.decay = 0;
    game.stars = Math.max(0, game.stars - 1);
    renderStars(-1);
    audio.setWanted(game.stars > 0);
    $('siren-flash').style.display = game.stars > 0 ? 'block' : 'none';
    toast(game.stars === 0 ? 'You lost the cops' : `Wanted level dropping — ${game.stars}★`, 'good', '✓');
  }
}


/* ------------------------------------------------------------------ */
/* Busted flow                                                         */
/* ------------------------------------------------------------------ */
function bust() {
  if (game.busted) return;
  game.busted = true;
  game.robbery = null;
  audio.bust();
  const fine = Math.min(game.cash, 150);
  setCash(game.cash - fine, false);
  $('busted-text').textContent = `The LCPD got you. Fine paid: ${formatMoney(fine)}.`;
  $('busted').classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
}
game.bust = bust;

$('busted-btn').addEventListener('click', () => {
  $('busted').classList.add('hidden');
  if (!player.onFoot) {
    scene.add(playerHuman.root);
    playerHuman.sitting = false;
    playerHuman.riding = false;
    player.onFoot = true;
  }
  player.position.set(0, 0, 8);
  player.heading = Math.PI;
  player.speed = 0;
  player.position.y = groundHeightAt(0, 8);
  playerHuman.root.position.copy(player.position);
  playerHuman.root.rotation.set(0, player.heading, 0);
  playerHuman.animate(0.016, 0);
  game.stars = 0;
  game.heat = 0;
  game.decay = 0;
  game.busted = false;
  game.paused = false;
  renderStars();
  audio.setWanted(false);
  $('siren-flash').style.display = 'none';
  for (const cop of crowd.cops) cop.arrest = 0;
  cam.yaw = player.heading + Math.PI;
  if (!MOBILE) canvas.requestPointerLock();
});

/* ------------------------------------------------------------------ */
/* Player movement                                                     */
/* ------------------------------------------------------------------ */
function updateOnFoot(dt) {
  const p = player;
  const mf = input.forward - input.back;
  const mr = input.right - input.left;
  const baseSpeed = input.sprint ? 7.3 : 4.25;
  const speed = baseSpeed * (0.45 + 0.55 * clamp(input.mag || 1, 0, 1));
  if (mf || mr) {
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
    const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    let dx = fx * mf + rx * mr;
    let dz = fz * mf + rz * mr;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    p.heading = dampAngle(p.heading, Math.atan2(dx, dz), 13, dt);
    moveCircle(p.position, dx * speed * dt, dz * speed * dt, p.radius);
    p.speed = speed;
    p.human.animate(dt, speed);
  } else {
    p.speed = 0;
    p.human.animate(dt, 0);
  }
  const ground = groundHeightAt(p.position.x, p.position.z);
  if (input.jump && p.onGround) {
    p.vy = 5.3;
    p.onGround = false;
    audio.blip(300, 0.08, 'sine', 0.035);
  }
  if (!p.onGround) {
    p.vy -= 16 * dt;
    p.position.y += p.vy * dt;
    if (p.position.y <= ground) { p.position.y = ground; p.vy = 0; p.onGround = true; }
  } else {
    p.position.y = damp(p.position.y, ground, 18, dt);
  }
  p.human.root.position.copy(p.position);
  p.human.root.rotation.y = dampAngle(p.human.root.rotation.y, p.heading, 18, dt);
}

function updateRiding(dt) {
  const p = player;
  const throttle = input.forward - input.back;
  const steer = input.left - input.right;
  let speed = p.speed;

  if (throttle > 0) {
    speed += SCOOTER.accel * dt * (1 - Math.max(0, speed) / SCOOTER.maxSpeed * 0.55);
    speed = Math.min(speed, SCOOTER.maxSpeed);
  } else if (throttle < 0) {
    if (speed > 0.15) speed -= SCOOTER.brake * dt;
    else {
      speed -= 4.2 * dt;
      speed = Math.max(speed, -SCOOTER.reverseMax);
    }
  } else {
    speed *= Math.exp(-1.15 * dt);
    if (Math.abs(speed) < 0.04) speed = 0;
  }

  if (Math.abs(speed) > 0.25) {
    const turn = 2.15 / (1 + Math.abs(speed) * 0.045);
    p.heading += steer * turn * dt * clamp(Math.abs(speed) / 4.2, 0.28, 1) * Math.sign(speed);
  }
  p.steer = damp(p.steer, steer, 9, dt);

  const bx = p.position.x, bz = p.position.z;
  const expected = Math.abs(speed * dt);
  moveCircle(p.position, Math.sin(p.heading) * speed * dt, Math.cos(p.heading) * speed * dt, SCOOTER.radius);
  const moved = Math.hypot(p.position.x - bx, p.position.z - bz);
  if (expected > 0.03 && moved < expected * 0.5) {
    if (Math.abs(speed) > 4) {
      game.shake = Math.min(0.5, 0.18 + Math.abs(speed) * 0.012);
      game.collisions++;
      audio.blip(90, 0.12, 'sawtooth', 0.06);
    }
    speed *= 0.22;
  }

  const wantWheelie = input.jump && Math.abs(speed) > 2.6;
  p.wheelie = clamp(p.wheelie + (wantWheelie ? dt * 3.6 : -dt * 4.4), 0, 0.95);
  if (p.wheelie > 0.3) speed *= 1 - 0.06 * dt;

  if (p.wheelie > 0.35 && !p.wheelieActive) {
    p.wheelieActive = true;
    p.wheelieScored = false;
  }
  if (p.wheelieActive && p.wheelie < 0.12) {
    p.wheelieActive = false;
    p.wheelieScored = false;
  }
  if (p.wheelieActive && p.wheelie > 0.42 && !p.wheelieScored) {
    const nc = nearestCop(crowd, p.position.x, p.position.z);
    if (nc.cop && nc.dist < 34 && copSeesPlayer(nc.cop)) {
      p.wheelieScored = true;
      game.wheelieStars++;
      addWanted(1, 'WHEELIE');
    }
  }

  p.speed = speed;
  const gy = groundHeightAt(p.position.x, p.position.z);
  scooter.root.position.set(p.position.x, gy, p.position.z);
  scooter.root.rotation.y = p.heading;
  scooter.root.visible = true;
  updateScooterVisual(scooter, {
    speed, steerInput: p.steer, wheelieAngle: p.wheelie, dt, riding: true,
  });
  p.human.animate(dt, 0);
  p.position.y = gy;
}

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */
function updateCamera(dt) {
  const target = new THREE.Vector3();
  if (player.onFoot) {
    target.set(player.position.x, player.position.y + 1.45, player.position.z);
  } else {
    target.set(player.position.x, player.position.y + 1.42, player.position.z);
    if (performance.now() - cam.lastMouse > 1400) {
      cam.yaw = dampAngle(cam.yaw, player.heading + Math.PI, 3.2, dt);
    }
  }
  const dist = player.onFoot ? 4.7 : 5.6;
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const desired = new THREE.Vector3(
    target.x + Math.sin(cam.yaw) * cp * dist,
    target.y + sp * dist + 0.35,
    target.z + Math.cos(cam.yaw) * cp * dist
  );
  if (game.shake > 0) {
    game.shake = Math.max(0, game.shake - dt * 1.8);
    desired.x += (Math.random() - 0.5) * game.shake;
    desired.y += (Math.random() - 0.5) * game.shake;
  }
  camera.position.lerp(desired, 1 - Math.exp(-9 * dt));
  camera.lookAt(target);
}

/* ------------------------------------------------------------------ */
/* HUD + minimap                                                       */
/* ------------------------------------------------------------------ */
const promptEl = $('prompt');
const promptKey = $('prompt-key');
const promptText = $('prompt-text');
const promptBar = $('prompt-progress').querySelector('i');
const speedoFill = $('speedo-fill');
let speedoLen = 258;
try { speedoLen = speedoFill.getTotalLength(); } catch { /* SVG not measured yet */ }
speedoFill.style.strokeDasharray = String(speedoLen);
speedoFill.style.strokeDashoffset = String(speedoLen);

function updateHUD(dt) {
  const riding = !player.onFoot;
  $('mode-text').textContent = riding ? 'RIDING G4' : 'ON FOOT';
  $('ride-pill').classList.toggle('hidden', !riding);
  $('speedo').classList.toggle('hidden', !riding);
  $('wheelie-meter').classList.toggle('hidden', !riding);

  if (MOBILE) {
    const jl = $('touch-jump-label'), rl = $('touch-ride-label');
    if (jl) jl.textContent = riding ? 'WHEELIE' : 'JUMP';
    if (rl) rl.textContent = riding ? 'GET OFF' : 'RIDE';
  }

  if (riding) {
    const kmh = Math.round(Math.abs(player.speed) * 3.6);
    $('speed-text').textContent = String(kmh);
    $('speedo-num').textContent = String(kmh);
    speedoFill.style.strokeDashoffset = String(speedoLen * (1 - clamp(kmh / 62, 0, 1)));
    const deg = Math.round((player.wheelie / 0.95) * 62);
    $('wheelie-fill').style.width = `${(player.wheelie / 0.95) * 100}%`;
    $('wheelie-angle').textContent = `${deg}°`;
  }

  nearScooter = game.scooterSpawned && player.onFoot &&
    dist2D(player.position.x, player.position.z, scooter.root.position.x, scooter.root.position.z) < 3.4;
  const hit = player.onFoot ? nearestShopAt(player.position.x, player.position.z, 3.6) : null;
  game.nearestShop = hit;

  let show = true;
  let key = 'F';
  let text = '';
  let danger = false;
  let holding = false;

  if (game.robbery) {
    key = 'E';
    text = `Looting ${game.robbery.shop.name}…`;
    danger = true;
    holding = true;
    promptBar.style.width = `${(game.robbery.t / game.robbery.dur) * 100}%`;
  } else if (riding) {
    text = 'Get off the G4 Master';
  } else if (hit) {
    const looted = game.time < (hit.shop.lootedUntil || 0);
    if (looted) {
      key = 'E';
      text = `${hit.shop.name} — already cleaned out`;
      danger = false;
    } else {
      key = 'E';
      text = `Rob ${hit.shop.name}`;
      danger = true;
    }
  } else if (nearScooter) {
    text = 'Ride Kukirin G4 Master';
  } else {
    text = 'Summon Kukirin G4 Master';
  }

  promptEl.classList.toggle('hidden', !show);
  promptEl.classList.toggle('danger', danger);
  promptEl.classList.toggle('holding', holding);
  promptKey.textContent = key;
  promptText.textContent = text;
  if (!holding) promptBar.style.width = '0%';

  // minimap
  const now = performance.now();
  if (now - lastMinimap > 90) { lastMinimap = now; drawMinimap(); }
}

const mmCanvas = $('minimap');
const mmCtx = mmCanvas.getContext('2d');
let lastMinimap = 0;

function drawMinimap() {
  const w = mmCanvas.width, h = mmCanvas.height;
  const ctx = mmCtx;
  const pad = 8;
  const range = 225;
  const scale = (w - pad * 2) / (range * 2);
  const px = player.position.x, pz = player.position.z;
  const toX = (x) => pad + (x - px + range) * scale;
  const toY = (z) => pad + (z - pz + range) * scale;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(7,11,16,.94)';
  ctx.fillRect(0, 0, w, h);

  const i0 = Math.max(0, Math.floor((px - range + CITY.half - CITY.road) / CITY.pitch));
  const i1 = Math.min(CITY.grid - 1, Math.floor((px + range + CITY.half - CITY.road) / CITY.pitch));
  const j0 = Math.max(0, Math.floor((pz - range + CITY.half - CITY.road) / CITY.pitch));
  const j1 = Math.min(CITY.grid - 1, Math.floor((pz + range + CITY.half - CITY.road) / CITY.pitch));
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const x = CITY.blockStart(i), z = CITY.blockStart(j);
      ctx.fillStyle = '#1a2735';
      ctx.fillRect(toX(x), toY(z), CITY.block * scale, CITY.block * scale);
      ctx.strokeStyle = 'rgba(120,170,210,.12)';
      ctx.lineWidth = 1;
      ctx.strokeRect(toX(x) + 0.5, toY(z) + 0.5, CITY.block * scale - 1, CITY.block * scale - 1);
    }
  }

  for (const s of world.shops) {
    if (Math.abs(s.door.x - px) > range || Math.abs(s.door.z - pz) > range) continue;
    const looted = game.time < (s.lootedUntil || 0);
    ctx.fillStyle = looted ? 'rgba(150,160,170,.35)' : '#ffc93c';
    ctx.fillRect(toX(s.door.x) - 1.6, toY(s.door.z) - 1.6, 3.2, 3.2);
  }

  if (game.scooterSpawned) {
    ctx.fillStyle = '#ff6a1a';
    ctx.beginPath();
    ctx.arc(toX(scooter.root.position.x), toY(scooter.root.position.z), 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  const chase = game.stars > 0;
  for (const c of crowd.cops) {
    if (Math.abs(c.human.root.position.x - px) > range || Math.abs(c.human.root.position.z - pz) > range) continue;
    ctx.fillStyle = chase ? (Math.sin(game.time * 8) > 0 ? '#ff3b4e' : '#4d8bff') : '#5f9bd8';
    ctx.beginPath();
    ctx.arc(toX(c.human.root.position.x), toY(c.human.root.position.z), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  const mx = toX(px), mz = toY(pz);
  ctx.save();
  ctx.translate(mx, mz);
  ctx.rotate(Math.PI - player.heading);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(4.4, 5);
  ctx.lineTo(0, 2.6);
  ctx.lineTo(-4.4, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = 'rgba(255,255,255,.55)';
  ctx.font = '700 9px Inter, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('N', w - 10, 16);
  ctx.fillStyle = 'rgba(255,255,255,.38)';
  ctx.font = '700 8px Inter, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('1000× CITY', 9, h - 8);

  const far = Math.max(Math.abs(player.position.x), Math.abs(player.position.z));
  const ns = player.position.z < -1200 ? 'NORTH' : player.position.z > 1200 ? 'SOUTH' : '';
  const ew = player.position.x > 1200 ? 'EAST' : player.position.x < -1200 ? 'WEST' : '';
  let label = 'DOWNTOWN';
  if (far >= 1200) label = `${ns}${ew} DISTRICT`.trim();
  else if (far >= 420) label = 'CITY CENTRE';
  else if (far >= 120) label = 'OLD QUARTER';
  $('district').textContent = label;
}

/* ------------------------------------------------------------------ */
/* Main loop                                                           */
/* ------------------------------------------------------------------ */
let lastFrame = performance.now();
let introTime = 0;

function updateGame(dt) {
  game.time += dt;
  if (player.onFoot) updateOnFoot(dt);
  else updateRiding(dt);
  updateCrime(dt);
  updateWanted(dt);
  game.wanted = game.stars > 0;
  world.update(player.position.x, player.position.z, STREAM_RADIUS);
  crowd.update(dt, game);
  updateCamera(dt);
  audio.update(dt, {
    riding: !player.onFoot, speed: player.speed,
    throttle: input.forward, wheelie: player.wheelie,
  });
  sun.position.set(player.position.x + 95, 150, player.position.z + 55);
  sun.target.position.set(player.position.x, 0, player.position.z);
  sun.target.updateMatrixWorld();
}

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if (game.running) {
    if (!game.paused && !game.busted) updateGame(dt);
    updateHUD(dt);
  } else {
    introTime += dt;
    const a = introTime * 0.055 + 2.4;
    camera.position.set(Math.cos(a) * 108, 52 + Math.sin(introTime * 0.25) * 4, Math.sin(a) * 108);
    camera.lookAt(0, 12, 0);
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);

function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MOBILE ? 1.35 : 1.75));
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.fov = window.innerHeight > window.innerWidth ? 72 : 58;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 120));

/* ------------------------------------------------------------------ */
/* Start / pause / test                                                */
/* ------------------------------------------------------------------ */
function beginGame() {
  $('start').classList.add('hidden');
  $('hud').classList.remove('hidden');
  game.running = true;
  audio.start();
  $('siren-flash').style.display = 'none';
  renderStars();
  if (!TEST_MODE && !MOBILE) {
    try { canvas.requestPointerLock(); } catch { /* pointer lock is optional */ }
  }
}
$('start-btn').addEventListener('click', beginGame);

$('controls-toggle').addEventListener('click', () => {
  const body = document.querySelector('.controls-body');
  body.classList.toggle('hidden');
  $('controls-toggle').textContent = body.classList.contains('hidden') ? '+' : '−';
});

$('loading').classList.add('hidden');

/* Automated smoke test: open with ?test=1 */
async function runSelfTest() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const t = (name, pass, extra = '') => results.push({ name, pass: !!pass, extra: String(extra) });

  canvas.style.pointerEvents = 'none';
  beginGame();
  game.paused = true;
  const step = (seconds) => {
    const n = Math.ceil(seconds * 60);
    for (let i = 0; i < n; i++) updateGame(1 / 60);
  };
  step(0.2);
  t('1000x map area', ((CITY.half * 2) ** 2) / (350 ** 2) > 1000, (((CITY.half * 2) ** 2) / (350 ** 2)).toFixed(1));
  t('chunks streamed', world.loadedCount === 25, world.loadedCount);
  t('shops generated', world.shops.length >= 10, world.shops.length);
  t('houses generated', world.houses.length >= 10, world.houses.length);
  t('colliders generated', world.colliders.length > 40, world.colliders.length);
  t('pedestrians present', crowd.peds.length >= 15, crowd.peds.length);
  t('police present', crowd.cops.length >= 5, crowd.cops.length);
  t('player on foot', player.onFoot);

  mountScooter(true);
  step(0.3);
  t('scooter summons', game.scooterSpawned && scooter.root.visible, `${scooter.root.position.x.toFixed(1)}, ${scooter.root.position.z.toFixed(1)}`);
  t('rider standing on deck', playerHuman.root.parent === scooter.riderAttach && playerHuman.riding === true);
  t('scooter in front', dist2D(scooter.root.position.x, scooter.root.position.z, 0, 8) < 4, '');

  const p0 = player.position.clone();
  keys.add('KeyW'); syncInput();
  step(1.2);
  keys.delete('KeyW'); syncInput();
  t('throttle moves scooter', p0.distanceTo(player.position) > 1.5, p0.distanceTo(player.position).toFixed(2));
  t('speed registered', player.speed > 1, player.speed.toFixed(2));

  // stage a cop ahead of the rider so the wheelie can be witnessed; keep every
  // other cop far away so the nearest-cop check always picks the witness
  for (const cop of crowd.cops) {
    cop.human.root.position.set(player.position.x + 400, 0.24, player.position.z + 400);
  }
  const witness = crowd.cops[0];
  witness.human.root.position.set(player.position.x, 0.24, player.position.z + 20);
  witness.human.root.rotation.y = Math.PI;
  syncInput();
  keys.add('KeyW'); syncInput();
  step(0.5);
  const starsBeforeWheelie = game.stars;
  keys.add('Space'); syncInput();
  step(0.55);
  t('wheelie lifts', player.wheelie > 0.25, player.wheelie.toFixed(2));
  t('cop sees the wheelie', copSeesPlayer(witness));
  t('wheelie adds star', game.stars > starsBeforeWheelie, game.stars);
  keys.delete('Space'); keys.delete('KeyW'); syncInput();
  step(0.4);

  player.speed = 0;
  getOffScooter();
  step(0.2);
  t('dismount works', player.onFoot);

  const shop = world.shops[0];
  player.position.set(shop.door.x, groundHeightAt(shop.door.x, shop.door.z), shop.door.z);
  playerHuman.root.position.copy(player.position);
  step(0.1);
  const cash0 = game.cash;
  interactAction();
  t('robbery starts', !!game.robbery, shop.name);
  step(1.2);
  t('robbery pays cash', game.cash > cash0, game.cash - cash0);
  t('robbery adds stars', game.stars >= 1, game.stars);
  updateHUD(1 / 60);
  t('prompt is visible', !promptEl.classList.contains('hidden'));
  t('minimap drawn', mmCanvas.width > 0, mmCanvas.width);

  const payload = JSON.stringify(results, null, 1);
  const box = $('test-results');
  box.classList.remove('hidden');
  box.textContent = payload;
  box.dataset.ready = '1';
  box.dataset.summary = `${results.filter((r) => r.pass).length}/${results.length}`;
  console.log('SELFTEST', payload);
}

if (TEST_MODE) setTimeout(runSelfTest, 120);

window.__game = {
  game, player, scooter, world, crowd, camera, scene, renderer,
  mountScooter, getOffScooter, tryRob, addWanted, beginGame, updateGame,
  groundHeightAt, collidesAt, input, MOBILE, TEST_MODE,
};


