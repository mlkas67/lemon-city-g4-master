import * as THREE from 'three';
import { canvasTexture, makeCanvas, makeGlowTexture, mulberry32, pick, rnd } from './utils.js';

export const CITY = {
  grid: 198,
  block: 42,
  road: 14,
  pitch: 56,
  half: 5547,
};
CITY.inner = CITY.half - CITY.road;
CITY.blockStart = (i) => -CITY.half + CITY.road + i * CITY.pitch;
CITY.roadCenters = Array.from({ length: CITY.grid + 1 }, (_, i) => -CITY.half + CITY.road / 2 + i * CITY.pitch);
CITY.center = CITY.roadCenters[CITY.grid / 2];
export const START_POS = new THREE.Vector3(0, 0, 0);

const SHOP_NAMES = [
  ['LEMON MART', 'GROCERY'], ['NOVA CELL', 'PHONES'], ['GOLDEN NOODLE', 'NOODLES'],
  ['CITY FUEL', 'ENERGY'], ['PAWN & CO', 'PAWN'], ['VELVET LIQUOR', 'SPIRITS'],
  ['BYTE ELECTRONICS', 'TECH'], ['SUNSET DINER', 'DINER'], ['QUICKCASH', 'CASH'],
  ['URBAN THREADS', 'APPAREL'], ['24/7 BODEGA', 'GROCERY'], ['RECORD ROOM', 'MUSIC'],
  ['PIZZA 44', 'PIZZA'], ['LUCKY GOLD', 'JEWELRY'], ['NORTHSIDE PHARMACY', 'PHARMACY'],
  ['KICKFLIP', 'SNEAKERS'], ['THE COFFEE LAB', 'CAFE'], ['AUTO PARTS+', 'PARTS'],
  ['SILVER SCREEN', 'CINEMA'], ['FRESH CUT', 'BARBER'], ['ROBO SUSHI', 'SUSHI'],
  ['HARDWARE HOUSE', 'HARDWARE'], ['MINT MOBILE', 'PHONES'], ['THE BOOK NOOK', 'BOOKS'],
];
const SHOP_COLORS = ['#ff5b39', '#33d6c6', '#ffc93c', '#b06bff', '#ff3d7f', '#4d9bff', '#7dff8e', '#ff8a3d'];
const CAR_COLORS = ['#b53a31', '#2c4f7c', '#d8d5cc', '#25282d', '#6b7a4a', '#c58f35', '#3c6f6a', '#7c3f52'];

const _v = new THREE.Vector3();
let worldScene = null;
let activeChunkGroup = null;

