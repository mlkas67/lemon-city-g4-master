import * as THREE from 'three';
import { canvasTexture, makeCanvas } from './utils.js';

export const RACE = {
  name: 'HARBOR RING',
  laps: 2,
  width: 15,
  checkpointTs: [0.2, 0.4, 0.6, 0.8],
  maxPlayers: 8,
};

function roadTexture() {
  const c = makeCanvas(256, 512);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#22252b';
  ctx.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 1800; i++) {
    const v = 30 + Math.random() * 34;
    ctx.fillStyle = `rgba(${v},${v + 3},${v + 7},${0.18 + Math.random() * 0.3})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 512, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  ctx.strokeStyle = 'rgba(238,241,245,.42)';
  ctx.lineWidth = 3;
  ctx.setLineDash([38, 34]);
  ctx.beginPath(); ctx.moveTo(128, 0); ctx.lineTo(128, 512); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.16)';
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(26, 0); ctx.lineTo(26, 512); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(230, 0); ctx.lineTo(230, 512); ctx.stroke();
  return canvasTexture(c, { repeat: [1, 14] });
}

function makeSky() {
  const c = makeCanvas(16, 256);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#2b3f69');
  g.addColorStop(0.38, '#8b6a95');
  g.addColorStop(0.68, '#e08d67');
  g.addColorStop(1, '#ffd2a0');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(
    new THREE.SphereGeometry(620, 24, 16),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false, fog: false })
  );
}

function buildTrack(scene, curve) {
  const samples = 460;
  const positions = [];
  const uvs = [];
  const indices = [];
  const half = RACE.width / 2;
  const points = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const p = curve.getPointAt(t % 1);
    const tan = curve.getTangentAt(t % 1).setY(0).normalize();
    const nx = -tan.z, nz = tan.x;
    points.push({ p, tan, nx, nz, t });
    positions.push(p.x + nx * half, 0.02, p.z + nz * half);
    positions.push(p.x - nx * half, 0.02, p.z - nz * half);
    uvs.push(0, t, 1, t);
    if (i < samples) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const roadMat = new THREE.MeshStandardMaterial({
    map: roadTexture(), roughness: 0.94, metalness: 0.02,
  });
  const road = new THREE.Mesh(geo, roadMat);
  road.receiveShadow = true;
  scene.add(road);

  // Painted curbs and barriers along both edges.
  const curbGeo = new THREE.BoxGeometry(0.5, 0.22, 3.2);
  const barrierGeo = new THREE.BoxGeometry(0.55, 1.0, 6.0);
  const curbMatA = new THREE.MeshStandardMaterial({ color: '#e9e9e4', roughness: 0.7 });
  const curbMatB = new THREE.MeshStandardMaterial({ color: '#d33a3a', roughness: 0.6 });
  const barrierMat = new THREE.MeshStandardMaterial({ color: '#252c36', roughness: 0.8 });
  const barrierMatB = new THREE.MeshStandardMaterial({ color: '#c94835', roughness: 0.7 });
  const barrierCount = 150;
  const curbs = new THREE.InstancedMesh(curbGeo, curbMatA, barrierCount * 2);
  const barriers = new THREE.InstancedMesh(barrierGeo, barrierMat, barrierCount * 2);
  const stripe = new THREE.InstancedMesh(barrierGeo, barrierMatB, barrierCount);
  const dummy = new THREE.Object3D();
  let ci = 0;
  let si = 0;
  for (let i = 0; i < barrierCount; i++) {
    const t = i / barrierCount;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t).setY(0).normalize();
    const nx = -tan.z, nz = tan.x;
    for (const side of [-1, 1]) {
      const off = (half + 1.4) * side;
      dummy.position.set(p.x + nx * off, 0.45, p.z + nz * off);
      dummy.rotation.set(0, Math.atan2(tan.x, tan.z), 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      barriers.setMatrixAt(ci, dummy.matrix);
      dummy.position.y = 0.11;
      dummy.updateMatrix();
      curbs.setMatrixAt(ci, dummy.matrix);
      ci++;
      if (side === 1 && i % 2 === 0) {
        dummy.position.y = 0.55;
        dummy.updateMatrix();
        stripe.setMatrixAt(si++, dummy.matrix);
      }
    }
    if (i % 2 === 0) {
      // alternate curb colour by swapping a red overlay strip every other section
      const overlay = new THREE.Mesh(curbGeo, curbMatB);
      overlay.position.set(p.x + nx * (half + 1.4), 0.12, p.z + nz * (half + 1.4));
      overlay.rotation.y = Math.atan2(tan.x, tan.z);
      scene.add(overlay);
    }
  }
  stripe.count = si;
  scene.add(curbs, barriers, stripe);

  // Start / finish chequer.
  const startP = curve.getPointAt(0);
  const startTan = curve.getTangentAt(0).setY(0).normalize();
  const startYaw = Math.atan2(startTan.x, startTan.z);
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 14; col++) {
      const mat = (row + col) % 2 ? new THREE.MeshStandardMaterial({ color: '#f4f4ef', roughness: 0.7 })
        : new THREE.MeshStandardMaterial({ color: '#14171d', roughness: 0.7 });
      const tile = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.04, 0.62), mat);
      const across = (col - 6.5) * 1.02;
      tile.position.set(
        startP.x - Math.cos(startYaw) * across - startTan.x * (row * 0.62 - 0.3),
        0.055,
        startP.z + Math.sin(startYaw) * across - startTan.z * (row * 0.62 - 0.3)
      );
      tile.rotation.y = startYaw;
      scene.add(tile);
    }
  }

  return { points, startP, startTan, startYaw };
}

function buildScenery(scene) {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900),
    new THREE.MeshStandardMaterial({ color: '#16231f', roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.04;
  ground.receiveShadow = true;
  scene.add(ground);

  // Flood lights around the circuit.
  const poleMat = new THREE.MeshStandardMaterial({ color: '#232a34', metalness: 0.5, roughness: 0.5 });
  const lampMat = new THREE.MeshBasicMaterial({ color: '#fff1c9' });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const x = Math.cos(a) * 152;
    const z = Math.sin(a) * 105;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.8, 24, 8), poleMat);
    pole.position.set(x, 12, z);
    scene.add(pole);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.0, 1.4), lampMat);
    lamp.position.set(x, 24, z);
    lamp.rotation.y = -a;
    scene.add(lamp);
  }

  // Shipping containers and grandstands give the ring a harbour feel.
  const colours = ['#b64538', '#2e6f82', '#c79038', '#4d5c6e', '#7a4b70'];
  for (let i = 0; i < 42; i++) {
    const a = (i / 42) * Math.PI * 2 + 0.08;
    const r = 128 + (i % 4) * 8;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r * 0.72;
    if (Math.abs(x) < 118 && Math.abs(z) < 78) continue;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(4 + (i % 3) * 2.4, 3.2, 8.5),
      new THREE.MeshStandardMaterial({ color: colours[i % colours.length], roughness: 0.8 })
    );
    box.position.set(x, 1.6 + (i % 2) * 3.2, z);
    box.rotation.y = -a;
    box.castShadow = true;
    scene.add(box);
  }

  const standMat = new THREE.MeshStandardMaterial({ color: '#2b3443', roughness: 0.9 });
  const seatMat = new THREE.MeshStandardMaterial({ color: '#d9713a', roughness: 0.8 });
  for (const side of [-1, 1]) {
    const stand = new THREE.Mesh(new THREE.BoxGeometry(100, 7, 12), standMat);
    stand.position.set(0, 3.5, side * 92);
    scene.add(stand);
    for (let row = 0; row < 4; row++) {
      const seats = new THREE.Mesh(new THREE.BoxGeometry(92, 0.5, 1.4), seatMat);
      seats.position.set(0, 1.4 + row * 1.35, side * (92 - side * (5.5 - row * 1.0)));
      scene.add(seats);
    }
  }

  const adCanvas = makeCanvas(512, 96);
  const ctx = adCanvas.getContext('2d');
  ctx.fillStyle = '#11151c'; ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = '#ff7a2a';
  ctx.font = '800 46px Arial Narrow, sans-serif';
  ctx.fillText('LEMON CITY', 24, 62);
  ctx.fillStyle = '#e8eef7';
  ctx.font = '600 25px Inter, sans-serif';
  ctx.fillText('HARBOR RING GRAND PRIX', 255, 58);
  const adTex = canvasTexture(adCanvas);
  for (const side of [-1, 1]) {
    const ad = new THREE.Mesh(
      new THREE.PlaneGeometry(34, 6.4),
      new THREE.MeshBasicMaterial({ map: adTex, transparent: false })
    );
    ad.position.set(0, 8.6, side * 98);
    ad.rotation.y = side > 0 ? Math.PI : 0;
    scene.add(ad);
  }
}

function makeGate(scene, x, z, yaw, index) {
  const group = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color: '#f3b23c', emissive: '#a85c08', emissiveIntensity: 0.7 });
  const postGeo = new THREE.CylinderGeometry(0.32, 0.42, 6.5, 8);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(side * (RACE.width / 2 + 0.6), 3.25, 0);
    group.add(post);
  }
  const bannerCanvas = makeCanvas(256, 64);
  const ctx = bannerCanvas.getContext('2d');
  ctx.fillStyle = 'rgba(12,17,24,.92)'; ctx.fillRect(0, 0, 256, 64);
  ctx.strokeStyle = '#ff9a3c'; ctx.lineWidth = 4; ctx.strokeRect(3, 3, 250, 58);
  ctx.fillStyle = '#ffe0b8'; ctx.font = '800 30px Arial Narrow, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(index === 3 ? 'FINAL GATE' : `CHECKPOINT ${index + 1}`, 128, 42);
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(RACE.width + 1.2, 2.2),
    new THREE.MeshBasicMaterial({ map: canvasTexture(bannerCanvas) })
  );
  banner.position.y = 5.9;
  group.add(banner);
  group.position.set(x, 0, z);
  group.rotation.y = yaw;
  scene.add(group);
  return group;
}

export function createRace() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e49a72');
  scene.fog = new THREE.Fog('#d59a7d', 130, 430);
  scene.add(makeSky());

  const hemi = new THREE.HemisphereLight('#ffe1c7', '#2d3632', 1.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffd2a1', 2.5);
  sun.position.set(-90, 120, 95);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 380;
  sun.shadow.camera.left = -165;
  sun.shadow.camera.right = 165;
  sun.shadow.camera.top = 165;
  sun.shadow.camera.bottom = -165;
  sun.shadow.bias = -0.0007;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);

  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-98, 0, -52),
    new THREE.Vector3(-36, 0, -70),
    new THREE.Vector3(48, 0, -70),
    new THREE.Vector3(102, 0, -44),
    new THREE.Vector3(112, 0, 0),
    new THREE.Vector3(102, 0, 44),
    new THREE.Vector3(48, 0, 70),
    new THREE.Vector3(-36, 0, 70),
    new THREE.Vector3(-98, 0, 52),
    new THREE.Vector3(-112, 0, 0),
  ], true, 'catmullrom', 0.35);
  const track = buildTrack(scene, curve);
  buildScenery(scene);

  const checkpoints = RACE.checkpointTs.map((t, i) => {
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t).setY(0).normalize();
    makeGate(scene, p.x, p.z, Math.atan2(tan.x, tan.z), i);
    return { x: p.x, z: p.z, t, index: i };
  });
  const finish = curve.getPointAt(0);
  const finishTan = curve.getTangentAt(0).setY(0).normalize();
  const finishYaw = Math.atan2(finishTan.x, finishTan.z);

  const startGrid = [];
  for (let slot = 0; slot < RACE.maxPlayers; slot++) {
    const row = Math.floor(slot / 2);
    const side = slot % 2 === 0 ? -1 : 1;
    const t = (1 - 0.008 - row * 0.009) % 1;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t).setY(0).normalize();
    const nx = -tan.z, nz = tan.x;
    const lane = (RACE.width * 0.22) * side;
    startGrid.push({
      x: p.x + nx * lane, z: p.z + nz * lane, yaw: Math.atan2(tan.x, tan.z),
    });
  }

  return {
    scene, curve, checkpoints, finish, finishYaw, startGrid,
    gridPose(slot) {
      return startGrid[Math.max(0, Math.min(RACE.maxPlayers - 1, slot || 0))];
    },
    onTrack(x, z) {
      let best = 1e9;
      for (let i = 0; i < 260; i++) {
        const p = curve.getPointAt(i / 260);
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < best) best = d;
      }
      return Math.sqrt(best) <= RACE.width * 0.95;
    },
  };
}
