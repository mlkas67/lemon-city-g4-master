import * as THREE from 'three';
import { makeCanvas } from './utils.js';

const PALETTE = ['#ffb15c', '#7ee0b8', '#8ec5ff', '#ff9ecb', '#d9b6ff', '#ffe27a', '#ff8f7a'];

export function nameColour(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function createNameTag(name, { local = false } = {}) {
  const label = String(name || 'RIDER').slice(0, 16);
  const colour = nameColour(label);
  const c = makeCanvas(512, 128);
  const ctx = c.getContext('2d');
  const textWidth = Math.min(430, ctx.measureText ? 0 : 0);
  ctx.font = '800 58px "Arial Narrow", Inter, sans-serif';
  const measure = Math.min(430, ctx.measureText(label).width);
  const w = measure + 96;
  const x = (512 - w) / 2;

  ctx.fillStyle = 'rgba(7,12,18,.82)';
  ctx.beginPath();
  ctx.roundRect(x, 25, w, 78, 38);
  ctx.fill();
  ctx.strokeStyle = local ? '#ffffff' : colour;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(x + 2.5, 27.5, w - 5, 73, 35);
  ctx.stroke();

  ctx.fillStyle = local ? '#ffffff' : colour;
  ctx.beginPath();
  ctx.arc(x + 37, 64, 9, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#f4f8ff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 256 + 12, 66);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const mat = new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, depthTest: true,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.35, 0.59, 1);
  sprite.position.y = 2.32;
  sprite.renderOrder = 8;
  sprite.userData.isNameTag = true;
  return sprite;
}
