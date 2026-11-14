import * as THREE from 'three';
import { canvasTexture, clamp, makeCanvas, makeGlowTexture } from './utils.js';

export const SCOOTER = {
  maxSpeed: 15.8,      // ~57 km/h
  accel: 10.5,
  brake: 18,
  reverseMax: 3.2,
  radius: 0.62,
  wheelBase: 1.34,
};

const WHEEL_RADIUS = 0.32;

function decalTexture(lines, accent = '#f5a24a', w = 512, h = 128, bg = 'rgba(0,0,0,0)') {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 54px "Barlow Condensed", "Arial Narrow", sans-serif';
  ctx.fillStyle = '#f2ead8';
  ctx.fillText(lines[0], w / 2, h * 0.4, w - 30);
  if (lines[1]) {
    ctx.font = '700 20px "Inter", sans-serif';
    ctx.fillStyle = accent;
    ctx.fillText(lines[1], w / 2, h * 0.76, w - 50);
  }
  return canvasTexture(c);
}

function woodTexture() {
  const c = makeCanvas(256, 512);
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, '#7d6139');
  grad.addColorStop(0.45, '#9c7c4b');
  grad.addColorStop(0.7, '#8a6a3d');
  grad.addColorStop(1, '#6f542f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 512);
  // Lengthwise grain so the deck reads as a varnished timber board.
  for (let i = 0; i < 120; i++) {
    const x = Math.random() * 256;
    ctx.strokeStyle = `rgba(${40 + Math.random() * 30},${28 + Math.random() * 22},${12 + Math.random() * 18},${0.08 + Math.random() * 0.16})`;
    ctx.lineWidth = 0.6 + Math.random() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + 6, 170, x - 5, 340, x + 2, 512);
    ctx.stroke();
  }
  // Cross slats.
  ctx.strokeStyle = 'rgba(38,26,14,0.5)';
  ctx.lineWidth = 2;
  for (let y = 28; y < 512; y += 42) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }
  return canvasTexture(c);
}

function rubberMat() {
  return new THREE.MeshStandardMaterial({ color: '#0d0e10', roughness: 0.96, metalness: 0.02 });
}
function paintMat(color = '#20242a', metal = 0.55) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.36, metalness: metal });
}

function addMesh(parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function makeWheel(radius) {
  const g = new THREE.Group();
  const tireMat = rubberMat();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.79, radius * 0.23, 12, 28), tireMat);
  tire.rotation.y = Math.PI / 2;
  tire.castShadow = true;
  g.add(tire);

  // Chunky off-road blocks around the tyre.
  const treadGeo = new THREE.BoxGeometry(radius * 0.55, radius * 0.1, radius * 0.13);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const block = new THREE.Mesh(treadGeo, tireMat);
    block.position.set(0, Math.cos(a) * radius * 0.91, Math.sin(a) * radius * 0.91);
    block.rotation.x = a;
    g.add(block);
  }

  const rim = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.57, radius * 0.57, radius * 0.3, 24),
    paintMat('#26282b', 0.78));
  rim.rotation.z = Math.PI / 2;
  g.add(rim);
  const rimFace = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.48, radius * 0.48, radius * 0.34, 24),
    paintMat('#141518', 0.6));
  rimFace.rotation.z = Math.PI / 2;
  g.add(rimFace);
  const accent = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.48, radius * 0.026, 6, 24),
    new THREE.MeshStandardMaterial({ color: '#f5a24a', roughness: 0.4, metalness: 0.45 }));
  accent.rotation.y = Math.PI / 2;
  g.add(accent);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.13, radius * 0.13, radius * 0.42, 12),
    paintMat('#0e0f12', 0.3));
  hub.rotation.z = Math.PI / 2;
  g.add(hub);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.34, radius * 0.34, radius * 0.018, 20),
    new THREE.MeshStandardMaterial({ color: '#8e949b', roughness: 0.25, metalness: 0.95 }));
  disc.rotation.z = Math.PI / 2;
  disc.position.x = radius * 0.22;
  g.add(disc);
  return g;
}

function makeSpring(radius, height, coils, material, tube = 0.012) {
  const pts = [];
  const n = coils * 22;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * coils * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, t * height - height / 2, Math.sin(a) * radius));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, n, tube, 5, false), material);
}

