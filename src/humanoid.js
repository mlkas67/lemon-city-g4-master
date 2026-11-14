import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp, damp, lerp, pick, rnd } from './utils.js';

const geoCache = new Map();
const matCache = new Map();

function geo(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}
export function mat(color, roughness = 0.82, metalness = 0.02) {
  const key = color + '|' + roughness + '|' + metalness;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  }
  return matCache.get(key);
}
function rounded(w, h, d, r = 0.02) {
  return geo(`rb${w}|${h}|${d}|${r}`, () => new RoundedBoxGeometry(w, h, d, 2, r));
}
function capsule(radius, length) {
  return geo(`cap${radius}|${length}`, () => new THREE.CapsuleGeometry(radius, length, 4, 8));
}
function sphere(r = 1, seg = 12) {
  return geo(`sph${r}|${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(6, seg - 2)));
}

function add(parent, geometry, material, x, y, z, shadow = false) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  parent.add(m);
  return m;
}

const SKIN = ['#e8b98f', '#d9a173', '#c18455', '#8d5a3b', '#6f4229', '#f0c7a4', '#a86c45'];
const HAIR = ['#1c1512', '#2f2118', '#4a3120', '#7a512c', '#c19a63', '#191919', '#5a3a24'];
const SHIRTS = ['#c9553d', '#3f6f9e', '#d8d4c8', '#4a4f59', '#7c8c54', '#8e5b8b', '#d9a441', '#2f7f73', '#b0b6bd'];
const PANTS = ['#2f3a4a', '#41474f', '#22262c', '#5a5145', '#33414f', '#6d6a63'];
const SHOES = ['#171a1f', '#e6e3da', '#4a3426', '#272c33'];

/**
 * A fairly detailed low-poly human: tapered torso, jointed limbs, sculpted
 * head with face, hair, and clothing details. Faces +Z.
 */
export function createHumanoid(opts = {}) {
  const o = Object.assign({
    skin: pick(SKIN),
    hair: pick(HAIR),
    shirt: pick(SHIRTS),
    pants: pick(PANTS),
    shoe: pick(SHOES),
    cop: false,
    player: false,
    height: rnd(0.94, 1.05),
    longHair: Math.random() < 0.3,
    cap: Math.random() < 0.12,
    shadow: false,
    detail: 'high',
  }, opts);

  const low = o.detail === 'low';
  const skinM = mat(o.skin, 0.72);
  const hairM = mat(o.hair, 0.88);
  const shirtM = mat(o.cop ? '#202c44' : o.shirt, 0.86);
  const pantsM = mat(o.cop ? '#182236' : o.pants, 0.9);
  const shoeM = mat(o.cop ? '#101014' : o.shoe, 0.65);
  const darkM = mat('#14171c', 0.75);
  const goldM = new THREE.MeshStandardMaterial({ color: '#e2b64a', roughness: 0.3, metalness: 0.8 });
  const eyeWhiteM = mat('#f2ede4', 0.4);
  const eyeM = mat('#231a13', 0.35);

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  body.scale.setScalar(o.height);

  const hips = new THREE.Group();
  hips.position.y = 0.92;
  body.add(hips);

  const pelvis = add(hips, rounded(0.31, 0.2, 0.21, 0.05), pantsM, 0, 0.02, 0, o.shadow);
  pelvis.castShadow = o.shadow;

  const torso = new THREE.Group();
  torso.position.y = 0.09;
  hips.add(torso);

  // Tapered chest, slightly elliptical.
  const chestGeo = geo('chest', () => new THREE.CylinderGeometry(0.205, 0.155, 0.5, 10, 1));
  const chest = add(torso, chestGeo, shirtM, 0, 0.26, 0, o.shadow);
  chest.scale.z = 0.64;
  // shoulders
  add(torso, sphere(0.085, 10), shirtM, 0.215, 0.47, 0, o.shadow);
  add(torso, sphere(0.085, 10), shirtM, -0.215, 0.47, 0, o.shadow);
  // collar / neck
  add(torso, new THREE.CylinderGeometry(0.062, 0.075, 0.1, 8), skinM, 0, 0.53, 0, o.shadow);

  if (!o.cop && !low) {
    const zipper = add(torso, rounded(0.012, 0.42, 0.01, 0.003), mat('#1a1c20', 0.6), 0, 0.26, 0.142);
    zipper.castShadow = false;
    if (o.player) {
      add(torso, rounded(0.075, 0.035, 0.012, 0.005), mat('#ff6a1a', 0.6), 0.075, 0.39, 0.143);
    }
  }
  if (o.cop) {
    // tactical vest and belt
    add(torso, rounded(0.36, 0.36, 0.23, 0.03), mat('#111823', 0.9), 0, 0.32, 0.005, o.shadow);
    add(torso, rounded(0.34, 0.055, 0.24, 0.01), mat('#0b0e13', 0.7), 0, 0.09, 0.005);
    add(torso, rounded(0.05, 0.035, 0.012, 0.004), goldM, -0.1, 0.4, 0.128);
    add(torso, rounded(0.055, 0.09, 0.035, 0.008), darkM, 0.12, 0.24, 0.125);
    add(torso, rounded(0.022, 0.05, 0.02, 0.005), goldM, 0.12, 0.27, 0.145);
  }

  // head
  const head = new THREE.Group();
  head.position.y = 0.6;
  torso.add(head);
  const skull = add(head, sphere(1, 16), skinM, 0, 0.09, 0, o.shadow);
  skull.scale.set(0.102, 0.128, 0.108);
  if (!low) {
    const jaw = add(head, sphere(1, 10), skinM, 0, 0.025, 0.018, false);
    jaw.scale.set(0.079, 0.06, 0.087);
    const nose = add(head, new THREE.ConeGeometry(0.018, 0.04, 5), skinM, 0, 0.083, 0.112);
    nose.rotation.x = Math.PI * 0.5;
    add(head, sphere(0.022, 8), skinM, 0.104, 0.09, 0.005);
    add(head, sphere(0.022, 8), skinM, -0.104, 0.09, 0.005);
  }
  // eyes
  for (const sx of [-1, 1]) {
    const eye = add(head, sphere(0.018, 8), eyeWhiteM, sx * 0.039, 0.105, 0.095);
    eye.scale.set(1, 0.75, 0.5);
    add(head, sphere(0.0085, 6), eyeM, sx * 0.039, 0.105, 0.105);
    if (!low) {
      const brow = add(head, rounded(0.036, 0.007, 0.01, 0.002), hairM, sx * 0.039, 0.129, 0.101);
      brow.rotation.z = sx * 0.08;
    }
  }
  // mouth
  if (!low) add(head, rounded(0.032, 0.006, 0.008, 0.002), mat('#8a5347', 0.7), 0, 0.048, 0.101);

  // hair cap
  const hairGeo = geo('haircap', () => new THREE.SphereGeometry(1, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.58));
  const hair = add(head, hairGeo, hairM, 0, 0.098, -0.004, o.shadow);
  hair.scale.set(0.108, 0.13, 0.116);
  if (o.longHair && !low) {
    const back = add(head, rounded(0.15, 0.25, 0.07, 0.03), hairM, 0, -0.02, -0.072, o.shadow);
    back.rotation.x = -0.12;
  }
  if (o.cap) {
    // Cop cap
    add(head, new THREE.CylinderGeometry(0.108, 0.102, 0.055, 12), mat('#111a2b', 0.85), 0, 0.208, 0.005, o.shadow);
    const brim = add(head, rounded(0.16, 0.018, 0.09, 0.008), mat('#080c14', 0.7), 0, 0.188, 0.085);
    brim.rotation.x = 0.08;
    add(head, rounded(0.04, 0.028, 0.012, 0.004), goldM, 0, 0.212, 0.104);
  }

  // arms
  const arms = {};
  for (const side of [-1, 1]) {
    const key = side < 0 ? 'L' : 'R';
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.235, 0.445, 0);
    torso.add(shoulder);
    const sleeve = add(shoulder, capsule(0.054, 0.19), o.cop ? shirtM : shirtM, 0, -0.145, 0, o.shadow);
    sleeve.scale.set(1, 1, 0.92);
    const elbow = new THREE.Group();
    elbow.position.y = -0.31;
    shoulder.add(elbow);
    const forearm = add(elbow, capsule(0.047, 0.18), o.cop ? shirtM : (o.sleeves === false ? skinM : shirtM), 0, -0.14, 0, o.shadow);
    forearm.scale.set(1, 1, 0.92);
    let hand = null;
    if (!low) {
      hand = add(elbow, sphere(0.052, 8), skinM, 0, -0.3, 0.005, false);
      hand.scale.set(0.85, 1.1, 0.7);
    }
    arms[key] = { shoulder, elbow, hand };
  }

  // legs
  const legs = {};
  for (const side of [-1, 1]) {
    const key = side < 0 ? 'L' : 'R';
    const hip = new THREE.Group();
    hip.position.set(side * 0.095, -0.03, 0);
    hips.add(hip);
    const thigh = add(hip, capsule(0.077, 0.28), pantsM, 0, -0.215, 0, o.shadow);
    thigh.scale.set(1, 1, 0.95);
    const knee = new THREE.Group();
    knee.position.y = -0.43;
    hip.add(knee);
    add(knee, capsule(0.061, 0.27), pantsM, 0, -0.2, 0, o.shadow);
    const foot = add(knee, rounded(0.115, 0.075, 0.255, 0.025), shoeM, 0, -0.4, 0.055, o.shadow);
    foot.rotation.x = 0.02;
    legs[key] = { hip, knee, foot };
  }

  return {
    root,
    body,
    parts: { hips, torso, head, arms, legs },
    opts: o,
    walkPhase: rnd(0, Math.PI * 2),
    sitting: false,
    riding: false,
    animate(dt, speed = 0, opts2 = {}) {
      const p = this.parts;
      const running = speed > 2.4;
      const amp = clamp(speed * 0.24, 0.1, running ? 0.92 : 0.5);
      this.walkPhase += dt * (2.2 + speed * 1.55);
      const s = Math.sin(this.walkPhase);
      const c = Math.cos(this.walkPhase);
      const idle = 1 - clamp(speed / 0.8, 0, 1);
      const bob = Math.abs(c) * amp * 0.026 + Math.sin(this.walkPhase * 0.35) * 0.004 * idle;
      p.hips.position.y = 0.92 + bob;
      p.hips.rotation.z = s * amp * 0.035;
      p.torso.rotation.y = -s * amp * 0.1;
      p.torso.rotation.x = running ? -0.1 : 0;
      p.head.rotation.y = s * amp * 0.05;
      p.head.rotation.x = opts2.lookUp || 0;

      const legSwing = amp * 1.1;
      p.legs.L.hip.rotation.x = s * legSwing;
      p.legs.R.hip.rotation.x = -s * legSwing;
      p.legs.L.knee.rotation.x = Math.max(0, -s) * legSwing * 1.35 + 0.05;
      p.legs.R.knee.rotation.x = Math.max(0, s) * legSwing * 1.35 + 0.05;
      p.legs.L.foot.rotation.x = -p.legs.L.knee.rotation.x * 0.5;
      p.legs.R.foot.rotation.x = -p.legs.R.knee.rotation.x * 0.5;

      p.arms.L.shoulder.rotation.x = -s * legSwing * 0.7 + (running ? 0.2 : 0);
      p.arms.R.shoulder.rotation.x = s * legSwing * 0.7 + (running ? 0.2 : 0);
      p.arms.L.shoulder.rotation.z = 0.07;
      p.arms.R.shoulder.rotation.z = -0.07;
      p.arms.L.elbow.rotation.x = -0.25 - Math.max(0, -s) * 0.5;
      p.arms.R.elbow.rotation.x = -0.25 - Math.max(0, s) * 0.5;
      if (this.sitting) {
        p.hips.position.y = 0.92;
        for (const k of ['L', 'R']) {
          p.legs[k].hip.rotation.x = -1.32;
          p.legs[k].knee.rotation.x = 1.22;
          p.legs[k].foot.rotation.x = -0.12;
          p.arms[k].shoulder.rotation.x = -0.72;
          p.arms[k].shoulder.rotation.z = k === 'L' ? 0.2 : -0.2;
          p.arms[k].elbow.rotation.x = -0.45;
        }
      } else if (this.riding) {
        // Stand-up scooter stance: feet on the deck, hands out on the bar.
        p.hips.position.y = 0.92;
        p.hips.rotation.z = 0;
        p.torso.rotation.x = -0.09;
        p.torso.rotation.y = 0;
        p.head.rotation.x = 0.06;
        p.legs.L.hip.rotation.x = 0.16;
        p.legs.R.hip.rotation.x = -0.1;
        p.legs.L.knee.rotation.x = 0.08;
        p.legs.R.knee.rotation.x = 0.2;
        p.legs.L.foot.rotation.x = -0.2;
        p.legs.R.foot.rotation.x = -0.16;
        for (const k of ['L', 'R']) {
          p.arms[k].shoulder.rotation.x = -1.04;
          p.arms[k].shoulder.rotation.z = k === 'L' ? 0.1 : -0.1;
          p.arms[k].elbow.rotation.x = -0.52;
        }
      }
    },
  };
}
