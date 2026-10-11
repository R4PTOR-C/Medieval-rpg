// Constrói o mundo estático: céu, terreno, água, vila, ruínas, vegetação,
// grama alta e partículas. Quase tudo que não se mexe vai para um Batch
// (um único mesh), o que mantém as draw calls baixas.
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rand, rr, pick, fbm, smooth } from './util.js';
import { WORLD, LAKE, VILLAGE, RUINS, DOCK, FIRE, heightAt, groundY, pathDist, colliders, canStand, onDock } from './terrain.js';
import { Batch, colorize, tagMat, applyWind, applyCutout, wind, glow, TAG } from './geo.js';

const PI = Math.PI;
const C = {
  plaster: 0xc9b896, wood: 0x4a3220, woodL: 0x5c3e26, stone: 0x6e6a62, stoneL: 0x85827a, moss: 0x56604a,
  gold: 0xc9a043, red: 0x8e1c1c, bone: 0xd8d2bc, hay: 0xb89a4a, iron: 0x3a3a40,
};

export function buildWorld(scene) {
  const solid = new Batch();          // geometria sólida estática
  const glowB = new Batch();          // partes que emitem luz (janelas, chamas)
  const flickers = [];
  const smokeSources = [];

  function addLight(color, intensity, x, y, z, dist = 22) {
    const l = new THREE.PointLight(color, intensity, dist, 2);
    l.position.set(x, y, z); scene.add(l);
    flickers.push({ l, base: intensity, seed: rand() * 100 });
    return l;
  }

  // ------------------------------------------------------------ luz e céu
  scene.add(new THREE.HemisphereLight(0x4a5a90, 0x141a10, 0.45));
  const MOON_DIR = new THREE.Vector3(-0.3, 0.72, -0.62).normalize();
  const moonLight = new THREE.DirectionalLight(0xb0c0f0, 0.9);
  moonLight.castShadow = true;
  moonLight.shadow.mapSize.set(2048, 2048);
  Object.assign(moonLight.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 1, far: 140 });
  moonLight.shadow.bias = -0.0015;
  moonLight.shadow.normalBias = 0.03;
  scene.add(moonLight, moonLight.target);

  const sky = new THREE.Group(); scene.add(sky);
  {
    const pos = [];
    for (let i = 0; i < 900; i++) {
      const th = rand() * PI * 2, el = Math.asin(rr(0.08, 1));
      pos.push(Math.cos(th) * Math.cos(el) * 300, Math.sin(el) * 300, Math.sin(th) * Math.cos(el) * 300);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    sky.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xc8d4ff, size: 5, sizeAttenuation: false, fog: false })));
    const moon = new THREE.Mesh(new THREE.SphereGeometry(16, 24, 16), new THREE.MeshBasicMaterial({ color: 0xfff6dc, fog: false }));
    moon.position.copy(MOON_DIR).multiplyScalar(280); sky.add(moon);
    const hc = document.createElement('canvas'); hc.width = hc.height = 128;
    const hg = hc.getContext('2d'), gr = hg.createRadialGradient(64, 64, 8, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,240,210,.85)'); gr.addColorStop(1, 'rgba(255,240,210,0)');
    hg.fillStyle = gr; hg.fillRect(0, 0, 128, 128);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(hc), fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.setScalar(110); halo.position.copy(moon.position); sky.add(halo);
  }

  // ------------------------------------------------------------ terreno
  const terrain = (() => {
    const SIZE = WORLD * 2 + 10, SEG = 180;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG); geo.rotateX(-PI / 2);
    const p = geo.attributes.position, cols = [], c = new THREE.Color(), dirt = new THREE.Color(0.4, 0.31, 0.2);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), h = heightAt(x, z); p.setY(i, h);
      const n = fbm(x * 0.3, z * 0.3);
      if (h < 0.35) c.setRGB(0.5, 0.45, 0.3);
      else if (h > 9) c.setRGB(0.85, 0.87, 0.92);
      else if (h > 5) c.setRGB(0.36, 0.36, 0.38).multiplyScalar(0.8 + n * 0.4);
      else c.setRGB(0.12 + n * 0.07, 0.25 + n * 0.1, 0.09);
      if (h >= 0.35 && h < 5) {
        const pd = pathDist(x, z);
        if (pd < 1.8) c.lerp(dirt, smooth(1.8, 1.0, pd));
        const dv = Math.hypot(x - VILLAGE.x, z - VILLAGE.z);
        if (dv < 11) c.lerp(dirt, smooth(11, 6, dv) * 0.8);
      }
      if (Math.hypot(x - RUINS.x, z - RUINS.z) < 9) c.lerp(new THREE.Color(0.3, 0.3, 0.26), 0.6);
      cols.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    m.receiveShadow = true; m.name = 'terrain';
    scene.add(m); return m;
  })();

  // ------------------------------------------------------------ água com reflexo
  const water = new Reflector(new THREE.PlaneGeometry(WORLD * 2 + 10, WORLD * 2 + 10), {
    textureWidth: Math.floor(innerWidth / 2), textureHeight: Math.floor(innerHeight / 2),
    color: 0x0b1a33, clipBias: 0.003, multisample: 0,
    shader: {
      uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
        time: { value: 0 }, fogColor: { value: new THREE.Color(0x0a0f1e) } },
      vertexShader: `
        uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vWorld; varying float vDepth;
        void main(){
          vUv = textureMatrix * vec4(position, 1.0);
          vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz;
          vec4 mv = viewMatrix * w; vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 color; uniform sampler2D tDiffuse; uniform float time; uniform vec3 fogColor;
        varying vec4 vUv; varying vec3 vWorld; varying float vDepth;
        void main(){
          vec2 w = vec2(sin(vWorld.x * 1.7 + time * 1.3) + sin(vWorld.z * 2.9 + time * 0.8),
                        cos(vWorld.z * 1.9 - time * 1.1) + cos(vWorld.x * 2.3 + time * 0.6)) * 0.010;
          vec4 uv = vUv; uv.xy += w * uv.w;
          vec3 col = mix(color, texture2DProj(tDiffuse, uv).rgb, 0.8);
          col = mix(col, fogColor, 1.0 - exp(-pow(0.014 * vDepth, 2.0)));
          gl_FragColor = vec4(col, 0.0);   // alpha 0 = água para o shader ASCII
          #include <colorspace_fragment>
        }`,
    },
  });
  water.rotation.x = -PI / 2;
  scene.add(water);

  // ------------------------------------------------------------ casas
  function house(x, z, rot, w, d) {
    const y = heightAt(x, z) - 0.05;
    solid.setFrame(x, y, z, rot); glowB.setFrame(x, y, z, rot);
    const roofC = pick([0x7a3424, 0x6a2c1e, 0x5e3a2a]);
    const wallH = 2.6, base = 0.4, top = base + wallH;

    // fundação de pedra com blocos salientes
    solid.box(w + 0.3, 0.6, d + 0.3, C.stone, 0, base - 0.25, 0, 0, 0, 0, 0.15);
    for (let i = 0; i < 14; i++) {
      const side = i % 4, t = rr(-0.45, 0.45);
      const px = side < 2 ? t * w : (side === 2 ? 1 : -1) * (w / 2 + 0.17);
      const pz = side < 2 ? (side === 0 ? 1 : -1) * (d / 2 + 0.17) : t * d;
      solid.box(rr(0.3, 0.5), rr(0.18, 0.28), 0.12, C.stoneL, px, base - rr(0.1, 0.35), pz, 0, side < 2 ? 0 : PI / 2, 0, 0.15);
    }
    // paredes e enxaimel
    solid.box(w, wallH, d, C.plaster, 0, base + wallH / 2, 0, 0, 0, 0, 0.03);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) solid.box(0.2, wallH, 0.2, C.wood, sx * w / 2, base + wallH / 2, sz * d / 2);
    for (const yy of [base + 0.08, base + wallH * 0.5, top - 0.06]) {
      for (const sz of [-1, 1]) solid.box(w + 0.06, 0.13, 0.08, C.wood, 0, yy, sz * (d / 2 + 0.03));
      for (const sx of [-1, 1]) solid.box(0.08, 0.13, d + 0.06, C.wood, sx * (w / 2 + 0.03), yy, 0);
    }
    const hb = wallH * 0.5 - 0.08;
    for (const sx of [-1, 1]) for (const k of [-1, 1]) {
      solid.box(0.08, Math.hypot(d / 2, hb), 0.11, C.wood, sx * (w / 2 + 0.04), base + 0.08 + hb / 2, k * d / 4, Math.atan2(k * d / 2, hb), 0, 0);
      solid.box(0.08, Math.hypot(d / 2, hb), 0.11, C.wood, sx * (w / 2 + 0.04), base + wallH * 0.5 + hb / 2, k * d / 4, -Math.atan2(k * d / 2, hb), 0, 0);
    }
    // telhado de telhas em fileiras
    const pitch = 0.62, halfW = w / 2 + 0.45, rise = halfW * Math.tan(pitch), slope = halfW / Math.cos(pitch), rows = 8;
    for (const s of [-1, 1]) for (let i = 0; i < rows; i++) {
      const t = (i + 0.5) / rows;
      solid.box(slope / rows * 1.35, 0.07, d + 0.8, roofC, s * (halfW - t * halfW), top + 0.1 + t * rise + (i % 2) * 0.02, 0, 0, 0, -s * pitch, 0.2);
    }
    solid.box(0.22, 0.22, d + 0.9, C.wood, 0, top + rise + 0.12, 0);
    const edge = 0.45 * Math.tan(pitch);
    const gable = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(w / 2, edge),
      new THREE.Vector2(0, rise), new THREE.Vector2(-w / 2, edge)]);
    const gGeo = new THREE.ExtrudeGeometry(gable, { depth: 0.1, bevelEnabled: false });
    solid.add(gGeo, C.plaster, 0, top, d / 2 - 0.1, 0, 0, 0, 1, 1, 1, 0.03);
    solid.add(gGeo, C.plaster, 0, top, -d / 2, 0, 0, 0, 1, 1, 1, 0.03);
    for (const sz of [-1, 1]) solid.box(0.12, rise - 0.1, 0.1, C.wood, 0, top + (rise - 0.1) / 2, sz * (d / 2 + 0.02));

    // porta com batente, tábuas, maçaneta e degrau
    const dx = rand() < 0.5 ? -w / 4 : w / 4, fz = d / 2;
    solid.box(0.95, 1.75, 0.1, C.woodL, dx, base + 0.875, fz + 0.04);
    for (const o of [-0.24, 0, 0.24]) solid.box(0.025, 1.7, 0.03, C.wood, dx + o, base + 0.875, fz + 0.1);
    solid.box(1.2, 0.13, 0.15, C.wood, dx, base + 1.82, fz + 0.06);
    for (const o of [-1, 1]) solid.box(0.13, 1.85, 0.15, C.wood, dx + o * 0.54, base + 0.92, fz + 0.06);
    solid.box(0.07, 0.07, 0.05, C.gold, dx + 0.32, base + 0.9, fz + 0.12);
    solid.box(1.3, 0.22, 0.6, C.stoneL, dx, base - 0.08, fz + 0.38, 0, 0, 0, 0.12);
    glowB.box(0.12, 0.16, 0.12, 0xffc878, dx + 0.75, base + 1.9, fz + 0.12);

    // janelas acesas com venezianas abertas
    const faces = {
      front: (a, n) => [a, fz + n, 0], back: (a, n) => [-a, -fz - n, PI],
      right: (a, n) => [w / 2 + n, -a, PI / 2], left: (a, n) => [-w / 2 - n, a, -PI / 2],
    };
    const shutter = pick([0x2f4a32, 0x3a2e5a, 0x5a2a22]);
    function win(face, a, py) {
      const f = faces[face], at = (u, n) => f(a + u, n);
      const [px, pz, ry] = at(0, 0.02);
      glowB.box(0.62, 0.56, 0.05, 0xffbb60, px, py, pz, 0, ry, 0);
      const [mx, mz] = at(0, 0.06);
      solid.box(0.05, 0.56, 0.04, C.wood, mx, py, mz, 0, ry, 0);
      solid.box(0.62, 0.05, 0.04, C.wood, mx, py, mz, 0, ry, 0);
      solid.box(0.78, 0.09, 0.1, C.wood, mx, py - 0.32, mz, 0, ry, 0);
      solid.box(0.78, 0.08, 0.08, C.wood, mx, py + 0.31, mz, 0, ry, 0);
      for (const o of [-1, 1]) {
        const [sx, sz] = at(o * 0.5, 0.15);
        solid.box(0.3, 0.6, 0.04, shutter, sx, py, sz, 0, ry - o * 0.7, 0);
      }
    }
    win('front', -dx, base + 1.5);
    win('right', 0, base + 1.5); win('left', d * 0.15, base + 1.5);
    if (rand() < 0.6) win('back', 0, base + 1.5);

    // chaminé com fumaça
    const cx = w / 4 * (rand() < 0.5 ? 1 : -1), cz = -d / 4;
    solid.box(0.65, 2.6, 0.65, C.stone, cx, top + 1.0, cz, 0, 0, 0, 0.18);
    solid.box(0.82, 0.14, 0.82, C.stoneL, cx, top + 2.3, cz);
    smokeSources.push(new THREE.Vector3(cx, top + 2.4, cz).applyMatrix4(solid.frame));

    solid.resetFrame(); glowB.resetFrame();
    colliders.push({ x, z, r: Math.hypot(w, d) / 2 * 0.82 });
  }
  [[3, -12, 0.25], [21, -13, -0.3], [2, 3, 1.5], [23, 3, -1.6], [13, -17, 0], [27, -5, -1.65]]
    .forEach(([x, z, r]) => house(x, z, r, rr(3.8, 4.6), rr(4.6, 5.6)));

  // ------------------------------------------------------------ props
  function barrel(x, z, s = 1) {
    const y = groundY(x, z);
    solid.cyl(0.3 * s, 0.3 * s, 0.85 * s, 10, 0x6a4a2a, x, y + 0.42 * s, z);
    solid.cyl(0.34 * s, 0.34 * s, 0.85 * s * 0.55, 10, 0x6a4a2a, x, y + 0.42 * s, z);
    for (const h of [0.12, 0.42, 0.72]) solid.cyl(0.345 * s, 0.345 * s, 0.05, 10, C.iron, x, y + h * s, z);
    solid.cyl(0.28 * s, 0.28 * s, 0.03, 10, 0x4a3220, x, y + 0.86 * s, z);
    colliders.push({ x, z, r: 0.35 * s });
  }
  function crate(x, z, s = 0.8, ry = 0) {
    const y = groundY(x, z) + s / 2;
    solid.box(s, s, s, 0x7a5a32, x, y, z, 0, ry, 0, 0.1);
    for (const k of [-1, 1]) {
      solid.box(s * 1.02, 0.08, 0.08, C.wood, x, y + k * s * 0.45, z, 0, ry, 0);
      solid.box(0.08, s * 1.02, s * 1.02, C.wood, x + Math.cos(ry) * k * s * 0.47, y, z - Math.sin(ry) * k * s * 0.47, 0, ry, 0);
    }
    colliders.push({ x, z, r: s * 0.6 });
  }
  function hay(x, z, ry) {
    const y = groundY(x, z);
    solid.box(1.2, 0.6, 0.7, C.hay, x, y + 0.3, z, 0, ry, 0, 0.15);
    for (const o of [-0.3, 0.3]) solid.box(0.04, 0.62, 0.72, 0x6a5020, x + Math.cos(ry) * o, y + 0.3, z - Math.sin(ry) * o, 0, ry, 0);
    colliders.push({ x, z, r: 0.65 });
  }
  function cart(x, z, ry) {
    const y = groundY(x, z);
    solid.setFrame(x, y, z, ry);
    solid.box(1.4, 0.12, 2.2, C.woodL, 0, 0.75, 0);
    for (const s of [-1, 1]) solid.box(0.08, 0.35, 2.2, C.wood, s * 0.68, 0.95, 0);
    solid.box(1.4, 0.35, 0.08, C.wood, 0, 0.95, -1.08);
    for (const s of [-1, 1]) {
      solid.cyl(0.5, 0.5, 0.08, 12, C.wood, s * 0.8, 0.5, 0.2, 0, 0, PI / 2);
      solid.cyl(0.1, 0.1, 0.12, 6, C.iron, s * 0.8, 0.5, 0.2, 0, 0, PI / 2);
      for (let k = 0; k < 4; k++) solid.box(0.04, 0.9, 0.05, C.woodL, s * 0.82, 0.5, 0.2, k * PI / 4, 0, 0);
      solid.box(0.07, 0.07, 1.6, C.wood, s * 0.35, 0.65, 1.8, -0.25, 0, 0);
    }
    for (let i = 0; i < 3; i++) solid.box(0.7, 0.35, 0.5, C.hay, rr(-0.3, 0.3), 1.0, -0.6 + i * 0.6, 0, rr(-0.3, 0.3), 0, 0.15);
    solid.resetFrame();
    colliders.push({ x, z, r: 1.3 });
  }
  function stall(x, z, ry) {
    const y = groundY(x, z);
    solid.setFrame(x, y, z, ry);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) solid.box(0.12, 2.3, 0.12, C.wood, sx * 1.4, 1.15, sz * 0.8);
    solid.box(3, 0.9, 0.9, C.woodL, 0, 0.45, 0.3, 0, 0, 0, 0.1);
    solid.box(3.1, 0.06, 1.0, C.wood, 0, 0.92, 0.3);
    for (let i = 0; i < 8; i++) solid.box(0.41, 0.05, 2.0, i % 2 ? 0xe0d8c0 : 0x9a2a2a, -1.45 + 0.41 * i + 0.2, 2.35, 0, -0.25, 0, 0, 0.05);
    for (let i = 0; i < 9; i++) solid.add(new THREE.SphereGeometry(0.1, 6, 4), pick([0xb02020, 0xd0a020, 0x4a8a2a]), -1.2 + i * 0.3, 1.02, 0.3 + rr(-0.2, 0.2));
    solid.resetFrame();
    barrel(x + Math.cos(ry) * 1.9, z - Math.sin(ry) * 1.9, 0.8);
    colliders.push({ x, z, r: 1.6 });
  }
  function fenceRing() {
    const R = 20.5, posts = [];
    for (let a = 0; a < PI * 2; a += 2.2 / R) {
      const x = VILLAGE.x + Math.cos(a) * R, z = VILLAGE.z + Math.sin(a) * R;
      const ok = pathDist(x, z) > 2.4 && heightAt(x, z) > 0.2 && canStand(x, z, 0.3);
      posts.push(ok ? { x, z } : null);
    }
    posts.forEach((p, i) => {
      if (!p) return;
      const y = heightAt(p.x, p.z);
      solid.box(0.14, 1.1, 0.14, C.wood, p.x, y + 0.5, p.z, rr(-0.05, 0.05), 0, rr(-0.05, 0.05));
      colliders.push({ x: p.x, z: p.z, r: 0.25 });
      const q = posts[(i + 1) % posts.length];
      if (!q) return;
      const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2, len = Math.hypot(q.x - p.x, q.z - p.z), ry = -Math.atan2(q.z - p.z, q.x - p.x);
      const my = (y + heightAt(q.x, q.z)) / 2;
      for (const h of [0.45, 0.85]) solid.box(len, 0.08, 0.06, C.woodL, mx, my + h, mz, 0, ry, 0);
      colliders.push({ x: mx, z: mz, r: 0.35 });
    });
  }
  function torch(x, z, h = 1.8) {
    const y = groundY(x, z);
    solid.box(0.14, h, 0.14, 0x3a2818, x, y + h / 2, z);
    solid.cyl(0.12, 0.08, 0.2, 6, C.iron, x, y + h + 0.05, z);
    glowB.add(new THREE.ConeGeometry(0.15, 0.42, 5), 0xffa040, x, y + h + 0.32, z);
    addLight(0xff9a40, 9, x, y + h + 0.5, z, 16);
    colliders.push({ x, z, r: 0.2 });
  }
  function banner(x, z, ry) {
    const y = heightAt(x, z);
    solid.box(0.12, 3.6, 0.12, C.wood, x, y + 1.8, z);
    solid.box(1.0, 0.08, 0.08, C.wood, x, y + 3.4, z, 0, ry, 0);
    solid.box(0.8, 1.6, 0.03, C.red, x, y + 2.55, z, 0, ry, 0, 0.05);
    solid.box(0.12, 0.7, 0.04, C.gold, x, y + 2.6, z, 0, ry, 0);
    solid.box(0.45, 0.12, 0.04, C.gold, x, y + 2.75, z, 0, ry, 0);
    solid.add(new THREE.SphereGeometry(0.09, 6, 4), C.gold, x, y + 3.7, z);
    colliders.push({ x, z, r: 0.2 });
  }

  // poço
  {
    const { x, z } = VILLAGE, y = heightAt(x, z);
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * PI * 2;
      solid.box(0.55, 0.85, 0.3, C.stone, x + Math.cos(a) * 0.95, y + 0.42, z + Math.sin(a) * 0.95, 0, -a + PI / 2, 0, 0.18);
    }
    solid.cyl(0.85, 0.85, 0.05, 12, 0x0a1428, x, y + 0.55, z);
    for (const s of [-1, 1]) solid.box(0.14, 2.1, 0.14, C.wood, x + s * 1.0, y + 1.05, z);
    solid.cyl(0.06, 0.06, 2.2, 6, C.wood, x, y + 1.7, z, 0, 0, PI / 2);
    solid.box(0.04, 0.6, 0.04, 0x8a7a5a, x, y + 1.35, z);
    solid.cyl(0.13, 0.11, 0.22, 8, C.woodL, x, y + 0.95, z);
    solid.add(new THREE.ConeGeometry(1.6, 0.9, 4), 0x7a3424, x, y + 2.5, z, 0, PI / 4, 0);
    colliders.push({ x, z, r: 1.2 });
  }
  // fogueira (chama animada fica fora do batch)
  let flame, fireLight;
  {
    const { x, z } = FIRE, y = heightAt(x, z);
    for (let i = 0; i < 5; i++) solid.box(1.15, 0.17, 0.17, 0x3a2414, x, y + 0.12 + i * 0.02, z, 0, i * PI / 5, 0.15);
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * PI * 2;
      solid.add(new THREE.DodecahedronGeometry(0.17), 0x555250, x + Math.cos(a) * 0.8, y + 0.08, z + Math.sin(a) * 0.8, rr(0, 3), rr(0, 3), 0);
    }
    for (let i = 0; i < 4; i++) solid.cyl(0.14, 0.14, 1.4, 7, C.woodL, x + 2.2, y + 0.15 + (i > 2 ? 0.25 : 0), z - 1 + i * 0.32 - (i > 2 ? 0.6 : 0), 0, 0, PI / 2);
    flame = new THREE.Group();
    flame.add(new THREE.Mesh(new THREE.ConeGeometry(0.38, 1.0, 6), glow(0xff9a30)));
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.7, 5), glow(0xffe080)); inner.position.y = -0.1; flame.add(inner);
    flame.position.set(x, y + 0.65, z); scene.add(flame);
    colliders.push({ x, z, r: 0.85 }, { x: x + 2.2, z: z - 0.5, r: 0.8 });
    fireLight = addLight(0xff8a30, 34, x, y + 1.4, z, 30);
  }
  [[7, -8], [18, 1], [2, -4], [4.5, -18]].forEach(([x, z]) => torch(x, z));
  torch(DOCK.x2 + 0.8, DOCK.z1 - 0.8);
  stall(17, -9.5, -0.3);
  barrel(6.2, -7.6); barrel(6.9, -8.3, 0.9); barrel(19.3, -6.7);
  crate(24.5, 0.2, 0.8, 0.3); crate(25.2, 0.9, 0.6, 0.8); crate(7.5, -14.5, 0.9, 0.2);
  hay(25.5, -9.5, 0.4); hay(26, -10.6, 0.2);
  cart(6.5, 5.5, 0.9);
  {
    // estandartes na saída para as ruínas
    const [ax, az, bx, bz] = [12, -4, -6, -30], t = 0.42;
    const px = ax + (bx - ax) * t, pz = az + (bz - az) * t, ry = -Math.atan2(bz - az, bx - ax) + PI / 2;
    const nx = -(bz - az), nz = bx - ax, nl = Math.hypot(nx, nz);
    for (const s of [-1, 1]) banner(px + s * nx / nl * 2.4, pz + s * nz / nl * 2.4, ry);
  }
  fenceRing();

  // cais e barco
  {
    const len = DOCK.x2 - DOCK.x1;
    for (let i = 0; i < len / 0.5; i++) {
      const x = DOCK.x1 + 0.25 + i * 0.5;
      solid.box(0.44, 0.1, DOCK.z2 - DOCK.z1 + 0.2, i % 2 ? 0x5a4028 : 0x4e3822, x, DOCK.y, (DOCK.z1 + DOCK.z2) / 2, 0, 0, rr(-0.02, 0.02));
    }
    for (let x = DOCK.x1 + 0.3; x < DOCK.x2; x += 2.6) for (const z of [DOCK.z1, DOCK.z2]) solid.cyl(0.1, 0.1, 1.8, 6, 0x3a2818, x, -0.45, z);
    solid.cyl(0.05, 0.05, 0.6, 5, 0x3a2818, DOCK.x1 + 0.3, DOCK.y + 0.3, DOCK.z1);
    barrel(DOCK.x1 + 1.2, DOCK.z2 - 0.35, 0.7);
    const bx = DOCK.x1 + 2.4, bz = DOCK.z1 - 1.4;
    solid.setFrame(bx, 0.05, bz, 0.2);
    solid.box(1.1, 0.35, 2.6, 0x5a3a20, 0, 0.12, 0);
    solid.add(new THREE.ConeGeometry(0.55, 0.7, 4), 0x5a3a20, 0, 0.12, 1.6, PI / 2, PI / 4, 0, 1, 1, 0.6);
    solid.box(0.9, 0.06, 2.4, 0x2a1a10, 0, 0.28, 0);
    solid.box(1.0, 0.06, 0.25, C.woodL, 0, 0.32, -0.3);
    solid.box(0.06, 0.06, 1.8, C.woodL, 0.3, 0.38, 0, 0, 0.3, 0);
    solid.resetFrame();
  }

  // ------------------------------------------------------------ ruínas
  {
    const ST = 0x77756c;
    const pillarAt = i => { const a = i / 10 * PI * 2; return [RUINS.x + Math.cos(a) * 7, RUINS.z + Math.sin(a) * 7]; };
    for (let i = 0; i < 10; i++) {
      const [x, z] = pillarAt(i), y = heightAt(x, z);
      const gate = i === 2 || i === 7;
      if (gate) continue;
      const h = rr(0.9, 4.2);
      solid.box(1.1, 0.3, 1.1, ST, x, y + 0.15, z, 0, rr(0, 1), 0, 0.15);
      solid.cyl(0.4, 0.46, h, 8, i % 3 ? ST : C.moss, x, y + 0.3 + h / 2, z);
      if (h > 3) solid.box(1, 0.25, 1, ST, x, y + 0.42 + h, z, 0, rr(0, 1), 0);
      else solid.cyl(0.38, 0.4, 0.5, 8, ST, x + rr(-1.4, 1.4), y + 0.35, z + rr(-1.4, 1.4), PI / 2, rr(0, 3), 0);
      colliders.push({ x, z, r: 0.65 });
      // muro quebrado até o próximo pilar
      if (i % 3 !== 1 && !(i + 1 === 2 || i + 1 === 7)) {
        const [x2, z2] = pillarAt((i + 1) % 10), len = Math.hypot(x2 - x, z2 - z), ry = -Math.atan2(z2 - z, x2 - x);
        const n = Math.floor(len / 0.6);
        for (let k = 1; k < n - 1; k++) {
          const t = k / n, bx = x + (x2 - x) * t, bz = z + (z2 - z) * t, by = heightAt(bx, bz);
          const rows = Math.floor(rr(1, 4.5) * (1 - Math.abs(t - 0.5)));
          for (let r = 0; r < rows; r++) solid.box(0.56, 0.32, 0.5, rand() < 0.2 ? C.moss : ST, bx + rr(-0.04, 0.04), by + 0.16 + r * 0.33, bz, 0, ry + rr(-0.06, 0.06), 0, 0.15);
          if (rows) colliders.push({ x: bx, z: bz, r: 0.35 });
        }
      }
    }
    // arco da entrada que dá para a vila
    {
      const a = 2 / 10 * PI * 2, cx = RUINS.x + Math.cos(a) * 7.3, cz = RUINS.z + Math.sin(a) * 7.3, y = heightAt(cx, cz);
      const tx = -Math.sin(a), tz = Math.cos(a), ry = -Math.atan2(tz, tx);
      for (const s of [-1, 1]) {
        const x = cx + tx * s * 1.6, z = cz + tz * s * 1.6;
        solid.box(0.8, 4, 0.8, ST, x, y + 2, z, 0, ry, 0, 0.12);
        colliders.push({ x, z, r: 0.55 });
      }
      for (let k = 0; k < 7; k++) {
        const t = k / 6, ang = PI * t;
        solid.box(0.55, 0.45, 0.8, ST, cx - tx * Math.cos(ang) * 1.6, y + 4 + Math.sin(ang) * 0.9, cz - tz * Math.cos(ang) * 1.6, 0, ry, -(ang - PI / 2) * 0.9 * 0, 0.12);
      }
    }
    // altar central em degraus com braseiro verde
    const y = heightAt(RUINS.x, RUINS.z);
    [[2.2, 0.25], [1.6, 0.25], [1.0, 0.3]].reduce((h, [r, t]) => { solid.cyl(r, r + 0.1, t, 10, ST, RUINS.x, y + h + t / 2, RUINS.z); return h + t; }, 0);
    solid.cyl(0.5, 0.3, 0.5, 8, C.iron, RUINS.x, y + 1.05, RUINS.z);
    glowB.add(new THREE.ConeGeometry(0.42, 0.9, 6), 0x70ffa0, RUINS.x, y + 1.7, RUINS.z);
    addLight(0x50ff90, 26, RUINS.x, y + 2.3, RUINS.z, 26);
    colliders.push({ x: RUINS.x, z: RUINS.z, r: 2.2 });
    // cemitério: lápides arredondadas, cruzes e ossos
    for (let i = 0; i < 10; i++) {
      const x = RUINS.x + 10 + (i % 5) * 1.6, z = RUINS.z - 3 + Math.floor(i / 5) * 2.6, gy = heightAt(x, z), tilt = rr(-0.18, 0.18);
      if (i % 3 === 2) {
        solid.box(0.12, 1.1, 0.12, ST, x, gy + 0.55, z, 0, 0, tilt);
        solid.box(0.6, 0.12, 0.12, ST, x, gy + 0.8, z, 0, 0, tilt);
      } else {
        solid.box(0.7, 0.7, 0.18, ST, x, gy + 0.35, z, 0, 0, tilt, 0.12);
        solid.cyl(0.35, 0.35, 0.18, 10, ST, x, gy + 0.7, z, PI / 2, 0, tilt);
        solid.box(0.75, 0.12, 1.2, 0x4a4030, x, gy + 0.03, z + 0.7);
      }
      colliders.push({ x, z, r: 0.35 });
    }
    for (let i = 0; i < 14; i++) {
      const x = RUINS.x + rr(-12, 14), z = RUINS.z + rr(-8, 8), gy = heightAt(x, z);
      if (rand() < 0.4) solid.add(new THREE.SphereGeometry(0.1, 6, 4), C.bone, x, gy + 0.08, z, 0, 0, 0, 0.95, 1, 1.1);
      else solid.cyl(0.025, 0.025, 0.4, 5, C.bone, x, gy + 0.03, z, PI / 2, rr(0, 3), 0);
    }
  }

  // ------------------------------------------------------------ vegetação
  const foliageMat = applyCutout(applyWind(tagMat(TAG.FOLIAGE, { vertexColors: true }), 0.1, false, 0.22));
  const trunkMat = applyCutout(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  const merge = parts => mergeGeometries(parts.map(([g, c, j]) => colorize(g, c, j ?? 0.1)));

  function pineGeo() {
    const trunk = merge([[new THREE.CylinderGeometry(0.1, 0.2, 1.8, 6).translate(0, 0.9, 0), 0x4a3420]]);
    const tiers = [];
    const cols = [0x173a1f, 0x1d4626, 0x24522c, 0x2b5e32, 0x316838];
    for (let i = 0; i < 5; i++) {
      const r = 1.35 - i * 0.24, h = 1.2 - i * 0.05;
      const g = new THREE.ConeGeometry(r, h, 8).rotateY(rr(0, 1)).translate(rr(-0.06, 0.06), 1.0 + i * 0.62 + h / 2, rr(-0.06, 0.06));
      tiers.push([g, cols[i], 0.14]);
    }
    return { trunk, leaves: merge(tiers) };
  }
  function oakGeo(autumn) {
    const parts = [[new THREE.CylinderGeometry(0.16, 0.3, 2.2, 7).translate(0, 1.1, 0), 0x4a3828]];
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * PI * 2 + rr(0, 1);
      parts.push([new THREE.CylinderGeometry(0.05, 0.09, 1.2, 5).translate(0, 0.6, 0).rotateZ(0.9).rotateY(a).translate(0, 1.7, 0), 0x4a3828]);
    }
    const leaves = [];
    const pal = autumn ? [0x8a5a18, 0x9a4418, 0x7a6a20] : [0x2d5a22, 0x356428, 0x3d6e2a];
    for (let i = 0; i < 8; i++) {
      const a = rand() * PI * 2, d = rr(0.2, 1.1);
      leaves.push([new THREE.IcosahedronGeometry(rr(0.65, 1.05), 1).scale(1, 0.8, 1).translate(Math.cos(a) * d, rr(2.4, 3.4), Math.sin(a) * d), pick(pal), 0.16]);
    }
    return { trunk: merge(parts), leaves: merge(leaves) };
  }
  function deadGeo() {
    const parts = [[new THREE.CylinderGeometry(0.1, 0.24, 2.6, 6).translate(0, 1.3, 0), 0x4a4038]];
    for (let i = 0; i < 5; i++) {
      const a = rand() * PI * 2;
      parts.push([new THREE.CylinderGeometry(0.03, 0.07, rr(0.8, 1.4), 4).translate(0, 0.5, 0).rotateZ(rr(0.5, 1.1)).rotateY(a).translate(0, rr(1.3, 2.4), 0), 0x4a4038]);
    }
    return { trunk: merge(parts), leaves: null };
  }
  const variants = { pine: [pineGeo(), pineGeo()], oak: [oakGeo(false), oakGeo(false), oakGeo(true)], dead: [deadGeo()] };
  const placements = new Map(Object.values(variants).flat().map(v => [v, []]));
  for (let tries = 0, n = 0; tries < 7000 && n < 560; tries++) {
    const x = rr(-WORLD + 2, WORLD - 2), z = rr(-WORLD + 2, WORLD - 2), h = heightAt(x, z);
    if (h < 0.5 || h > 7) continue;
    if (Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < 22 || Math.hypot(x - RUINS.x, z - RUINS.z) < 10) continue;
    if (pathDist(x, z) < 2.6 || !canStand(x, z, 1.1)) continue;
    if (fbm(x * 0.08 + 9, z * 0.08) < 0.38) continue;
    const nearRuins = Math.hypot(x - RUINS.x, z - RUINS.z) < 22;
    const kind = nearRuins && rand() < 0.35 ? 'dead' : (h > 4 || fbm(x * 0.05 + 40, z * 0.05) > 0.5) ? 'pine' : 'oak';
    const v = pick(variants[kind]), sc = rr(0.8, 1.45);
    placements.get(v).push([x, z, sc]); colliders.push({ x, z, r: 0.4 * sc }); n++;
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (const [v, list] of placements) {
    if (!list.length) continue;
    const ims = [[v.trunk, trunkMat], [v.leaves, foliageMat]].filter(([g]) => g).map(([g, m]) => {
      const im = new THREE.InstancedMesh(g, m, list.length);
      im.castShadow = im.receiveShadow = true; scene.add(im); return im;
    });
    list.forEach(([x, z, sc], i) => {
      m4.compose(pv.set(x, heightAt(x, z) - 0.05, z), q.setFromAxisAngle(up, rr(0, 6.28)), sv.set(sc, sc * rr(0.9, 1.2), sc));
      ims.forEach(im => im.setMatrixAt(i, m4));
    });
    ims.forEach(im => im.computeBoundingSphere());
  }

  // arbustos e rochas
  {
    const bushGeos = [0, 1].map(() => merge(Array.from({ length: 4 }, () => [
      new THREE.IcosahedronGeometry(rr(0.35, 0.55), 1).scale(1, 0.75, 1).translate(rr(-0.4, 0.4), rr(0.25, 0.45), rr(-0.4, 0.4)),
      pick([0x24481e, 0x2a5222, 0x1e3e1a]), 0.16])));
    const spots = [[], []];
    for (let t = 0; t < 4000 && spots[0].length + spots[1].length < 320; t++) {
      const x = rr(-WORLD + 2, WORLD - 2), z = rr(-WORLD + 2, WORLD - 2), h = heightAt(x, z);
      if (h < 0.3 || h > 5 || pathDist(x, z) < 2 || Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < 12 || !canStand(x, z, 0.7)) continue;
      spots[t % 2].push([x, z, rr(0.7, 1.3)]);
    }
    spots.forEach((list, k) => {
      const im = new THREE.InstancedMesh(bushGeos[k], foliageMat, list.length);
      im.castShadow = im.receiveShadow = true;
      list.forEach(([x, z, sc], i) => im.setMatrixAt(i, m4.compose(pv.set(x, heightAt(x, z) - 0.05, z), q.setFromAxisAngle(up, rr(0, 6)), sv.set(sc, sc, sc))));
      im.computeBoundingSphere(); scene.add(im);
    });

    const rockGeo = (() => {
      const g = new THREE.DodecahedronGeometry(1, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const f = 0.8 + 0.4 * fbm(p.getX(i) * 2 + 5, p.getZ(i) * 2 + p.getY(i)); p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * 0.75, p.getZ(i) * f); }
      g.computeVertexNormals();
      const cg = colorize(g, C.stoneL, 0.15), col = cg.attributes.color, nrm = cg.attributes.normal, moss = new THREE.Color(C.moss);
      for (let i = 0; i < col.count; i += 3) if (nrm.getY(i) > 0.6) for (let k = 0; k < 3; k++) col.setXYZ(i + k, moss.r, moss.g, moss.b);
      return cg;
    })();
    const rocks = [];
    for (let t = 0; t < 2000 && rocks.length < 90; t++) {
      const x = rr(-WORLD + 2, WORLD - 2), z = rr(-WORLD + 2, WORLD - 2), h = heightAt(x, z);
      if (h < 0.1 || pathDist(x, z) < 2 || Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < 14 || !canStand(x, z, 0.8)) continue;
      const sc = rr(0.3, 1.0); rocks.push([x, z, sc]); colliders.push({ x, z, r: sc * 0.7 });
    }
    const rim = new THREE.InstancedMesh(rockGeo, trunkMat, rocks.length);
    rim.castShadow = rim.receiveShadow = true;
    rocks.forEach(([x, z, sc], i) => rim.setMatrixAt(i, m4.compose(pv.set(x, heightAt(x, z) - sc * 0.15, z), q.setFromEuler(new THREE.Euler(rr(-0.3, 0.3), rr(0, 6), 0)), sv.set(sc, sc, sc))));
    rim.computeBoundingSphere(); scene.add(rim);
  }

  // ------------------------------------------------------------ grama alta
  const grassMeshes = [];
  {
    const pos = [], col = [], nor = [], idx = [], SEG = 4;
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG, w = 0.06 * (1 - t * 0.9), z = t * t * 0.14;
      pos.push(-w, t, z, w, t, z); nor.push(0, 1, 0, 0, 1, 0);
      const c = [0.08 + 0.4 * t, 0.17 + 0.5 * t, 0.05 + 0.14 * t]; col.push(...c, ...c);
    }
    // as duas faces com winding oposto: cada lado é "frente" e recebe luz por cima
    for (let i = 0; i < SEG; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2, a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const blade = new THREE.BufferGeometry();
    blade.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    blade.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    blade.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    blade.setIndex(idx);
    // flor: haste + corola
    const flower = merge([[new THREE.CylinderGeometry(0.012, 0.015, 0.8, 3).translate(0, 0.4, 0), 0x2a4a1a, 0],
      [new THREE.OctahedronGeometry(0.07).scale(1, 0.6, 1).translate(0, 0.82, 0), 0xffffff, 0]]);
    const grassMat = applyWind(tagMat(TAG.GRASS, { vertexColors: true, flatShading: false }), 0.22, true, 1);
    const flowerMat = applyWind(new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x111111 }), 0.22, true, 1);
    const big = colliders.filter(c => c.r > 1.0);
    const FLOWERS = [0xd04040, 0xe0c040, 0x9a60d0, 0xe8e8f0, 0x4080e0];
    const CH = 16, col2 = new THREE.Color();
    for (let cx = -WORLD; cx < WORLD; cx += CH) for (let cz = -WORLD; cz < WORLD; cz += CH) {
      const blades = [], flowers = [];
      for (let k = 0; k < 4200; k++) {
        const x = cx + rand() * CH, z = cz + rand() * CH, h = heightAt(x, z);
        if (h < 0.3 || h > 5.5 || onDock(x, z)) continue;
        if (pathDist(x, z) < 1.3 || Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < 9.5 || Math.hypot(x - RUINS.x, z - RUINS.z) < 6.5) continue;
        const dens = fbm(x * 0.06 + 20, z * 0.06);
        if (rand() > smooth(0.3, 0.55, dens)) continue;
        if (big.some(c => (x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r)) continue;
        if (rand() < 0.012 && dens > 0.45) flowers.push([x, h, z]);
        else blades.push([x, h, z, dens]);
      }
      if (blades.length) {
        const im = new THREE.InstancedMesh(blade, grassMat, blades.length);
        blades.forEach(([x, h, z, dens], i) => {
          im.setMatrixAt(i, m4.compose(pv.set(x, h - 0.03, z), q.setFromAxisAngle(up, rand() * 6.28), sv.set(rr(0.8, 1.3), rr(0.45, 1.25) * (0.55 + dens * 0.8), 1)));
          im.setColorAt(i, rand() < 0.08 ? col2.setRGB(1.35, 1.15, 0.6) : col2.setRGB(rr(0.8, 1.1), rr(0.85, 1.15), rr(0.6, 1.0)));
        });
        im.receiveShadow = true; im.layers.set(1); im.computeBoundingSphere();
        im.userData.full = blades.length;
        scene.add(im); grassMeshes.push(im);
      }
      if (flowers.length) {
        const im = new THREE.InstancedMesh(flower, flowerMat, flowers.length);
        flowers.forEach(([x, h, z], i) => {
          im.setMatrixAt(i, m4.compose(pv.set(x, h - 0.03, z), q.setFromAxisAngle(up, rand() * 6.28), sv.set(1, rr(0.8, 1.3), 1)));
          im.setColorAt(i, col2.set(pick(FLOWERS)));
        });
        im.layers.set(1); im.computeBoundingSphere(); scene.add(im);
      }
    }
  }

  // ------------------------------------------------------------ monta os batches
  scene.add(solid.build(applyCutout(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }))));
  scene.add(glowB.build(new THREE.MeshBasicMaterial({ vertexColors: true }), false));

  // ------------------------------------------------------------ partículas
  function points(n, color, size) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: false }));
    p.frustumCulled = false; scene.add(p); return p;
  }
  const embers = points(40, 0xffa040, 6); embers.userData.life = Array.from({ length: 40 }, () => rand());
  const fireflies = points(60, 0xd8ff70, 5); fireflies.userData.seeds = Array.from({ length: 60 }, () => [rr(-16, 16), rr(-14, 14), rr(0, 100)]);
  const SMOKE_PER = 14;
  const smoke = points(smokeSources.length * SMOKE_PER, 0x8a90a0, 9);
  smoke.userData.life = Array.from({ length: smokeSources.length * SMOKE_PER }, () => rand());

  // ------------------------------------------------------------ atualização por quadro
  const fireY = heightAt(FIRE.x, FIRE.z);
  let grassDensity = 1;
  return {
    terrain, moonLight, MOON_DIR,
    setGrassDensity(d) {
      grassDensity = d;
      grassMeshes.forEach(im => { im.count = Math.floor(im.userData.full * d); });
    },
    get grassDensity() { return grassDensity; },
    update(dt, time, target, player) {
      wind.time.value = time;
      wind.pusher.value.set(player.x, 0, player.z);
      water.material.uniforms.time.value = time;
      sky.position.copy(target);
      moonLight.position.copy(target).addScaledVector(MOON_DIR, 60);
      moonLight.target.position.copy(target);

      for (const f of flickers) f.l.intensity = f.base * (0.82 + 0.12 * Math.sin(time * 11 + f.seed) + 0.08 * Math.sin(time * 27 + f.seed * 3));
      flame.scale.set(1 + Math.sin(time * 9) * 0.08, 0.85 + Math.sin(time * 14) * 0.18, 1);
      flame.rotation.y = time * 2;

      const ea = embers.geometry.attributes.position, el = embers.userData.life;
      for (let i = 0; i < el.length; i++) {
        el[i] = (el[i] + dt * 0.6) % 1; const l = el[i];
        ea.setXYZ(i, FIRE.x + Math.sin(i * 7.3 + l * 4) * 0.4 * l, fireY + 0.6 + l * 3.5, FIRE.z + Math.cos(i * 3.1 + l * 3) * 0.4 * l);
      }
      ea.needsUpdate = true;

      const fa = fireflies.geometry.attributes.position;
      fireflies.userData.seeds.forEach(([ox, oz, k], i) => fa.setXYZ(i,
        LAKE.x + ox + Math.sin(time * 0.4 + k) * 2, 0.7 + Math.sin(time * 1.3 + k * 2) * 0.4, LAKE.z + oz + Math.cos(time * 0.3 + k) * 2));
      fa.needsUpdate = true;

      const sa = smoke.geometry.attributes.position, sl = smoke.userData.life;
      for (let i = 0; i < sl.length; i++) {
        sl[i] = (sl[i] + dt * 0.18) % 1; const l = sl[i], s = smokeSources[Math.floor(i / SMOKE_PER)];
        sa.setXYZ(i, s.x + l * l * 2.5 + Math.sin(i * 3.7 + time) * 0.25 * l, s.y + l * 4, s.z + Math.cos(i * 5.1 + time * 0.7) * 0.3 * l);
      }
      sa.needsUpdate = true;
    },
  };
}