export function createScooter(scene) {
  const root = new THREE.Group();
  root.name = 'Kukirin G4 Master';
  const lean = new THREE.Group();
  root.add(lean);
  // Pivot at the rear axle so wheelies lift the front end.
  const pitch = new THREE.Group();
  pitch.position.set(0, 0.32, -0.67);
  lean.add(pitch);
  const model = new THREE.Group();
  model.position.set(0, -0.32, 0.67);
  pitch.add(model);

  const ink = paintMat('#17191c', 0.55);
  const satin = paintMat('#26282d', 0.35);
  const rubber = rubberMat();
  const alloy = new THREE.MeshStandardMaterial({ color: '#303338', roughness: 0.32, metalness: 0.82 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#a7abb1', roughness: 0.2, metalness: 0.96 });
  const gold = new THREE.MeshStandardMaterial({ color: '#d5a23c', roughness: 0.28, metalness: 0.9 });
  const orange = new THREE.MeshStandardMaterial({ color: '#f5a24a', roughness: 0.38, metalness: 0.4 });
  const orangeGlow = new THREE.MeshStandardMaterial({
    color: '#f5a24a', roughness: 0.4, metalness: 0.1,
    emissive: new THREE.Color('#c06a10'), emissiveIntensity: 0.35,
  });
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.68, metalness: 0.05 });

  // --- wheels ---
  const frontWheel = makeWheel(WHEEL_RADIUS);
  frontWheel.position.set(0, WHEEL_RADIUS, 0.67);
  model.add(frontWheel);
  const rearWheel = makeWheel(WHEEL_RADIUS);
  rearWheel.position.set(0, WHEEL_RADIUS, -0.67);
  model.add(rearWheel);

  // --- frame, deck and timber footboard ---
  addMesh(model, new THREE.BoxGeometry(0.17, 0.14, 1.2), ink, 0, 0.34, -0.02);
  addMesh(model, new THREE.BoxGeometry(0.46, 0.12, 1.09), ink, 0, 0.4, 0.01);
  addMesh(model, new THREE.BoxGeometry(0.3, 0.16, 0.79), paintMat('#111316', 0.3), 0, 0.29, -0.03);
  const board = addMesh(model, new THREE.BoxGeometry(0.43, 0.026, 1.0), wood, 0, 0.474, 0.01);
  board.receiveShadow = true;
  for (const sx of [-1, 1]) {
    addMesh(model, new THREE.BoxGeometry(0.028, 0.072, 1.03), orange, sx * 0.241, 0.438, 0.01);
    // Rear footrest shoulders.
    addMesh(model, new THREE.BoxGeometry(0.18, 0.055, 0.12), satin, sx * 0.24, 0.39, -0.53).rotation.y = sx * 0.35;
  }
  for (let i = 0; i < 7; i++) {
    addMesh(model, new THREE.BoxGeometry(0.36, 0.012, 0.013), paintMat('#3a2a18', 0.2), 0, 0.489, -0.42 + i * 0.14);
  }

  // --- rear swingarm, fender and twin shocks ---
  for (const sx of [-1, 1]) {
    const arm = addMesh(model, new THREE.BoxGeometry(0.055, 0.075, 0.55), satin, sx * 0.145, 0.31, -0.42);
    arm.rotation.x = 0.14;
    const shockRod = addMesh(model, new THREE.CylinderGeometry(0.018, 0.018, 0.3, 8), chrome, sx * 0.175, 0.47, -0.58);
    shockRod.rotation.x = -0.32;
    const spring = makeSpring(0.041, 0.23, 6, orange, 0.011);
    spring.position.set(sx * 0.175, 0.49, -0.58);
    spring.rotation.x = -0.32;
    model.add(spring);
  }
  const rearFender = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_RADIUS * 1.1, 0.04, 6, 22, Math.PI * 1.02), ink);
  rearFender.rotation.y = Math.PI / 2;
  rearFender.rotation.z = 0.5;
  rearFender.position.set(0, WHEEL_RADIUS, -0.7);
  rearFender.scale.set(1.5, 1, 1);
  rearFender.castShadow = true;
  model.add(rearFender);
  addMesh(model, new THREE.BoxGeometry(0.17, 0.055, 0.025), new THREE.MeshBasicMaterial({ color: '#ff242c' }), 0, 0.5, -0.77);
  addMesh(model, new THREE.BoxGeometry(0.2, 0.11, 0.018), paintMat('#0a0b0d', 0.2), 0, 0.39, -0.79);

  // --- steering column, fork and front suspension ---
  const steer = new THREE.Group();
  steer.position.set(0, 0.44, 0.56);
  steer.rotation.x = -0.16;
  model.add(steer);
  addMesh(steer, new THREE.CylinderGeometry(0.057, 0.07, 0.94, 12), ink, 0, 0.47, 0);
  addMesh(steer, new THREE.BoxGeometry(0.15, 0.1, 0.13), orange, 0, 0.36, 0.005);
  addMesh(steer, new THREE.CylinderGeometry(0.074, 0.074, 0.055, 12), alloy, 0, 0.3, 0);
  // Gold stanchions + black fork lowers.
  for (const sx of [-1, 1]) {
    const upper = addMesh(steer, new THREE.CylinderGeometry(0.023, 0.023, 0.36, 8), gold, sx * 0.135, 0.08, 0.005);
    upper.rotation.z = sx * 0.035;
    const lower = addMesh(steer, new THREE.CylinderGeometry(0.033, 0.029, 0.3, 8), satin, sx * 0.14, -0.19, 0.005);
    lower.rotation.z = sx * 0.035;
    const spring = makeSpring(0.031, 0.2, 5, orange, 0.009);
    spring.position.set(sx * 0.14, -0.07, 0.005);
    steer.add(spring);
  }
  addMesh(steer, new THREE.BoxGeometry(0.34, 0.07, 0.07), ink, 0, -0.33, 0.005);

  // Wide handlebar, grips, levers and dash.
  const bar = addMesh(steer, new THREE.CylinderGeometry(0.022, 0.022, 0.78, 10), chrome, 0, 1.0, 0);
  bar.rotation.z = Math.PI / 2;
  for (const sx of [-1, 1]) {
    const grip = addMesh(steer, new THREE.CylinderGeometry(0.034, 0.034, 0.19, 10), rubber, sx * 0.35, 1.0, 0);
    grip.rotation.z = Math.PI / 2;
    const lever = addMesh(steer, new THREE.BoxGeometry(0.15, 0.018, 0.028), chrome, sx * 0.26, 1.028, 0.055);
    lever.rotation.y = sx * 0.24;
    addMesh(steer, new THREE.BoxGeometry(0.06, 0.045, 0.055), satin, sx * 0.22, 1.0, 0.01);
    // Indicator pods.
    addMesh(steer, new THREE.SphereGeometry(0.022, 8, 6), orangeGlow, sx * 0.41, 1.01, 0.015);
  }
  const dash = addMesh(steer, new THREE.BoxGeometry(0.2, 0.13, 0.065), new THREE.MeshStandardMaterial({
    color: '#090b0f', roughness: 0.24, metalness: 0.3,
    emissive: new THREE.Color('#f5a24a'), emissiveIntensity: 0.6,
  }), 0, 1.065, 0.045);
  dash.rotation.x = -0.32;
  addMesh(steer, new THREE.BoxGeometry(0.225, 0.055, 0.08), satin, 0, 1.055, 0.012);

  // Headlight in the front cowl.
  addMesh(steer, new THREE.BoxGeometry(0.2, 0.16, 0.11), ink, 0, 0.82, 0.075);
  const headlight = addMesh(steer, new THREE.CylinderGeometry(0.07, 0.085, 0.045, 12),
    new THREE.MeshBasicMaterial({ color: '#fff5d8' }), 0, 0.82, 0.145);
  headlight.rotation.x = Math.PI / 2;
  const lampGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowTexture('rgba(255,245,210,1)'), color: '#ffdf9a', transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8,
  }));
  lampGlow.scale.set(1.4, 1.4, 1);
  lampGlow.position.set(0, 0.82, 0.2);
  steer.add(lampGlow);
  // Front mudguard.
  const frontFender = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_RADIUS * 1.12, 0.042, 6, 22, Math.PI * 1.02), ink);
  frontFender.rotation.y = Math.PI / 2;
  frontFender.rotation.z = 1.52;
  frontFender.position.set(0, WHEEL_RADIUS, 0.67);
  frontFender.scale.set(1.5, 1, 1);
  model.add(frontFender);
  addMesh(model, new THREE.BoxGeometry(0.1, 0.025, 0.32), orange, 0, 0.54, 0.62).rotation.x = -0.28;

  // Side stand.
  const stand = addMesh(model, new THREE.CylinderGeometry(0.014, 0.014, 0.34, 6), alloy, -0.22, 0.2, -0.24);
  stand.rotation.z = 0.55;
  stand.rotation.x = 0.25;

  // --- decals ---
  const deckDecalMat = new THREE.MeshBasicMaterial({
    map: decalTexture(['KUKIRIN', 'G4 MASTER'], '#f5a24a', 512, 128, 'rgba(0,0,0,0)'),
    transparent: true, toneMapped: false,
  });
  for (const sx of [-1, 1]) {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.15), deckDecalMat);
    d.position.set(sx * 0.256, 0.44, 0.02);
    d.rotation.y = sx * Math.PI / 2;
    model.add(d);
  }
  const frontLogo = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.09),
    new THREE.MeshBasicMaterial({
      map: decalTexture(['G4'], '#f5a24a', 256, 128, 'rgba(0,0,0,0)'), transparent: true, toneMapped: false,
    })
  );
  frontLogo.position.set(0, 0.87, 0.135);
  steer.add(frontLogo);

  // --- front light beam ---
  const beam = new THREE.SpotLight('#ffe2a8', 22, 30, Math.PI / 6, 0.55, 1.3);
  beam.position.set(0, 0.85, 0.22);
  beam.target.position.set(0, 0, 7);
  steer.add(beam);
  steer.add(beam.target);

  // summon FX ring
  const fxMat = new THREE.MeshBasicMaterial({
    color: '#ff8a35', transparent: true, opacity: 0, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const fxRing = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.08, 40), fxMat);
  fxRing.rotation.x = -Math.PI / 2;
  fxRing.position.y = 0.05;
  root.add(fxRing);
  const fxBeam = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowTexture(), color: '#ff8a35', transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  fxBeam.scale.set(2.4, 3.4, 1); fxBeam.position.y = 1.4; root.add(fxBeam);

  root.visible = false;
  scene.add(root);

  const state = {
    root, lean, pitch, model, steer, frontWheel, rearWheel, seat: null, headlight,
    fxRing, fxBeam,
    riderAttach: new THREE.Object3D(),
    wheelSpin: 0,
    summonT: 0,
    active: false,
  };
  // Stand-up deck: the rider's feet rest on the timber board.
  state.riderAttach.position.set(0, 0.49, 0.01);
  model.add(state.riderAttach);

  return state;
}

