import * as THREE from 'three';
import { createHumanoid, mat } from './humanoid.js';
import { CITY } from './city.js';
import { angleDiff, clamp, dampAngle, dist2D, pick, resolveCircleAABB, rnd } from './utils.js';

const COP_SKIN = ['#e0b08a', '#c58f63', '#9a6442', '#7b4a30', '#eec4a2'];

function blockWaypoints(cx, cz, inset = 18.2) {
  const h = CITY.block / 2 - 2.2;
  return [
    [cx - h, cz - h], [cx + h, cz - h], [cx + h, cz + h], [cx - h, cz + h],
  ];
}

function makePoliceCar(x, z, rotY, scene) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  const bodyM = new THREE.MeshStandardMaterial({ color: '#e8e8e4', roughness: 0.32, metalness: 0.4 });
  const blackM = new THREE.MeshStandardMaterial({ color: '#15181e', roughness: 0.4, metalness: 0.35 });
  const glassM = new THREE.MeshStandardMaterial({ color: '#101b24', roughness: 0.15, metalness: 0.7 });
  const tireM = mat('#0e0f12', 0.95);
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.58, 4.3), bodyM);
  body.position.y = 0.62; body.castShadow = true; g.add(body);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.97, 0.2, 2.0), blackM);
  stripe.position.set(0, 0.67, -0.1); g.add(stripe);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.52, 2.15), glassM);
  cab.position.set(0, 1.1, -0.16); g.add(cab);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.1, 2.25), bodyM);
  roof.position.set(0, 1.38, -0.16); g.add(roof);
  for (const sx of [-0.88, 0.88]) for (const sz of [-1.38, 1.38]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.24, 12), tireM);
    w.rotation.z = Math.PI / 2; w.position.set(sx, 0.35, sz); g.add(w);
  }
  // light bar
  const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.1, 0.28), blackM);
  barBase.position.set(0, 1.46, 0.1); g.add(barBase);
  const redM = new THREE.MeshBasicMaterial({ color: '#ff1a2a' });
  const blueM = new THREE.MeshBasicMaterial({ color: '#1a5bff' });
  const red = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.13, 0.24), redM);
  red.position.set(-0.28, 1.57, 0.1); g.add(red);
  const blue = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.13, 0.24), blueM);
  blue.position.set(0.28, 1.57, 0.1); g.add(blue);
  const glowR = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture('#ff2030'), color: '#ff2030', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8,
  }));
  glowR.scale.set(2.6, 2.6, 1); glowR.position.set(-0.28, 1.6, 0.2); g.add(glowR);
  const glowB = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture('#2050ff'), color: '#2050ff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8,
  }));
  glowB.scale.set(2.6, 2.6, 1); glowB.position.set(0.28, 1.6, 0.2); g.add(glowB);
  scene.add(g);
  return { group: g, red, blue, glowR, glowB, redM, blueM, phase: Math.random() * Math.PI * 2 };
}