const matCache = new Map();
function mat(color, rough = 0.86, metal = 0.02, extra = {}) {
  const key = `${color}|${rough}|${metal}|${JSON.stringify(extra)}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
    matCache.set(key, m);
  }
  return m;
}

function box(w, h, d, material, x, y, z, parent, shadow = true, receive = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = receive;
  parent.add(m);
  return m;
}

/* ------------------------------------------------------------------ */
/* Textures                                                            */
/* ------------------------------------------------------------------ */

function facadeTexture(base, litChance, style = 'grid') {
  const c = makeCanvas(256, 256);
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  // subtle panel noise
  for (let i = 0; i < 700; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, Math.random() * 10 + 1, 2);
  }
  ctx.fillStyle = 'rgba(0,0,0,.22)';
  for (let y = 0; y < 256; y += 64) ctx.fillRect(0, y, 256, 5);
  const cols = style === 'glass' ? 5 : 4;
  const rows = 4;
  const cw = 256 / cols, ch = 256 / rows;
  for (let ry = 0; ry < rows; ry++) {
    for (let cx = 0; cx < cols; cx++) {
      const x = cx * cw + cw * 0.22, y = ry * ch + ch * 0.2;
      const w = cw * 0.56, h = ch * 0.5;
      const lit = Math.random() < litChance;
      ctx.fillStyle = 'rgba(0,0,0,.32)';
      ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
      if (lit) {
        const g = ctx.createLinearGradient(x, y, x, y + h);
        g.addColorStop(0, Math.random() < 0.5 ? '#ffdca0' : '#b9dcff');
        g.addColorStop(1, '#7d6844');
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = style === 'glass' ? '#1c2c3d' : '#1b2028';
      }
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(255,255,255,.12)';
      ctx.fillRect(x, y, w * 0.28, h);
    }
  }
  return canvasTexture(c);
}

const signCache = new Map();
function signTexture(name, tag, accent) {
  const key = `${name}|${tag}|${accent}`;
  if (signCache.has(key)) return signCache.get(key);
  const c = makeCanvas(512, 128);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b0d12';
  ctx.fillRect(0, 0, 512, 128);
  const g = ctx.createLinearGradient(0, 0, 512, 0);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.5, accent + '33');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 5;
  ctx.strokeRect(7, 7, 498, 114);
  ctx.font = '800 62px "Barlow Condensed", "Arial Narrow", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = accent;
  ctx.shadowBlur = 18;
  ctx.fillStyle = '#fff8ec';
  ctx.fillText(name, 256, 58, 460);
  ctx.shadowBlur = 0;
  ctx.font = '700 17px "Inter", sans-serif';
  ctx.fillStyle = accent;
  ctx.fillText(tag, 256, 104, 400);
  const tex = canvasTexture(c);
  signCache.set(key, tex);
  return tex;
}

let shutterTex = null;
function shutterTexture() {
  if (shutterTex) return shutterTex;
  const c = makeCanvas(256, 256);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3b3f45';
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 12) {
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fillRect(0, y, 256, 4);
    ctx.fillStyle = 'rgba(255,255,255,.06)';
    ctx.fillRect(0, y + 4, 256, 2);
  }
  ctx.strokeStyle = 'rgba(220,30,40,.7)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(95, 100); ctx.lineTo(160, 150);
  ctx.moveTo(160, 100); ctx.lineTo(95, 150);
  ctx.stroke();
  shutterTex = canvasTexture(c);
  return shutterTex;
}

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

const leafMats = ['#356b3d', '#2d5e35', '#477a44', '#5b8a4a'].map((c) => mat(c, 0.95));
const trunkMat = mat('#5b4330', 0.95);

function makeTree(x, z, scale = 1) {
  const g = new THREE.Group();
  g.position.set(x, 0.12, z);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * scale, 0.32 * scale, 3.1 * scale, 7), trunkMat);
  trunk.position.y = 1.55 * scale;
  trunk.castShadow = true;
  g.add(trunk);
  const lm = pick(leafMats);
  for (let i = 0; i < 3; i++) {
    const r = (1.5 - i * 0.28) * scale;
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), lm);
    m.position.set((Math.random() - 0.5) * 0.9 * scale, (3.2 + i * 0.75) * scale, (Math.random() - 0.5) * 0.9 * scale);
    m.scale.y = 0.85;
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

function makeStreetLamp(x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0.12, z);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 6.4, 8), mat('#262b31', 0.5, 0.6));
  pole.position.y = 3.2; pole.castShadow = true; g.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.09, 0.09), mat('#262b31', 0.5, 0.6));
  arm.position.set(0.7, 6.3, 0); g.add(arm);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.16, 0.28), mat('#2a3038', 0.4, 0.5));
  head.position.set(1.38, 6.2, 0); g.add(head);
  const bulb = new THREE.Mesh(
    new THREE.PlaneGeometry(0.55, 0.22),
    new THREE.MeshBasicMaterial({ color: '#ffdf9e' })
  );
  bulb.position.set(1.38, 6.11, 0); bulb.rotation.x = Math.PI / 2; g.add(bulb);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowTexture(), color: '#ffb45e', transparent: true, opacity: 0.6,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  glow.scale.set(3.4, 3.4, 1); glow.position.set(1.38, 6.0, 0); g.add(glow);
  return g;
}

function makeHydrant(x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0.12, z);
  const m = mat('#c33a2e', 0.55, 0.1);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.62, 8), m);
  body.position.y = 0.31; body.castShadow = true; g.add(body);
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), m);
  top.position.y = 0.63; g.add(top);
  const side = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.42, 6), m);
  side.rotation.z = Math.PI / 2; side.position.y = 0.4; g.add(side);
  return g;
}

function makeBench(x, z, rot = 0) {
  const g = new THREE.Group();
  g.position.set(x, 0.12, z); g.rotation.y = rot;
  const wood = mat('#8a5f3a', 0.85);
  const iron = mat('#23282e', 0.6, 0.5);
  box(1.8, 0.08, 0.48, wood, 0, 0.46, 0, g);
  box(1.8, 0.42, 0.07, wood, 0, 0.72, -0.23, g);
  for (const sx of [-0.7, 0.7]) {
    box(0.08, 0.45, 0.42, iron, sx, 0.23, 0, g);
  }
  return g;
}

function makeCar(color, x, z, rotY) {
  const g = new THREE.Group();
  g.position.set(x, 0, z); g.rotation.y = rotY;
  const bodyM = mat(color, 0.35, 0.45);
  const glassM = mat('#182430', 0.18, 0.7);
  const tireM = mat('#101114', 0.85);
  box(1.9, 0.55, 4.2, bodyM, 0, 0.62, 0, g);
  const cabin = box(1.66, 0.52, 2.2, glassM, 0, 1.08, -0.18, g);
  cabin.geometry = new THREE.BoxGeometry(1.66, 0.52, 2.2);
  box(1.72, 0.1, 2.3, bodyM, 0, 1.35, -0.18, g);
  for (const sx of [-0.86, 0.86]) for (const sz of [-1.35, 1.35]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.24, 12), tireM);
    w.rotation.z = Math.PI / 2; w.position.set(sx, 0.35, sz); w.castShadow = true; g.add(w);
  }
  // lights
  const red = new THREE.MeshBasicMaterial({ color: '#ff2b2b' });
  const white = new THREE.MeshBasicMaterial({ color: '#fff4c2' });
  box(0.34, 0.12, 0.05, red, -0.6, 0.73, -2.11, g, false);
  box(0.34, 0.12, 0.05, red, 0.6, 0.73, -2.11, g, false);
  box(0.34, 0.12, 0.05, white, -0.6, 0.73, 2.11, g, false);
  box(0.34, 0.12, 0.05, white, 0.6, 0.73, 2.11, g, false);
  g.userData.collider = { minX: x - 1.15, maxX: x + 1.15, minZ: z - 2.25, maxZ: z + 2.25 };
  return g;
}

/* ------------------------------------------------------------------ */
/* Ground                                                              */
/* ------------------------------------------------------------------ */

function buildGround(scene) {
  const asphalt = mat('#2b2e34', 0.92, 0.02);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(CITY.half * 2 + 200, CITY.half * 2 + 200), asphalt);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  return ground;
}

function addBlockGround(group, i, j, rng) {
  const x = CITY.blockStart(i) + CITY.block / 2;
  const z = CITY.blockStart(j) + CITY.block / 2;
  const walkMat = mat('#8e8b83', 0.95);
  const walkTop = mat('#a4a096', 0.92);
  const kerbMat = mat('#b9b4a8', 0.9);

  box(CITY.block, 0.24, CITY.block, walkMat, x, 0.12, z, group, false, true);
  box(CITY.block - 7, 0.02, CITY.block - 7, walkTop, x, 0.245, z, group, false, true);

  const half = CITY.block / 2;
  for (const sz of [-half, half]) box(CITY.block + 0.5, 0.26, 0.35, kerbMat, x, 0.13, z + sz, group, false, true);
  for (const sx of [-half, half]) box(0.35, 0.26, CITY.block + 0.5, kerbMat, x + sx, 0.13, z, group, false, true);

  // Dashed centre lines tile every road without gaps or double-drawing.
  const dashMat = mat('#d8d3bf', 0.9, 0.02);
  const dashGeoH = new THREE.PlaneGeometry(3.1, 0.24);
  const dashGeoV = new THREE.PlaneGeometry(0.24, 3.1);
  const roadN = CITY.blockStart(j) - CITY.road / 2;
  const roadW = CITY.blockStart(i) - CITY.road / 2;
  for (let k = -4; k <= 4; k++) {
    const hx = x + k * 8.2;
    const d1 = new THREE.Mesh(dashGeoH, dashMat);
    d1.rotation.x = -Math.PI / 2;
    d1.position.set(hx, 0.035, roadN);
    group.add(d1);
    const d2 = new THREE.Mesh(dashGeoV, dashMat);
    d2.rotation.x = -Math.PI / 2;
    d2.position.set(roadW, 0.035, z + k * 8.2);
    group.add(d2);
  }

  // Crosswalk stripes at the block's north-west corner.
  const cwMat = mat('#e8e3d1', 0.92, 0.02);
  const stripeGeo = new THREE.PlaneGeometry(0.62, 2.6);
  for (let s = -2; s <= 2; s++) {
    const a = new THREE.Mesh(stripeGeo, cwMat);
    a.rotation.x = -Math.PI / 2;
    a.rotation.z = Math.PI / 2;
    a.position.set(roadW + s * 1.35, 0.04, roadN + CITY.road / 2 + 1.7);
    group.add(a);
    const b = new THREE.Mesh(stripeGeo, cwMat);
    b.rotation.x = -Math.PI / 2;
    b.position.set(roadW + CITY.road / 2 + 1.7, 0.04, roadN + s * 1.35);
    group.add(b);
  }

  if ((i + j) % 2 === 0) {
    const lamp = makeStreetLamp(x - half + 4.5, z - half + 4.5);
    group.add(lamp);
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    if (rng() < 0.32) group.add(makeTree(x + sx * 17.5, z + sz * 17.5, 0.85 + rng() * 0.25));
  }
  if (rng() < 0.3) group.add(makeHydrant(x + (rng() < 0.5 ? -17 : 17), z + (rng() < 0.5 ? -17 : 17)));
}

export { mat, box, makeTree, makeStreetLamp, makeBench, makeHydrant, facadeTexture, signTexture, shutterTexture, SHOP_NAMES, SHOP_COLORS };

/* ------------------------------------------------------------------ */
/* Buildings                                                           */
/* ------------------------------------------------------------------ */

const facadeBases = [
  ['#6f6a61', 0.4, 'grid'],
  ['#7b6656', 0.34, 'grid'],
  ['#575f68', 0.36, 'grid'],
  ['#8a7d6b', 0.32, 'grid'],
  ['#4c5660', 0.42, 'glass'],
  ['#795348', 0.3, 'grid'],
];
const facadeTex = facadeBases.map(([c, l, s]) => facadeTexture(c, l, s));
let facadeCursor = 0;

const facadeMatCache = new Map();
function facadeFor(w, h, rng) {
  const baseIndex = facadeCursor++ % facadeTex.length;
  const rx = Math.max(1, Math.round(w / 7));
  const ry = Math.max(1, Math.round((h - 3.3) / 4.2));
  const key = `${baseIndex}|${rx}|${ry}`;
  let material = facadeMatCache.get(key);
  if (material) return material;
  const tex = facadeTex[baseIndex].clone();
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(rx, ry);
  material = new THREE.MeshStandardMaterial({
    map: tex, roughness: 0.9, metalness: 0.02,
    emissiveMap: tex, emissive: new THREE.Color('#8a795f'), emissiveIntensity: 0.32,
  });
  facadeMatCache.set(key, material);
  return material;
}

function gableRoof(w, d, h, material) {
  const hw = w / 2, hd = d / 2;
  const pos = new Float32Array([
    -hw, 0, hd, hw, 0, hd, 0, h, hd,
    hw, 0, -hd, -hw, 0, -hd, 0, h, -hd,
    -hw, 0, hd, 0, h, hd, 0, h, -hd,
    -hw, 0, hd, 0, h, -hd, -hw, 0, -hd,
    hw, 0, hd, hw, 0, -hd, 0, h, -hd,
    hw, 0, hd, 0, h, -hd, 0, h, hd,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  return m;
}

const markerCache = new Map();
function shopMarkerTexture(accent) {
  if (markerCache.has(accent)) return markerCache.get(accent);
  const c = makeCanvas(128, 128);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.beginPath();
  ctx.arc(64, 58, 34, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(10,12,16,.78)';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = accent;
  ctx.stroke();
  ctx.font = '800 52px "Barlow Condensed", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('$', 64, 60);
  const tex = canvasTexture(c);
  markerCache.set(accent, tex);
  return tex;
}

function makeShop(spec) {
  const { x, z, w, d, h, rot, name, tag, accent, rng } = spec;
  const g = new THREE.Group();
  g.position.set(x, 0.24, z);
  g.rotation.y = rot;

  const frontM = facadeFor(w, h, rng);
  const trimM = mat('#3e4248', 0.7, 0.15);
  const glassM = new THREE.MeshStandardMaterial({
    color: '#0c171d', roughness: 0.14, metalness: 0.72,
    emissive: new THREE.Color('#1d333c'), emissiveIntensity: 0.55,
  });

  // upper block
  box(w, h - 3.3, d, frontM, 0, 3.3 + (h - 3.3) / 2, 0, g, true, true);
  // roof cap
  box(w + 0.45, 0.42, d + 0.45, trimM, 0, h + 0.2, 0, g, true);
  // ground floor shell
  box(w, 3.3, d, trimM, 0, 1.65, 0, g, true, true);

  // storefront glass (front)
  const zf = d / 2 + 0.02;
  box(w * 0.82, 2.7, 0.08, glassM, 0, 1.55, zf, g, false);
  // warm interior glow
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 0.7, 2.1),
    new THREE.MeshBasicMaterial({ color: '#ffd39a', transparent: true, opacity: 0.18 })
  );
  glow.position.set(0, 1.6, zf - 0.06);
  g.add(glow);
  // mullions + door frame
  for (const mx of [-w * 0.34, -w * 0.1, w * 0.1, w * 0.34]) {
    box(0.09, 2.75, 0.14, trimM, mx, 1.55, zf + 0.04, g, false);
  }
  box(w * 0.84, 0.1, 0.14, trimM, 0, 2.9, zf + 0.04, g, false);
  box(1.6, 2.32, 0.1, mat('#10151a', 0.4, 0.3), 0, 1.23, zf + 0.05, g, false);
  box(0.06, 0.28, 0.06, mat('#cfd4d8', 0.3, 0.7), 0.58, 1.2, zf + 0.13, g, false);

  // awning
  const awnM = mat(accent, 0.75);
  const awn = box(w * 0.86, 0.1, 1.35, awnM, 0, 3.3, zf + 0.6, g, true);
  awn.rotation.x = -0.16;
  box(w * 0.86, 0.32, 0.06, awnM, 0, 3.12, zf + 1.24, g, false);

  // sign
  const signMat = new THREE.MeshBasicMaterial({ map: signTexture(name, tag, accent), toneMapped: false });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(9.6, 2.4), signMat);
  sign.position.set(0, 4.45, zf + 0.22);
  g.add(sign);
  const signGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowTexture(), color: accent, transparent: true, opacity: 0.35,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  signGlow.scale.set(12, 5, 1);
  signGlow.position.set(0, 4.4, zf + 0.1);
  g.add(signGlow);

  // robbery beacon
  const alarm = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 8, 6),
    new THREE.MeshBasicMaterial({ color: '#ff2a35' })
  );
  alarm.position.set(w * 0.42, 3.55, zf + 0.2);
  alarm.visible = false;
  g.add(alarm);

  // shutter (hidden until robbed)
  const shutter = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 0.84, 2.75),
    new THREE.MeshStandardMaterial({ map: shutterTexture(), roughness: 0.75, metalness: 0.35 })
  );
  shutter.position.set(0, 1.58, zf + 0.14);
  shutter.visible = false;
  g.add(shutter);

  // rooftop clutter
  box(2.2, 1.0, 1.6, mat('#5b6067', 0.8, 0.2), -w * 0.22, h + 0.75, -d * 0.15, g, true);
  box(1.2, 0.8, 1.2, mat('#4b5058', 0.8, 0.2), w * 0.25, h + 0.65, d * 0.15, g, true);

  // door marker on the pavement
  const marker = new THREE.Sprite(new THREE.SpriteMaterial({
    map: shopMarkerTexture(accent), transparent: true, depthWrite: false,
  }));
  marker.scale.set(1.5, 1.5, 1);
  marker.position.set(0, 1.35, zf + 1.9);
  g.add(marker);

  (activeChunkGroup || worldScene).add(g);
  g.updateMatrixWorld(true);

  const front = new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot));
  const door = new THREE.Vector3(0, 0, d / 2 + 1.15).applyMatrix4(g.matrixWorld);
  door.y = 0.25;

  const halfW = w / 2, halfD = d / 2;
  let minX = x - halfW, maxX = x + halfW, minZ = z - halfD, maxZ = z + halfD;
  if (Math.abs(Math.sin(rot)) > 0.5) {
    minX = x - halfD; maxX = x + halfD; minZ = z - halfW; maxZ = z + halfW;
  }
  const collider = { minX, maxX, minZ, maxZ };

  return {
    name, tag, accent, group: g, door, front, center: new THREE.Vector3(x, 0, z),
    width: w, depth: d, height: h, collider,
    robbed: false, alarm, shutter, sign, marker, signGlow, glassM,
    alarmPhase: rng() * Math.PI * 2,
  };
}

function makeHouse(spec) {
  const { x, z, w, d, h, rot, color, rng } = spec;
  const g = new THREE.Group();
  g.position.set(x, 0.24, z);
  g.rotation.y = rot;
  const wallM = mat(color, 0.94);
  const trimM = mat('#e6e0d2', 0.85);
  const roofM = mat(pick(['#6e3f32', '#4d5359', '#5c4634', '#3d4d55']), 0.92);
  const glass = new THREE.MeshStandardMaterial({
    color: '#1a2833', roughness: 0.2, metalness: 0.55,
    emissive: new THREE.Color('#ffca7a'), emissiveIntensity: 0.24,
  });

  // body
  box(w, h, d, wallM, 0, h / 2, 0, g, true, true);
  box(w + 0.18, 0.24, d + 0.18, trimM, 0, h - 0.1, 0, g, true);
  const roof = gableRoof(w + 0.8, d + 0.8, 2.6, roofM);
  roof.position.y = h;
  g.add(roof);
  // chimney
  box(0.7, 1.7, 0.7, mat('#6d5a4d'), w * 0.28, h + 1.5, -d * 0.22, g, true);
  // windows
  const zf = d / 2 + 0.03;
  for (const wy of [1.7, h - 1.15]) {
    for (const wx of [-w * 0.26, w * 0.26]) {
      box(1.22, 1.28, 0.06, trimM, wx, wy, zf, g, false);
      box(1.02, 1.08, 0.05, glass, wx, wy, zf + 0.05, g, false);
      box(0.05, 1.08, 0.06, trimM, wx, wy, zf + 0.07, g, false);
    }
  }
  // door + porch
  box(1.5, 2.3, 0.1, mat('#3a2a22', 0.75), 0, 1.15, zf + 0.02, g, false);
  box(0.06, 0.24, 0.06, mat('#c9a95a', 0.4, 0.6), 0.5, 1.2, zf + 0.09, g, false);
  box(2.4, 0.28, 1.4, trimM, 0, 2.45, zf + 0.55, g, true);
  for (const px of [-1.05, 1.05]) box(0.12, 2.3, 0.12, trimM, px, 1.25, zf + 1.05, g, true);
  // porch light
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), new THREE.MeshBasicMaterial({ color: '#ffdca0' }));
  bulb.position.set(0.95, 2.2, zf + 0.12); g.add(bulb);
  // front path
  box(1.6, 0.03, 2.6, mat('#b7b1a5', 0.95), 0, 0.02, zf + 1.5, g, false);

  // picket fence across the front, leaving a gate gap
  const fenceM = mat('#d8d2c3', 0.9);
  for (let f = -Math.floor(w / 2); f <= Math.floor(w / 2); f += 1.05) {
    if (Math.abs(f) < 1.05) continue;
    box(0.07, 0.85, 0.07, fenceM, f, 0.4, zf + 2.9, g, false);
  }
  box(w - 2.2, 0.06, 0.06, fenceM, -w / 2 + 1.1, 0.68, zf + 2.9, g, false);
  box(w - 2.2, 0.06, 0.06, fenceM, w / 2 - 1.1, 0.68, zf + 2.9, g, false);

  // mailbox
  box(0.16, 0.7, 0.16, mat('#3a3f44', 0.7, 0.3), w * 0.32, 0.35, zf + 2.0, g, false);
  box(0.34, 0.24, 0.5, mat('#3d5a7a', 0.5, 0.3), w * 0.32, 0.82, zf + 2.0, g, false);

  (activeChunkGroup || worldScene).add(g);
  const halfW = w / 2, halfD = d / 2;
  let minX = x - halfW, maxX = x + halfW, minZ = z - halfD, maxZ = z + halfD;
  if (Math.abs(Math.sin(rot)) > 0.5) {
    minX = x - halfD; maxX = x + halfD; minZ = z - halfW; maxZ = z + halfW;
  }
  return { group: g, collider: { minX, maxX, minZ, maxZ } };
}

function makeTower(spec) {
  const { x, z, w, d, h, rot, rng } = spec;
  const g = new THREE.Group();
  g.position.set(x, 0.24, z);
  g.rotation.y = rot;
  const facade = facadeFor(w * 1.4, h, rng);
  const trimM = mat('#343a42', 0.6, 0.3);
  box(w, h, d, facade, 0, h / 2, 0, g, true, true);
  box(w + 1.1, 0.6, d + 1.1, trimM, 0, h + 0.3, 0, g, true);
  box(w * 0.55, 1.8, d * 0.5, trimM, 0, h + 1.5, 0, g, true);
  // antenna
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 7, 6), mat('#8d939a', 0.4, 0.7));
  ant.position.set(0, h + 5.2, 0); g.add(ant);
  // lobby
  const zf = d / 2 + 0.02;
  const glass = new THREE.MeshStandardMaterial({
    color: '#14232c', roughness: 0.12, metalness: 0.7,
    emissive: new THREE.Color('#ffd9a0'), emissiveIntensity: 0.25,
  });
  box(w * 0.8, 4.4, 0.1, glass, 0, 2.4, zf, g, false);
  box(w * 0.84, 0.35, 0.2, trimM, 0, 4.85, zf + 0.05, g, false);
  for (const mx of [-w * 0.3, -w * 0.1, w * 0.1, w * 0.3]) box(0.12, 4.4, 0.16, trimM, mx, 2.4, zf + 0.06, g, false);
  // roof logo
  const logo = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 2),
    new THREE.MeshBasicMaterial({ map: signTexture('LEMON TOWER', 'OFFICES', '#ffcf3f'), toneMapped: false })
  );
  logo.position.set(0, h * 0.72, zf + 0.12);
  g.add(logo);

  (activeChunkGroup || worldScene).add(g);
  return { group: g, collider: { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 } };
}

function makePark(parent, cx, cz, rng) {
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(CITY.block - 7, CITY.block - 7), mat('#4f6b3f', 0.98));
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(cx, 0.262, cz);
  grass.receiveShadow = true;
  parent.add(grass);

  const pathM = mat('#b9b3a5', 0.95);
  box(CITY.block - 7, 0.03, 3.2, pathM, cx, 0.27, cz, parent, false);
  box(3.2, 0.03, CITY.block - 7, pathM, cx, 0.27, cz, parent, false);
  for (const [dx, dz] of [[-9, -9], [9, -9], [-9, 9], [9, 9], [0, -13], [0, 13]]) {
    parent.add(makeTree(cx + dx, cz + dz, 1 + rng() * 0.25));
  }
  const fountainBase = new THREE.Mesh(
    new THREE.CylinderGeometry(3.2, 3.4, 0.6, 18),
    mat('#8d8a80', 0.85)
  );
  fountainBase.position.set(cx, 0.5, cz); fountainBase.receiveShadow = true; parent.add(fountainBase);
  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(2.85, 2.85, 0.12, 18),
    new THREE.MeshStandardMaterial({ color: '#2f6c7a', roughness: 0.15, metalness: 0.45 })
  );
  water.position.set(cx, 0.82, cz); parent.add(water);
  const jet = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.2, 2.2, 8),
    new THREE.MeshBasicMaterial({ color: '#a8e2ee', transparent: true, opacity: 0.5 })
  );
  jet.position.set(cx, 1.9, cz); parent.add(jet);
  for (const [ox, oz, rot] of [[-5, 4, 0.3], [5, 4, -0.3], [5, -4, 2.4], [-5, -4, 3.4]]) {
    parent.add(makeBench(cx + ox, cz + oz, rot));
  }
  return { x: cx, z: cz };
}

/* ------------------------------------------------------------------ */
/* City assembly                                                       */
/* ------------------------------------------------------------------ */

function blockRng(i, j, salt = 0) {
  return mulberry32(((i * 73856093) ^ (j * 19349663) ^ (salt * 83492791)) >>> 0);
}

function generateBlock(i, j, lootStore) {
  const rng = blockRng(i, j, 1);
  const group = new THREE.Group();
  const colliders = [];
  const shops = [];
  const houses = [];
  const parks = [];
  activeChunkGroup = group;
  addBlockGround(group, i, j, rng);

  const cx = CITY.blockStart(i) + CITY.block / 2;
  const cz = CITY.blockStart(j) + CITY.block / 2;
  const dist = Math.hypot(cx, cz);
  const roll = rng();
  const isPark = (i % 37 === 5 && j % 41 === 8) || (i % 43 === 9 && j % 29 === 3);
  const isOffice = !isPark && dist < CITY.pitch * 2.2 && roll < 0.22;

  if (isPark) {
    parks.push(makePark(group, cx, cz, rng));
  } else if (isOffice) {
    const w = 24 + rng() * 5, d = 21 + rng() * 4, h = 34 + rng() * 34;
    const rot = rng() < 0.5 ? 0 : Math.PI;
    const res = makeTower({ x: cx, z: cz, w, d, h, rot, rng });
    group.add(res.group);
    colliders.push(res.collider);
    for (const sx of [-1, 1]) group.add(makeTree(cx + sx * (w / 2 + 4), cz + 12, 0.9));
  } else {
    const shopChance = dist < CITY.pitch * 5 ? 0.78 : 0.46;
    const residential = rng() > shopChance;
    const sides = residential
      ? [rng() < 0.5 ? 0 : 2, rng() < 0.5 ? 1 : 3]
      : (rng() < 0.7 ? [0, 2] : [1, 3]);

    for (let s = 0; s < sides.length; s++) {
      const side = sides[s];
      const w = residential ? 10.5 + rng() * 2 : 20 + rng() * 5;
      const d = residential ? 8.5 + rng() * 2 : 13 + rng() * 3;
      const h = residential ? 5.6 + rng() * 1.8 : 8.5 + rng() * 13;
      let rot, px, pz;
      if (side === 0) { rot = Math.PI; px = cx + (rng() - 0.5) * (CITY.block - w - 8); pz = cz - CITY.block / 2 + d / 2 + 1.2; }
      else if (side === 1) { rot = Math.PI / 2; pz = cz + (rng() - 0.5) * (CITY.block - w - 8); px = cx + CITY.block / 2 - d / 2 - 1.2; }
      else if (side === 2) { rot = 0; px = cx + (rng() - 0.5) * (CITY.block - w - 8); pz = cz + CITY.block / 2 - d / 2 - 1.2; }
      else { rot = -Math.PI / 2; pz = cz + (rng() - 0.5) * (CITY.block - w - 8); px = cx - CITY.block / 2 + d / 2 - 1.2; }

      if (residential) {
        const house = makeHouse({
          x: px, z: pz, w, d, h, rot, rng,
          color: pick(['#c9bda5', '#d8cbb8', '#b5a390', '#9da3a0', '#c2a38a', '#a8b0b1', '#d6c2a4']),
        });
        group.add(house.group);
        colliders.push(house.collider);
        houses.push({ x: px, z: pz });
        if (rng() < 0.7) group.add(makeTree(px + (rng() - 0.5) * 8, pz + (rng() - 0.5) * 8, 0.8));
      } else {
        const nameIdx = (i * 17 + j * 29 + s * 7) % SHOP_NAMES.length;
        const [name, tag] = SHOP_NAMES[nameIdx];
        const accent = SHOP_COLORS[(i * 5 + j * 3 + s) % SHOP_COLORS.length];
        const shop = makeShop({ x: px, z: pz, w, d, h, rot, rng, name, tag, accent });
        shop.lootKey = `${i}:${j}:${s}`;
        const stored = lootStore.get(shop.lootKey);
        if (stored) shop.lootedUntil = stored;
        shops.push(shop);
        colliders.push(shop.collider);
      }
    }
    if (!residential && rng() < 0.55) group.add(makeBench(cx + (rng() - 0.5) * 16, cz + 8, rng() * Math.PI));
  }

  activeChunkGroup = null;
  return { key: `${i}:${j}`, i, j, group, colliders, shops, houses, parks };
}

export function buildCity(scene, initialRadius = 2) {
  worldScene = scene;
  const lootStore = new Map();
  const chunks = new Map();
  let pending = [];
  let currentKey = '';
  let radius = 2;

  buildGround(scene);

  const world = {
    colliders: [],
    shops: [],
    houses: [],
    parks: [],
    chunks,
    get loadedCount() { return chunks.size; },
    rememberShopLoot(shop) {
      if (shop.lootKey) lootStore.set(shop.lootKey, shop.lootedUntil || 0);
    },
    update(px, pz, nextRadius = radius, immediate = false) {
      radius = nextRadius;
      const ci = Math.floor((px + CITY.half - CITY.road) / CITY.pitch);
      const cj = Math.floor((pz + CITY.half - CITY.road) / CITY.pitch);
      const key = `${ci}:${cj}`;
      if (key !== currentKey) {
        currentKey = key;
        const wanted = new Set();
        for (let di = -radius; di <= radius; di++) {
          for (let dj = -radius; dj <= radius; dj++) {
            const i = ci + di, j = cj + dj;
            if (i < 0 || j < 0 || i >= CITY.grid || j >= CITY.grid) continue;
            wanted.add(`${i}:${j}`);
          }
        }
        for (const [k, chunk] of chunks) {
          if (wanted.has(k)) continue;
          scene.remove(chunk.group);
          const geoms = new Set();
          chunk.group.traverse((o) => { if (o.isMesh && o.geometry && !o.userData.sharedGeo) geoms.add(o.geometry); });
          for (const geo of geoms) geo.dispose();
          chunks.delete(k);
        }
        pending = [];
        for (const k of wanted) {
          if (chunks.has(k)) continue;
          const [i, j] = k.split(':').map(Number);
          pending.push({ i, j, d: di2(i - ci, j - cj) });
        }
        pending.sort((a, b) => a.d - b.d);
        refresh();
      }
      if (pending.length) {
        const budget = immediate ? pending.length : 2;
        for (let n = 0; n < budget && pending.length; n++) {
          const { i, j } = pending.shift();
          const k = `${i}:${j}`;
          if (chunks.has(k)) continue;
          const chunk = generateBlock(i, j, lootStore);
          chunks.set(k, chunk);
          scene.add(chunk.group);
        }
        refresh();
      }
    },
    pickBlockNear(x, z, minDist = 25, maxDist = 95) {
      const list = [...chunks.values()];
      if (!list.length) return null;
      const options = list.filter((c) => {
        const cx = CITY.blockStart(c.i) + CITY.block / 2;
        const cz = CITY.blockStart(c.j) + CITY.block / 2;
        const d = Math.hypot(cx - x, cz - z);
        return d >= minDist && d <= maxDist;
      });
      const c = options.length ? options[Math.floor(Math.random() * options.length)] : list[0];
      return { x: CITY.blockStart(c.i) + CITY.block / 2, z: CITY.blockStart(c.j) + CITY.block / 2, i: c.i, j: c.j };
    },
  };

  function di2(a, b) { return a * a + b * b; }

  function refresh() {
    const colliders = [];
    const shops = [];
    const houses = [];
    const parks = [];
    for (const c of chunks.values()) {
      colliders.push(...c.colliders);
      shops.push(...c.shops);
      houses.push(...c.houses);
      parks.push(...c.parks);
    }
    world.colliders = colliders;
    world.shops = shops;
    world.houses = houses;
    world.parks = parks;
  }

  world.update(START_POS.x, START_POS.z + 8, initialRadius, true);
  return world;
}