export function updateScooterVisual(scooter, { speed = 0, steerInput = 0, wheelie = 0, dt = 0, riding = true, wheelieAngle = 0 }) {
  const s = scooter;
  s.wheelSpin += (speed / WHEEL_RADIUS) * dt;
  s.frontWheel.rotation.x = s.wheelSpin;
  s.rearWheel.rotation.x = s.wheelSpin;
  s.steer.rotation.y = steerInput * 0.38;
  const leanTarget = -steerInput * clamp(Math.abs(speed) / 14, 0, 1) * 0.34;
  s.lean.rotation.z += (leanTarget - s.lean.rotation.z) * Math.min(1, dt * 8);
  s.pitch.rotation.x += (-wheelieAngle - s.pitch.rotation.x) * Math.min(1, dt * 9);
  if (s.summonT > 0) {
    s.summonT = Math.max(0, s.summonT - dt);
    const t = 1 - s.summonT / 0.9;
    s.model.scale.setScalar(0.35 + 0.65 * Math.min(1, t * 1.4));
    const glow = Math.sin(Math.min(1, t) * Math.PI);
    s.fxRing.material.opacity = glow * 0.85;
    s.fxRing.scale.setScalar(0.4 + t * 1.3);
    s.fxBeam.material.opacity = glow * 0.55;
  } else {
    s.model.scale.setScalar(1);
    s.fxRing.material.opacity = 0;
    s.fxBeam.material.opacity = 0;
  }
}