let _glowTex = null;
function glowTexture(color) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createCrowd(scene, world, opts = {}) {
  const peds = [];
  const cops = [];
  const copCars = [];
  const pedCount = opts.pedCount || 22;
  const copCount = opts.copCount || 7;

  function placePed(ped) {
    const anchor = ped.anchor || { x: 0, z: 8 };
    const b = world.pickBlockNear(anchor.x, anchor.z, 12, 88) || world.pickBlockNear(0, 8, 0, 200);
    if (!b) return;
    ped.points = blockWaypoints(b.x, b.z);
    const start = Math.floor(Math.random() * 4);
    const p = ped.points[start];
    ped.human.root.position.set(p[0] + rnd(-1, 1), 0.24, p[1] + rnd(-1, 1));
    ped.human.root.rotation.y = Math.atan2(ped.points[(start + 1) % 4][0] - p[0], ped.points[(start + 1) % 4][1] - p[1]);
    ped.target = (start + 1) % 4;
    ped.pause = rnd(0, 3);
    ped.flee = 0;
  }

  function placeCop(cop, anchor = { x: 0, z: 8 }) {
    const b = world.pickBlockNear(anchor.x, anchor.z, 16, 82) || world.pickBlockNear(0, 8, 0, 200);
    if (!b) return;
    const x = b.x + rnd(-16, 16);
    const z = b.z + rnd(-16, 16);
    cop.human.root.position.set(x, 0.24, z);
    cop.home.set(x, z);
    cop.phase = Math.random() * Math.PI * 2;
    cop.arrest = 0;
    cop.state = 'patrol';
    cop.target.set(x, z);
  }

  for (let n = 0; n < pedCount; n++) {
    const human = createHumanoid({
      detail: 'low',
      longHair: Math.random() < 0.35,
      shirt: pick(['#c9553d', '#3f6f9e', '#d8d4c8', '#4a4f59', '#7c8c54', '#8e5b8b', '#d9a441', '#2f7f73', '#b0b6bd', '#e0d6c4']),
      shadow: false,
    });
    scene.add(human.root);
    const ped = {
      human, points: [], target: 0, speed: rnd(0.95, 1.55),
      pause: rnd(0, 4), flee: 0, baseSpeed: rnd(0.95, 1.55), anchor: { x: 0, z: 8 },
    };
    placePed(ped);
    peds.push(ped);
  }

  for (let n = 0; n < copCount; n++) {
    const human = createHumanoid({
      cop: true, cap: true, detail: 'high', shadow: !opts.mobile,
      skin: pick(COP_SKIN), hair: '#221a14', height: 0.99 + Math.random() * 0.07,
    });
    scene.add(human.root);
    const cop = {
      human, home: new THREE.Vector2(), angle: 0, phase: Math.random() * Math.PI * 2,
      speed: 1.2, arrest: 0, state: 'patrol', target: new THREE.Vector2(),
    };
    placeCop(cop);
    cops.push(cop);
  }

  // Cruisers start on real roads near the player, then re-home as the city streams.
  for (let n = 0; n < 3; n++) {
    const b = world.pickBlockNear(0, 8, 20, 100);
    const x = b ? b.x - CITY.block / 2 : 0;
    const z = b ? b.z : -40;
    const car = makePoliceCar(x, z, n % 2 ? Math.PI / 2 : 0, scene);
    copCars.push({ ...car, route: null, t: 0 });
  }

  let anchorX = 0, anchorZ = 8;
  let rehomeTimer = 0;

  function update(dt, game) {
    const player = game.player;
    const px = player.position.x, pz = player.position.z;
    const wanted = game.wanted;
    const colliders = game.world ? game.world.colliders : world.colliders;

    rehomeTimer -= dt;
    if (rehomeTimer <= 0 && dist2D(px, pz, anchorX, anchorZ) > 130) {
      anchorX = px; anchorZ = pz; rehomeTimer = 1.5;
      for (const ped of peds) {
        if (dist2D(ped.human.root.position.x, ped.human.root.position.z, px, pz) > 145) {
          ped.anchor = { x: px, z: pz };
          placePed(ped);
        }
      }
      for (const cop of cops) {
        if (dist2D(cop.human.root.position.x, cop.human.root.position.z, px, pz) > 165) placeCop(cop, { x: px, z: pz });
      }
      for (const car of copCars) {
        if (dist2D(car.group.position.x, car.group.position.z, px, pz) > 190) {
          const b = world.pickBlockNear(px, pz, 30, 100);
          if (b) car.group.position.set(b.x - CITY.block / 2, 0, b.z);
        }
      }
    }

    // ----- pedestrians -----
    for (const ped of peds) {
      const h = ped.human;
      let speed = ped.baseSpeed;
      if (ped.flee > 0) {
        ped.flee -= dt;
        const dx = h.root.position.x - px, dz = h.root.position.z - pz;
        const d = Math.max(0.001, Math.hypot(dx, dz));
        h.root.position.x += (dx / d) * 4.8 * dt;
        h.root.position.z += (dz / d) * 4.8 * dt;
        h.root.rotation.y = dampAngle(h.root.rotation.y, Math.atan2(dx, dz), 9, dt);
        h.animate(dt, 4.8);
        h.root.position.x = clamp(h.root.position.x, -CITY.half + 2, CITY.half - 2);
        h.root.position.z = clamp(h.root.position.z, -CITY.half + 2, CITY.half - 2);
        continue;
      }
      if (ped.pause > 0) {
        ped.pause -= dt;
        h.animate(dt, 0);
      } else {
        const t = ped.points[ped.target];
        const dx = t[0] - h.root.position.x, dz = t[1] - h.root.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.6) {
          ped.target = (ped.target + 1) % 4;
          if (Math.random() < 0.2) ped.pause = rnd(1.2, 4.5);
        } else {
          const targetYaw = Math.atan2(dx, dz);
          h.root.rotation.y = dampAngle(h.root.rotation.y, targetYaw, 5, dt);
          const move = Math.min(d, speed * dt);
          h.root.position.x += Math.sin(h.root.rotation.y) * move;
          h.root.position.z += Math.cos(h.root.rotation.y) * move;
          h.animate(dt, speed);
        }
      }
      const pd = dist2D(h.root.position.x, h.root.position.z, px, pz);
      if (pd < 1.15) {
        const dx = h.root.position.x - px, dz = h.root.position.z - pz;
        const d = Math.max(0.01, Math.hypot(dx, dz));
        h.root.position.x += (dx / d) * (1.15 - pd) * 0.4;
        h.root.position.z += (dz / d) * (1.15 - pd) * 0.4;
      }
    }

    // ----- cops -----
    for (const cop of cops) {
      const h = cop.human;
      const d = dist2D(h.root.position.x, h.root.position.z, px, pz);
      const chasing = wanted > 0 && d < 95;
      let speed;
      if (chasing) {
        speed = 4.0 + wanted * 0.55;
        const targetYaw = Math.atan2(px - h.root.position.x, pz - h.root.position.z);
        h.root.rotation.y = dampAngle(h.root.rotation.y, targetYaw, 7, dt);
        const step = Math.min(d, speed * dt);
        h.root.position.x += Math.sin(h.root.rotation.y) * step;
        h.root.position.z += Math.cos(h.root.rotation.y) * step;
        for (const c of colliders) resolveCircleAABB(h.root.position, 0.36, c);
        h.root.position.x = clamp(h.root.position.x, -CITY.half + 1, CITY.half - 1);
        h.root.position.z = clamp(h.root.position.z, -CITY.half + 1, CITY.half - 1);
        h.animate(dt, speed);
        if (d < 1.85 && player.onFoot) {
          cop.arrest += dt;
          if (cop.arrest > 1.05) game.bust();
        } else {
          cop.arrest = Math.max(0, cop.arrest - dt * 0.8);
        }
      } else {
        cop.phase += dt * 0.22;
        const tx = cop.home.x + Math.cos(cop.phase) * 11;
        const tz = cop.home.y + Math.sin(cop.phase) * 11;
        const dx = tx - h.root.position.x, dz = tz - h.root.position.z;
        const dd = Math.hypot(dx, dz);
        if (dd > 0.4) {
          h.root.rotation.y = dampAngle(h.root.rotation.y, Math.atan2(dx, dz), 4, dt);
          h.root.position.x += Math.sin(h.root.rotation.y) * 1.15 * dt;
          h.root.position.z += Math.cos(h.root.rotation.y) * 1.15 * dt;
          h.animate(dt, 1.15);
        } else {
          h.animate(dt, 0);
        }
        cop.arrest = 0;
      }
    }

    // ----- cruisers -----
    for (const car of copCars) {
      if (car.route) {
        const target = car.route[car.seg];
        const dx = target[0] - car.pos.x, dz = target[1] - car.pos.y;
        const d = Math.hypot(dx, dz);
        if (d < 1.4) {
          car.seg = (car.seg + 1) % car.route.length;
        } else {
          const yaw = Math.atan2(dx, dz);
          car.pos.x += Math.sin(yaw) * 8.5 * dt;
          car.pos.y += Math.cos(yaw) * 8.5 * dt;
          car.group.position.set(car.pos.x, 0, car.pos.y);
          car.group.rotation.y = yaw;
        }
      }
      car.phase += dt * (wanted > 0 ? 13 : 5.5);
      const flash = Math.sin(car.phase) > 0;
      car.redM.color.setHex(flash ? '#ff2030' : '#330810');
      car.blueM.color.setHex(flash ? '#1748ff' : '#0a1430');
      car.glowR.material.opacity = flash ? 0.9 : 0.05;
      car.glowB.material.opacity = flash ? 0.05 : 0.9;
    }
  }

  return { peds, cops, copCars, update };
}

export function scareCrowd(crowd, x, z, radius = 45) {
  for (const p of crowd.peds) {
    if (dist2D(p.human.root.position.x, p.human.root.position.z, x, z) < radius) p.flee = rnd(4, 8);
  }
}

export function nearestCop(crowd, x, z) {
  let best = null, bd = Infinity;
  for (const c of crowd.cops) {
    const d = dist2D(c.human.root.position.x, c.human.root.position.z, x, z);
    if (d < bd) { bd = d; best = c; }
  }
  return { cop: best, dist: bd };
}
