import * as THREE from 'three';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
export const rndInt = (a, b) => Math.floor(rnd(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
export function angleDiff(a, b) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export function dampAngle(a, b, lambda, dt) {
  return angleLerp(a, b, 1 - Math.exp(-lambda * dt));
}
export function dist2D(x1, z1, x2, z2) {
  return Math.hypot(x2 - x1, z2 - z1);
}

// Deterministic RNG so the city is always the same.
export function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function canvasTexture(canvas, { repeat = null, srgb = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

// Shared AABB collider helpers.
export function circleVsAABB(x, z, radius, box) {
  const nx = clamp(x, box.minX, box.maxX);
  const nz = clamp(z, box.minZ, box.maxZ);
  const dx = x - nx, dz = z - nz;
  return dx * dx + dz * dz < radius * radius;
}

export function resolveCircleAABB(pos, radius, box) {
  const nx = clamp(pos.x, box.minX, box.maxX);
  const nz = clamp(pos.z, box.minZ, box.maxZ);
  let dx = pos.x - nx, dz = pos.z - nz;
  let d2 = dx * dx + dz * dz;
  if (d2 > radius * radius) return false;
  if (d2 < 1e-8) {
    // Centre inside the box: push out through the closest face.
    const left = pos.x - box.minX, right = box.maxX - pos.x;
    const back = pos.z - box.minZ, front = box.maxZ - pos.z;
    const m = Math.min(left, right, back, front);
    if (m === left) pos.x = box.minX - radius;
    else if (m === right) pos.x = box.maxX + radius;
    else if (m === back) pos.z = box.minZ - radius;
    else pos.z = box.maxZ + radius;
    return true;
  }
  const d = Math.sqrt(d2);
  const push = (radius - d) / d;
  pos.x += dx * push;
  pos.z += dz * push;
  return true;
}

export function formatMoney(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

export function makeGlowTexture(inner = 'rgba(255,190,90,1)', outer = 'rgba(255,110,20,0)') {
  const c = makeCanvas(128, 128);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, 'rgba(255,150,50,.55)');
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return canvasTexture(c);
}
