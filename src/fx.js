// Efeitos de combate: faíscas, anéis de impacto, rastro da espada e
// detritos (o esqueleto que se despedaça).
import * as THREE from 'three';
import { groundY } from './terrain.js';
import { rr } from './util.js';

function softTexture(draw) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  draw(c.getContext('2d'));
  return new THREE.CanvasTexture(c);
}

export function createFx(scene) {
  const dot = softTexture(g => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });
  const ringTex = softTexture(g => {
    const gr = g.createRadialGradient(32, 32, 14, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });

  // ---------------------------------------------------------- faíscas
  const MAX = 800;
  const pArr = new Float32Array(MAX * 3), cArr = new Float32Array(MAX * 3);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pArr, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(cArr, 3));
  const sparks = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.14, map: dot, vertexColors: true,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sparks.frustumCulled = false; scene.add(sparks);
  const parts = [];
  const tmpC = new THREE.Color();

  function burst(x, y, z, { n = 14, color = 0xffffff, speed = 4, up = 2, grav = 9, life = 0.4, dir = null, spread = 1, drag = 2 } = {}) {
    tmpC.set(color);
    for (let i = 0; i < n && parts.length < MAX; i++) {
      let vx = rr(-1, 1), vy = rr(-0.3, 1), vz = rr(-1, 1);
      if (dir) { vx = dir.x + rr(-spread, spread); vz = dir.z + rr(-spread, spread); vy = rr(0, 0.8); }
      const l = Math.hypot(vx, vy, vz) || 1, sp = speed * rr(0.4, 1.2);
      parts.push({ x, y, z, vx: vx / l * sp, vy: vy / l * sp + up * rr(0.3, 1), vz: vz / l * sp,
        life: 0, max: life * rr(0.6, 1.3), r: tmpC.r, g: tmpC.g, b: tmpC.b, grav, drag });
    }
  }

  // ---------------------------------------------------------- anéis de impacto
  const rings = [];
  function ring(x, y, z, { color = 0xffffff, size = 1.5, life = 0.25, ground = false } = {}) {
    let m;
    if (ground) {
      m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: ringTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    } else {
      m = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    }
    m.position.set(x, y, z); scene.add(m);
    rings.push({ m, life: 0, max: life, size });
  }

  // ---------------------------------------------------------- rastro da espada
  const TS = 28;
  const tPos = new Float32Array(TS * 2 * 3), tCol = new Float32Array(TS * 2 * 3);
  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
  tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
  const idx = [];
  for (let i = 0; i < TS - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  tGeo.setIndex(idx);
  const trailMesh = new THREE.Mesh(tGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  trailMesh.frustumCulled = false; scene.add(trailMesh);
  const samples = [];
  const trailColor = new THREE.Color(0x9fc0ff);
  function trail(a, b, color) {
    if (color) trailColor.set(color);
    samples.unshift({ a: a.clone(), b: b.clone(), age: 0 });
    if (samples.length > TS) samples.pop();
  }

  // ---------------------------------------------------------- detritos
  const debris = [];
  const _v = new THREE.Vector3();
  function shatter(root, origin, force = 1, dir = null) {
    const meshes = [];
    root.traverse(o => { if (o.isMesh) meshes.push(o); });
    root.updateMatrixWorld(true);
    for (const m of meshes) {
      scene.attach(m);
      m.getWorldPosition(_v);
      const ox = _v.x - origin.x, oz = _v.z - origin.z, l = Math.hypot(ox, oz) || 1;
      const push = rr(1, 3.2) * force;
      debris.push({ m, life: 0,
        vx: ox / l * push + (dir ? dir.x * 2.5 * force : 0), vy: rr(1.5, 4.5) * force, vz: oz / l * push + (dir ? dir.z * 2.5 * force : 0),
        ax: rr(-9, 9), ay: rr(-9, 9), az: rr(-9, 9) });
    }
  }

  return {
    burst, ring, trail, shatter,
    update(dt) {
      // faíscas
      let n = 0;
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]; p.life += dt;
        if (p.life >= p.max) { parts.splice(i, 1); continue; }
        p.vy -= p.grav * dt; const k = Math.exp(-p.drag * dt); p.vx *= k; p.vz *= k;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        const gy = groundY(p.x, p.z) + 0.03; if (p.y < gy) { p.y = gy; p.vy *= -0.3; }
      }
      for (const p of parts) {
        const f = 1 - p.life / p.max;
        pArr[n * 3] = p.x; pArr[n * 3 + 1] = p.y; pArr[n * 3 + 2] = p.z;
        cArr[n * 3] = p.r * f; cArr[n * 3 + 1] = p.g * f; cArr[n * 3 + 2] = p.b * f; n++;
      }
      pGeo.setDrawRange(0, n);
      pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;

      // anéis
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i]; r.life += dt;
        const t = r.life / r.max;
        if (t >= 1) { scene.remove(r.m); r.m.material.dispose(); rings.splice(i, 1); continue; }
        r.m.scale.setScalar(r.size * (0.3 + t * 0.9));
        r.m.material.opacity = 1 - t;
      }

      // rastro: envelhece e some depois de ~0,16s
      for (let i = samples.length - 1; i >= 0; i--) { samples[i].age += dt; if (samples[i].age > 0.16) samples.splice(i, 1); }
      for (let i = 0; i < TS; i++) {
        const s = samples[Math.min(i, samples.length - 1)];
        const f = s ? Math.max(0, 1 - s.age / 0.16) * (1 - i / TS) : 0;
        const a = s ? s.a : _v.set(0, -999, 0), b = s ? s.b : a;
        tPos.set([a.x, a.y, a.z], i * 6); tPos.set([b.x, b.y, b.z], i * 6 + 3);
        tCol.set([trailColor.r * f, trailColor.g * f, trailColor.b * f], i * 6);
        tCol.set([trailColor.r * f * 0.15, trailColor.g * f * 0.15, trailColor.b * f * 0.15], i * 6 + 3);
      }
      tGeo.attributes.position.needsUpdate = true; tGeo.attributes.color.needsUpdate = true;
      trailMesh.visible = samples.length > 1;

      // detritos com gravidade, quique e atrito; afundam e somem
      for (let i = debris.length - 1; i >= 0; i--) {
        const d = debris[i], m = d.m; d.life += dt;
        if (d.life > 5.5) { scene.remove(m); m.geometry.dispose(); debris.splice(i, 1); continue; }
        const gy = groundY(m.position.x, m.position.z) + 0.03;
        if (d.life > 3.5) { m.position.y -= dt * 0.25; continue; }
        d.vy -= 14 * dt;
        m.position.x += d.vx * dt; m.position.y += d.vy * dt; m.position.z += d.vz * dt;
        m.rotation.x += d.ax * dt; m.rotation.y += d.ay * dt; m.rotation.z += d.az * dt;
        if (m.position.y < gy) {
          m.position.y = gy; d.vy *= -0.35; d.vx *= 0.6; d.vz *= 0.6; d.ax *= 0.6; d.ay *= 0.6; d.az *= 0.6;
          if (Math.abs(d.vy) < 0.4) { d.vy = 0; d.ax *= 0.8; d.az *= 0.8; }
        }
      }
    },
  };
}
