// Personagens: um "rig" de juntas (quadril, coluna, peito, pescoço, cabeça,
// ombros, cotovelos, mãos, coxas, joelhos, pés) vestido com peças low-poly,
// e as funções de pose que animam caminhada, respiração e ataques.
import * as THREE from 'three';
import { glow, TAG } from './geo.js';
import { kf, rand, rr } from './util.js';

const PI = Math.PI;

// ---------------------------------------------------------------- materiais
// Phong (tem brilho especular) + luz de borda fria: dá o metal polido
// das capas de fantasia dos anos 80. Todos levam a marca CHAR para o ASCII.
export const rimLight = { color: { value: new THREE.Color(0x7d9cff) } };
function charMat(color, { spec = 0x1a1a1a, shine = 12, rim = 0.3, flat = true, emissive = 0, side = THREE.FrontSide } = {}) {
  const m = new THREE.MeshPhongMaterial({
    color, specular: spec, shininess: shine, flatShading: flat, side,
    emissive: emissive || color, emissiveIntensity: emissive ? 1 : 0.1,
    blending: THREE.NoBlending, opacity: TAG.CHAR,
  });
  const rimStrength = { value: rim };
  m.onBeforeCompile = sh => {
    sh.uniforms.uRimColor = rimLight.color; sh.uniforms.uRim = rimStrength;
    sh.fragmentShader = 'uniform vec3 uRimColor; uniform float uRim;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', `
      float rimF = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
      outgoingLight += uRimColor * pow(rimF, 3.0) * uRim;
      #include <opaque_fragment>`);
  };
  return m;
}
const matCache = new Map();
function mat(color, emissive = 0) {          // material genérico (couro, pano, osso, pelo)
  const k = color + ':' + emissive;
  if (!matCache.has(k)) matCache.set(k, charMat(color, { emissive, rim: 0.28 }));
  return matCache.get(k);
}
// metais: superfície lisa, reflexo forte e azulado
const METAL = {
  steel: () => charMat(0x464f60, { spec: 0xb8ccff, shine: 80, rim: 0.55, flat: false }),
  steelD: () => charMat(0x1f2430, { spec: 0x8098d8, shine: 50, rim: 0.45, flat: false }),
  gold: () => charMat(0x7a5a22, { spec: 0xffd890, shine: 60, rim: 0.3, flat: false }),
  blade: () => charMat(0x8f9aaa, { spec: 0xffffff, shine: 110, rim: 0.8, flat: false, emissive: 0x141c30 }),
};

const bx = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 8, open = false) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open);
const sph = (r, ws = 8, hs = 6, ...rest) => new THREE.SphereGeometry(r, ws, hs, ...rest);
const cone = (r, h, s = 6) => new THREE.ConeGeometry(r, h, s);
const dome = (r, s = 10) => new THREE.SphereGeometry(r, s, 5, 0, PI * 2, 0, PI / 2);
// perfil 2D [raio, altura] girado em torno do eixo Y: peças arredondadas de armadura
const lathe = (pts, seg = 18, phiStart = 0, phiLen = PI * 2) =>
  new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg, phiStart, phiLen);
// faixa de esfera (uma "lâmina" de ombreira)
const band = (r, from, size, seg = 18) => new THREE.SphereGeometry(r, seg, 4, 0, PI * 2, from, size);

// junta (pivô) filha de `parent`
function J(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g;
}
// peça rígida presa a uma junta
function P(parent, geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.scale.set(sx, sy, sz);
  o.castShadow = true; o.receiveShadow = true;
  parent.add(o); return o;
}

function makeRig(p) {
  const root = new THREE.Group();
  const hips = J(root, 0, p.hipH, 0);
  const spine = J(hips, 0, 0.1, 0);
  const chest = J(spine, 0, p.spineLen, 0);
  const neck = J(chest, 0, p.chestLen, 0);
  const head = J(neck, 0, 0.09, 0);
  const side = s => {
    const shoulder = J(chest, s * p.shoulderW, p.chestLen - 0.06, 0);
    const elbow = J(shoulder, 0, -p.upperArm, 0);
    const hand = J(elbow, 0, -p.foreArm, 0);
    const thigh = J(hips, s * p.hipW, 0, 0);
    const knee = J(thigh, 0, -p.thighLen, 0);
    const foot = J(knee, 0, -p.shinLen, 0);
    return { shoulder, elbow, hand, thigh, knee, foot };
  };
  return { root, hips, spine, chest, neck, head, L: side(-1), R: side(1), p };
}

const HUMAN = { hipH: 0.9, spineLen: 0.2, chestLen: 0.32, shoulderW: 0.27, upperArm: 0.29, foreArm: 0.27,
  hipW: 0.11, thighLen: 0.44, shinLen: 0.42 };

// ---------------------------------------------------------------- armas

function makeSword({ blade = null, guard = 0xc9a043, grip = 0x4a2e1a, len = 0.85, width = 0.035, gripLen = 0.16, guardW = 0.26 } = {}) {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(-width, 0); s.lineTo(width, 0); s.lineTo(width * 0.85, len * 0.88); s.lineTo(0, len);
  s.lineTo(-width * 0.85, len * 0.88); s.closePath();
  const bg = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.007, bevelSize: 0.007, bevelSegments: 2 });
  bg.translate(0, 0, -0.006);
  const z0 = gripLen / 2 + 0.03;
  P(g, bg, blade ? mat(blade) : METAL.blade(), 0, 0, z0, PI / 2, 0, 0);
  P(g, bx(0.012, 0.03, len * 0.65), METAL.steelD(), 0, 0, z0 + len * 0.36);              // sulco
  const gm = typeof guard === 'number' ? mat(guard) : guard;
  P(g, bx(guardW, 0.035, 0.04), gm, 0, 0, z0 - 0.01);                                   // guarda
  for (const sx of [-1, 1]) P(g, sph(0.026, 8, 6), gm, sx * guardW / 2, 0, z0 - 0.01);
  P(g, cyl(0.019, 0.019, gripLen, 8), mat(grip), 0, 0, 0, PI / 2, 0, 0);                  // empunhadura
  for (let i = 0; i < Math.floor(gripLen / 0.04); i++) P(g, cyl(0.022, 0.022, 0.008, 8), mat(0x2a1a10), 0, 0, -gripLen / 2 + 0.02 + i * 0.04, PI / 2, 0, 0);
  P(g, sph(0.034, 10, 8), gm, 0, 0, -gripLen / 2 - 0.03);                               // pomo
  return g;
}

// ---------------------------------------------------------------- cavaleiro

export function makeKnight() {
  const r = makeRig(HUMAN);
  const steel = METAL.steel(), steelD = METAL.steelD(), gold = METAL.gold();
  const steelDS = charMat(0x464f60, { spec: 0xb8ccff, shine: 80, rim: 0.55, flat: false, side: THREE.DoubleSide });
  const mail = charMat(0x2e3138, { spec: 0x666e80, shine: 25, rim: 0.35 });
  const red = mat(0x5a0c12), redD = mat(0x3a070c), leather = mat(0x3a2416), dark = glow(0x020205);

  // --- quadril: malha, cinto, escarcelas presas às coxas
  P(r.hips, cyl(0.19, 0.21, 0.18, 14), mail, 0, -0.02, 0);
  P(r.hips, cyl(0.205, 0.205, 0.05, 18), leather, 0, 0.06, 0, 0, 0, 0, 1.06, 1, 0.82);
  P(r.hips, bx(0.07, 0.06, 0.02), gold, 0, 0.06, 0.17);
  const tabF = J(r.hips, 0, 0.03, 0.15), tabB = J(r.hips, 0, 0.03, -0.16);
  P(tabF, bx(0.2, 0.5, 0.015), red, 0, -0.25, 0);
  P(tabB, bx(0.24, 0.52, 0.015), redD, 0, -0.26, 0);
  r.tabard = [tabF, tabB];
  for (const [A, s] of [[r.L, -1], [r.R, 1]]) {
    for (let i = 0; i < 3; i++) {
      P(A.thigh, cyl(0.12 - i * 0.005, 0.13 - i * 0.004, 0.08, 14, true), steelDS, 0, 0.02 - i * 0.07, 0.015, 0.12, 0, s * 0.05, 1.05, 1, 0.9);
    }
  }

  // --- tronco: lâminas do abdômen, peitoral arredondado com quilha, gorjal
  for (let i = 0; i < 3; i++) P(r.spine, cyl(0.19 + i * 0.006, 0.2 + i * 0.006, 0.08, 20), i === 2 ? steel : steelD, 0, 0.02 + i * 0.07, 0, 0, 0, 0, 1.1, 1, 0.8);
  P(r.chest, lathe([[0.17, 0], [0.195, 0.05], [0.22, 0.13], [0.228, 0.21], [0.215, 0.28], [0.17, 0.33], [0.12, 0.35]], 22), steel, 0, -0.01, 0, 0, 0, 0, 1.12, 1, 0.8);
  P(r.chest, bx(0.022, 0.3, 0.03), steel, 0, 0.16, 0.175, -0.16, 0, 0);
  for (const s of [-1, 1]) P(r.chest, bx(0.012, 0.22, 0.02), gold, s * 0.08, 0.17, 0.165, -0.14, s * 0.4, 0);
  P(r.chest, lathe([[0.2, 0], [0.16, 0.04], [0.12, 0.07], [0.09, 0.1]], 20), steelD, 0, 0.3, 0, 0, 0, 0, 1.1, 1, 0.95);

  // --- capa longa e escura, presa nos ombros
  r.cape = [];
  let parent = J(r.chest, 0, 0.32, -0.19);
  for (let i = 0; i < 5; i++) {
    const seg = J(parent, 0, i ? -0.2 : 0, 0);
    P(seg, bx(0.46 + i * 0.05, 0.21, 0.02), i < 3 ? red : redD, 0, -0.1, 0);
    r.cape.push(seg); parent = seg;
  }

  // --- elmo: bacinete arredondado, viseira em "focinho", fenda, crista
  P(r.neck, cyl(0.075, 0.085, 0.1, 10), mail, 0, 0.04, 0);
  P(r.head, lathe([[0.1, -0.03], [0.13, 0.0], [0.148, 0.07], [0.152, 0.15], [0.148, 0.21], [0.132, 0.27], [0.1, 0.32], [0.055, 0.35], [0.0, 0.36]], 22), steel, 0, 0, 0);
  P(r.head, lathe([[0.15, 0.03], [0.17, 0.08], [0.182, 0.13], [0.175, 0.18], [0.155, 0.225]], 16, -1.0, 2.0), steelDS, 0, 0, 0, 0, 0, 0, 1, 1, 1.12);
  P(r.head, bx(0.22, 0.02, 0.05), dark, 0, 0.162, 0.192);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) P(r.head, bx(0.012, 0.035, 0.04), dark, s * (0.04 + i * 0.026), 0.085, 0.185 - i * 0.014, 0, s * 0.3, 0);
  P(r.head, new THREE.TorusGeometry(0.152, 0.011, 6, 20, PI), steel, 0, 0.2, 0, 0, PI / 2, 0);
  P(r.head, new THREE.TorusGeometry(0.15, 0.008, 6, 22), gold, 0, 0.03, 0, PI / 2, 0, 0);

  // --- braços: ombreiras em camadas, cotoveleira com aba, manopla
  for (const [A, s] of [[r.L, -1], [r.R, 1]]) {
    const pa = J(A.shoulder, s * 0.035, 0.03, 0);
    pa.rotation.z = -s * 0.4;
    P(pa, band(0.14, 0, PI * 0.38, 20), steel, 0, -0.02, 0, 0, 0, 0, 1.05, 0.62, 1.15);
    for (let i = 0; i < 3; i++) P(pa, band(0.142 + i * 0.006, PI * (0.36 + i * 0.07), PI * 0.08, 20), i % 2 ? steelD : steel, 0, -0.03 - i * 0.022, 0, 0, 0, 0, 1.05, 0.7, 1.15);
    P(pa, new THREE.TorusGeometry(0.142, 0.007, 6, 22), gold, 0, -0.085, 0, PI / 2, 0, 0, 1.08, 1.18, 1);
    P(A.shoulder, cyl(0.062, 0.058, 0.27, 12), mail, 0, -0.14, 0);
    P(A.shoulder, cyl(0.07, 0.066, 0.15, 14), steel, 0, -0.2, 0);
    P(A.elbow, sph(0.074, 14, 10), steel);
    P(A.elbow, cone(0.085, 0.035, 14), steelD, s * 0.055, 0, -0.015, 0, 0, s * PI / 2);
    P(A.elbow, lathe([[0.068, 0], [0.066, -0.08], [0.058, -0.2], [0.054, -0.25]], 14), steel);
    P(A.hand, cyl(0.075, 0.058, 0.07, 14), steel, 0, 0.03, 0);
    P(A.hand, bx(0.085, 0.1, 0.1), steelD, 0, -0.045, 0.01);
    for (let i = 0; i < 3; i++) P(A.hand, bx(0.09, 0.025, 0.105), steel, 0, -0.01 - i * 0.03, 0.012);
  }
  // --- pernas: coxote, joelheira com aba, greva moldada, escarpe em lâminas
  for (const [A, s] of [[r.L, -1], [r.R, 1]]) {
    P(A.thigh, cyl(0.092, 0.076, 0.4, 14), steel, 0, -0.22, 0.005);
    P(A.knee, sph(0.08, 14, 10), steel, 0, 0, 0.02);
    P(A.knee, cone(0.09, 0.03, 14), steelD, s * 0.06, 0, 0.01, 0, 0, s * PI / 2);
    P(A.knee, lathe([[0.066, 0.0], [0.072, -0.08], [0.075, -0.17], [0.066, -0.3], [0.056, -0.4]], 16), steel);
    for (let i = 0; i < 3; i++) P(A.foot, bx(0.1 - i * 0.008, 0.06 - i * 0.008, 0.08), i % 2 ? steelD : steel, 0, -0.005 - i * 0.006, -0.03 + i * 0.07);
    P(A.foot, cone(0.04, 0.1, 10), steel, 0, -0.025, 0.24, PI / 2, 0, 0, 1, 1, 0.6);
  }

  // --- montante na mão direita
  r.sword = makeSword({ len: 1.2, width: 0.045, gripLen: 0.26, guardW: 0.36, guard: gold, grip: 0x2a1810 });
  r.sword.position.set(0, -0.06, 0);
  r.R.hand.add(r.sword);
  // pontos da lâmina usados pelo rastro do golpe (z0 = 0.16, comprimento 1.2)
  r.swordTip = new THREE.Vector3(0, 0, 1.34); r.swordMid = new THREE.Vector3(0, 0, 0.5);

  // --- luz pessoal (lanterna) que acompanha o herói
  const light = new THREE.PointLight(0xffc890, 7, 14, 2); light.position.set(0.3, 2.8, 1.4);
  r.root.add(light);
  return r;
}

// ---------------------------------------------------------------- esqueleto

export function makeSkeleton(lord = false) {
  const r = makeRig({ ...HUMAN, hipH: 0.88, shoulderW: 0.22 });
  const bone = mat(lord ? 0xc9c0a0 : 0xd9d2bc), boneD = mat(lord ? 0x9a9078 : 0xa89f88);
  const eye = glow(lord ? 0x7dff9a : 0xff3a20), socket = glow(0x050403);
  const rust = charMat(0x5a3a26, { spec: 0x6a5040, shine: 20, rim: 0.3 }), rustD = mat(0x3a2618);
  const rag = mat(lord ? 0x2a1238 : [0x3a3428, 0x2c2a30, 0x3a2420][Math.floor(rand() * 3)]);

  // bacia e sacro
  P(r.hips, lathe([[0.05, -0.06], [0.13, -0.02], [0.15, 0.04], [0.1, 0.08]], 12), bone, 0, 0, 0, 0, 0, 0, 1.1, 1, 0.7);
  P(r.hips, bx(0.05, 0.12, 0.05), boneD, 0, 0.06, -0.06);
  // coluna com processos espinhosos
  for (let i = 0; i < 5; i++) {
    P(r.spine, cyl(0.028, 0.028, 0.032, 8), bone, 0, 0.02 + i * 0.045, -0.04);
    P(r.spine, bx(0.012, 0.02, 0.05), boneD, 0, 0.02 + i * 0.045, -0.075);
  }
  // caixa torácica: costelas em arco, esterno, clavículas, escápulas
  for (let i = 0; i < 6; i++) {
    const rad = 0.15 - Math.abs(i - 2.5) * 0.012;
    P(r.chest, new THREE.TorusGeometry(rad, 0.013, 5, 14, PI * 1.55), bone, 0, 0.03 + i * 0.05, -0.01, PI / 2 + 0.12, 0, 0.725 * PI, 1, 0.8, 1);
  }
  P(r.chest, bx(0.035, 0.22, 0.025), bone, 0, 0.15, 0.122, -0.12, 0, 0);
  for (let i = 0; i < 6; i++) P(r.chest, cyl(0.026, 0.026, 0.03, 8), bone, 0, 0.02 + i * 0.05, -0.12);
  for (const s of [-1, 1]) {
    P(r.chest, cyl(0.013, 0.013, 0.2, 6), bone, s * 0.1, 0.3, 0.05, 0, s * 0.3, PI / 2);
    P(r.chest, bx(0.1, 0.13, 0.015), boneD, s * 0.1, 0.22, -0.14, 0, 0, s * 0.2);
  }
  // pescoço e crânio: calota, face, órbitas com brasa, dentes e mandíbula articulada
  for (let i = 0; i < 3; i++) P(r.neck, cyl(0.022, 0.022, 0.025, 8), bone, 0, i * 0.035, -0.01);
  const skull = J(r.head, 0, 0.02, 0);
  P(skull, lathe([[0, 0], [0.09, 0.02], [0.125, 0.08], [0.13, 0.15], [0.115, 0.21], [0.075, 0.25], [0, 0.265]], 16), bone, 0, 0, 0, 0, 0, 0, 0.95, 1, 1.12);
  P(skull, bx(0.17, 0.11, 0.07), bone, 0, 0.075, 0.095);
  for (const s of [-1, 1]) {
    P(skull, bx(0.045, 0.03, 0.09), boneD, s * 0.085, 0.085, 0.08);
    P(skull, sph(0.036, 8, 6), socket, s * 0.045, 0.125, 0.118, 0, 0, 0, 1, 0.9, 0.55);
    P(skull, sph(0.015, 6, 4), eye, s * 0.045, 0.125, 0.135);
  }
  P(skull, cone(0.02, 0.045, 3), socket, 0, 0.085, 0.132, PI, 0, 0);
  for (let i = 0; i < 6; i++) P(skull, bx(0.013, 0.022, 0.012), bone, -0.04 + i * 0.016, 0.03, 0.127);
  const jaw = J(skull, 0, 0.04, 0.02);
  P(jaw, bx(0.15, 0.035, 0.1), boneD, 0, -0.025, 0.04);
  for (let i = 0; i < 6; i++) P(jaw, bx(0.012, 0.018, 0.012), bone, -0.04 + i * 0.016, -0.004, 0.088);
  r.jaw = jaw;
  // membros: ossos longos com articulações, rádio e ulna, dedos
  for (const [A, s] of [[r.L, -1], [r.R, 1]]) {
    P(A.shoulder, sph(0.036, 8, 6), boneD);
    P(A.shoulder, cyl(0.02, 0.017, 0.25, 6), bone, 0, -0.14, 0);
    P(A.elbow, sph(0.03, 8, 6), boneD);
    P(A.elbow, cyl(0.011, 0.011, 0.25, 5), bone, 0.012, -0.13, 0, 0, 0, 0.04);
    P(A.elbow, cyl(0.011, 0.011, 0.25, 5), bone, -0.012, -0.13, 0, 0, 0, -0.04);
    P(A.hand, bx(0.05, 0.04, 0.025), boneD, 0, -0.02, 0);
    for (let i = 0; i < 4; i++) P(A.hand, cyl(0.006, 0.005, 0.07, 4), bone, -0.018 + i * 0.012, -0.07, 0.005);
    P(A.thigh, sph(0.04, 8, 6), boneD);
    P(A.thigh, cyl(0.024, 0.019, 0.42, 6), bone, 0, -0.21, 0);
    P(A.knee, sph(0.034, 8, 6), boneD, 0, 0, 0.02);
    P(A.knee, cyl(0.016, 0.013, 0.4, 5), bone, 0.01, -0.2, 0);
    P(A.knee, cyl(0.009, 0.008, 0.38, 5), bone, s * -0.025, -0.2, -0.01);
    P(A.foot, bx(0.06, 0.03, 0.08), boneD, 0, 0, 0.0);
    for (let i = 0; i < 4; i++) P(A.foot, cyl(0.007, 0.006, 0.09, 4), bone, -0.022 + i * 0.015, -0.005, 0.08, PI / 2, 0, 0);
  }
  // trapos rasgados em tiras
  for (const zs of [1, -1]) for (let i = 0; i < 4; i++) {
    P(r.hips, bx(0.055, rr(0.16, 0.32), 0.012), rag, -0.08 + i * 0.055, -0.13, zs * 0.085, zs * 0.08, 0, rr(-0.12, 0.12));
  }

  if (lord) {
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * PI * 2;
      P(skull, cone(0.025, 0.12, 4), mat(0xc9a043, 0x6a4a10), Math.cos(a) * 0.12, 0.29, Math.sin(a) * 0.12 * 1.1);
    }
    P(skull, cyl(0.13, 0.13, 0.04, 14), METAL.gold(), 0, 0.23, 0, 0, 0, 0, 1, 1, 1.1);
    r.cape = [];
    let parent = J(r.chest, 0, 0.3, -0.14);
    for (let i = 0; i < 5; i++) {
      const seg = J(parent, 0, i ? -0.2 : 0, 0);
      P(seg, bx(0.44 + i * 0.06, 0.21, 0.02), mat(i % 2 ? 0x22102e : 0x34184a), 0, -0.1, 0);
      r.cape.push(seg); parent = seg;
    }
    for (const s of [-1, 1]) {
      const pa = J(r.chest, s * 0.24, 0.27, 0); pa.rotation.z = -s * 0.45;
      P(pa, band(0.13, 0, PI * 0.42, 16), METAL.steelD(), 0, 0, 0, 0, 0, 0, 1.15, 0.9, 1.2);
      for (let i = 0; i < 3; i++) P(pa, cone(0.02, 0.09, 4), METAL.steelD(), (i - 1) * 0.06, 0.1, 0, 0, 0, 0);
    }
    const ghost = new THREE.PointLight(0x60ff90, 3, 5, 2); ghost.position.set(0, 0.15, 0.2); skull.add(ghost);
    r.sword = makeSword({ blade: 0x8a90a8, guard: 0x3a3a44, len: 1.15, width: 0.05, gripLen: 0.24, guardW: 0.34 });
    r.sword.position.set(0, -0.06, 0); r.R.hand.add(r.sword);
    r.root.scale.setScalar(1.6);
  } else {
    if (rand() < 0.55) {   // elmo enferrujado com protetor nasal
      P(skull, lathe([[0.138, 0.12], [0.142, 0.17], [0.132, 0.23], [0.1, 0.27], [0.05, 0.29], [0, 0.296]], 14), rust, 0, 0, 0, 0, 0, 0, 1, 1, 1.12);
      P(skull, bx(0.025, 0.11, 0.02), rustD, 0, 0.15, 0.158);
    }
    if (rand() < 0.5) {    // ombreira solitária
      const sp = J(r.R.shoulder, 0.03, 0.02, 0); sp.rotation.z = -0.4;
      P(sp, band(0.11, 0, PI * 0.42, 12), rust, 0, 0, 0, 0, 0, 0, 1.1, 0.9, 1.2);
    }
    r.sword = makeSword({ blade: 0x7a5a40, guard: 0x4a3a2a, grip: 0x3a2a1a, len: 0.7 });
    r.sword.position.set(0, -0.06, 0); r.R.hand.add(r.sword);
    if (rand() < 0.6) {
      const buckler = new THREE.Group();
      P(buckler, cyl(0.19, 0.19, 0.035, 14), mat(0x4a3826));
      P(buckler, new THREE.TorusGeometry(0.19, 0.015, 5, 16), rust, 0, 0, 0, PI / 2, 0, 0);
      P(buckler, sph(0.05, 8, 6), rust, 0, 0.025, 0, 0, 0, 0, 1, 0.6, 1);
      buckler.position.set(-0.07, -0.14, 0); buckler.rotation.set(0, 0, PI / 2 - 0.3, 'ZYX');
      r.L.elbow.add(buckler);
    }
  }
  return r;
}

// ---------------------------------------------------------------- lobo

export function makeWolf() {
  const root = new THREE.Group();
  const fur = mat(0x5e5d66), furD = mat(0x37363e), furL = mat(0x8e8c96), nose = glow(0x050505), eye = glow(0xffcc30), fang = mat(0xe8e0c8);
  const body = J(root, 0, 0.62, 0);
  P(body, sph(0.25, 10, 8), fur, 0, 0.03, 0.2, 0, 0, 0, 0.95, 1.05, 1.3);
  P(body, sph(0.21, 10, 8), furD, 0, 0.02, -0.18, 0, 0, 0, 0.9, 0.92, 1.35);
  for (let i = 0; i < 8; i++) P(body, cone(0.06, 0.2, 4), furD, 0, 0.22 - i * 0.008, 0.45 - i * 0.11, -1.0, 0, 0);
  for (const s of [-1, 1]) for (let i = 0; i < 5; i++) P(body, cone(0.045, 0.16, 4), i % 2 ? furL : fur, s * 0.2, -0.12, 0.38 - i * 0.12, PI, 0, s * 0.35);
  const neck = J(body, 0, 0.1, 0.45);
  P(neck, sph(0.17, 10, 8), fur, 0, 0.03, 0.05, 0, 0, 0, 1.05, 1, 1.3);
  for (let i = 0; i < 9; i++) { const a = -1 + i * 0.25; P(neck, cone(0.05, 0.2, 4), furL, Math.sin(a) * 0.16, -0.06, 0.08 + Math.cos(a) * 0.05, PI * 0.8, 0, a); }
  const head = J(neck, 0, 0.14, 0.18);
  P(head, sph(0.13, 10, 8), fur, 0, 0, 0, 0, 0, 0, 1, 0.85, 1.1);
  P(head, cyl(0.05, 0.075, 0.2, 8), furL, 0, -0.04, 0.17, PI / 2, 0, 0);
  P(head, sph(0.03, 6, 4), nose, 0, -0.025, 0.28);
  P(head, bx(0.16, 0.025, 0.04), furD, 0, 0.06, 0.09);
  const jaw = J(head, 0, -0.07, 0.07);
  P(jaw, cyl(0.035, 0.05, 0.18, 6), furD, 0, -0.01, 0.09, PI / 2, 0, 0);
  for (const s of [-1, 1]) {
    P(jaw, cone(0.01, 0.04, 4), fang, s * 0.025, 0.02, 0.15);
    P(head, cone(0.012, 0.05, 4), fang, s * 0.032, -0.09, 0.23, PI, 0, 0);
    P(head, cone(0.05, 0.16, 4), furD, s * 0.075, 0.12, -0.02, 0, 0, -s * 0.25);
    P(head, sph(0.02, 6, 4), eye, s * 0.058, 0.03, 0.11);
  }
  const legs = [[-0.13, 0.32, true], [0.13, 0.32, true], [-0.13, -0.34, false], [0.13, -0.34, false]].map(([x, z, front]) => {
    const hip = J(body, x, -0.05, z);
    if (!front) P(hip, sph(0.09, 8, 6), fur, 0, -0.06, 0, 0, 0, 0, 0.8, 1.3, 1);
    P(hip, cyl(0.06, 0.045, 0.3, 7), front ? fur : furD, 0, -0.15, 0);
    const low = J(hip, 0, -0.3, 0);
    P(low, cyl(0.035, 0.03, 0.25, 6), furD, 0, -0.12, 0);
    P(low, bx(0.075, 0.04, 0.11), furD, 0, -0.25, 0.02);
    for (let i = 0; i < 3; i++) P(low, sph(0.02, 5, 4), furD, -0.025 + i * 0.025, -0.26, 0.075);
    return { hip, low };
  });
  const tail = [];
  let parent = J(body, 0, 0.12, -0.42);
  for (let i = 0; i < 4; i++) {
    const seg = J(parent, 0, 0, i ? -0.13 : 0);
    P(seg, cyl(0.05 + (i === 1 ? 0.02 : 0) - i * 0.008, 0.055 - i * 0.008, 0.15, 7), i === 3 ? furL : fur, 0, 0, -0.07, PI / 2, 0, 0);
    tail.push(seg); parent = seg;
  }
  return { root, body, neck, head, jaw, legs, tail };
}

// ---------------------------------------------------------------- ancião

export function makeElder() {
  const r = makeRig({ ...HUMAN, hipH: 0.86 });
  const robe = mat(0x4a3a2c), robeL = mat(0x5e4a36), skin = mat(0xd2a888), beard = mat(0xe8e8e8), rope = mat(0x2a1e14);
  P(r.hips, cyl(0.19, 0.38, 0.86, 10), robe, 0, -0.42, 0);
  P(r.hips, cyl(0.2, 0.2, 0.04, 10), rope, 0, 0.04, 0);
  P(r.hips, bx(0.03, 0.3, 0.03), rope, 0.1, -0.12, 0.18);
  P(r.spine, cyl(0.19, 0.2, 0.22, 10), robe, 0, 0.1, 0);
  P(r.chest, cyl(0.24, 0.2, 0.32, 10), robeL, 0, 0.16, 0, 0, 0, 0, 1, 1, 0.8);
  P(r.chest, cyl(0.15, 0.3, 0.18, 10), robe, 0, 0.3, 0);
  P(r.head, sph(0.12, 10, 8), skin, 0, 0.12, 0);
  P(r.head, sph(0.15, 10, 8, 0, PI * 2, 0, PI * 0.62), robe, 0, 0.13, -0.025);
  P(r.head, cone(0.1, 0.34, 6), beard, 0, -0.04, 0.09, PI + 0.25, 0, 0);
  P(r.head, bx(0.16, 0.025, 0.03), beard, 0, 0.17, 0.105);
  P(r.head, bx(0.03, 0.05, 0.04), skin, 0, 0.11, 0.125);
  for (const [A] of [[r.L], [r.R]]) {
    P(A.shoulder, cyl(0.06, 0.09, 0.3, 8), robeL, 0, -0.15, 0);
    P(A.elbow, cyl(0.09, 0.12, 0.25, 8), robeL, 0, -0.12, 0);
    P(A.hand, sph(0.045, 6, 4), skin, 0, -0.03, 0);
    P(A.foot, bx(0.08, 0.05, 0.16), rope, 0, 0, 0.05);
  }
  const staff = new THREE.Group();
  P(staff, cyl(0.025, 0.03, 1.9, 6), mat(0x4a3220), 0, 0, -0.05, PI / 2, 0, 0);
  P(staff, sph(0.07, 6, 4), mat(0x4a3220), 0, 0, 0.88);
  P(staff, new THREE.OctahedronGeometry(0.08), glow(0x80c0ff), 0, 0, 1.0);
  r.R.hand.add(staff);
  const marker = new THREE.Group();
  P(marker, bx(0.12, 0.42, 0.12), glow(0xffd040), 0, 0.3, 0);
  P(marker, bx(0.12, 0.12, 0.12), glow(0xffd040), 0, -0.05, 0);
  marker.position.y = 2.5; r.root.add(marker);
  r.marker = marker;
  return r;
}

// ---------------------------------------------------------------- poses

// Golpes: quadros-chave por canal. Canais ausentes usam a pose base.
// chY = giro do peito, spX = curva da coluna, rsx/rsz/rex = ombro e cotovelo
// direitos, lsx/lsz/lex = esquerdos (golpes com as duas mãos), sw = ângulo da
// espada na mão, drop = agachar.
export const ATTACKS = {
  overhead: { dur: 0.6, hit: 0.48, frames: [
    { t: 0.3, rsx: -2.7, rex: -1.1, chY: 0.45, spX: -0.08 },
    { t: 0.55, rsx: -0.45, rex: -0.05, chY: -0.5, spX: 0.22 }] },
  slashA: { dur: 0.42, hit: 0.42, frames: [
    { t: 0.28, chY: 0.85, spX: -0.05, rsx: -1.2, rsz: 0.9, rex: -0.9, sw: 1.2 },
    { t: 0.5, chY: -0.85, spX: 0.15, rsx: -1.45, rsz: -0.1, rex: -0.15, sw: 1.5 },
    { t: 0.75, chY: -0.6, rsx: -1.2, rsz: 0, rex: -0.3, sw: 1.2 }] },
  slashB: { dur: 0.42, hit: 0.42, frames: [
    { t: 0.28, chY: -0.8, rsx: -1.3, rsz: -0.5, rex: -1.2, sw: 1.3 },
    { t: 0.5, chY: 0.8, spX: 0.1, rsx: -1.45, rsz: 0.85, rex: -0.2, sw: 1.5 },
    { t: 0.75, chY: 0.5, rsx: -1.1, rsz: 0.6, rex: -0.35, sw: 1.2 }] },
  finisher: { dur: 0.6, hit: 0.5, frames: [
    { t: 0.35, chY: 0.25, spX: -0.22, rsx: -2.9, rsz: 0.1, rex: -0.6, sw: 1.4, lsx: -2.6, lsz: 0.5, lex: -0.8 },
    { t: 0.55, spX: 0.35, rsx: -0.9, rex: -0.1, sw: 1.55, lsx: -0.95, lsz: 0.55, lex: -0.4, drop: 0.12 },
    { t: 0.75, spX: 0.3, rsx: -0.8, rex: -0.15, sw: 1.5, lsx: -0.9, lsz: 0.5, lex: -0.4, drop: 0.1 }] },
  heavy: { dur: 0.95, hit: 0.6, frames: [
    { t: 0.45, chY: 0.5, spX: -0.3, rsx: -3.1, rsz: 0.1, rex: -0.5, sw: 1.6, lsx: -2.9, lsz: 0.55, lex: -0.6, drop: -0.05 },
    { t: 0.6, spX: 0.5, rsx: -0.7, rex: -0.1, sw: 1.6, lsx: -0.75, lsz: 0.5, lex: -0.3, drop: 0.24 },
    { t: 0.82, spX: 0.45, rsx: -0.7, rex: -0.1, sw: 1.6, lsx: -0.75, lsz: 0.5, lex: -0.3, drop: 0.2 }] },
};
function channel(t, frames, ch, base) {
  const keys = [[0, base]];
  for (const f of frames) keys.push([f.t, f[ch] ?? base]);
  keys.push([1, base]);
  return kf(t, keys);
}

// st: { phase, move (0..1), attack (-1 ou 0..1), attackType, time, jitter,
//       react (0..1, reação a golpe), reactSide (-1/1), dodge (-1 ou 0..1) }
export function poseHumanoid(r, { phase = 0, move = 0, attack = -1, attackType = 'overhead', time = 0, jitter = 0,
  react = 0, reactSide = 1, dodge = -1 }) {
  const s = Math.sin(phase), c = Math.cos(phase), m = move;
  const br = Math.sin(time * 2.2) * 0.02;
  const j = k => jitter ? Math.sin(time * 13 + k * 7.1) * jitter : 0;

  r.hips.position.y = r.p.hipH - Math.abs(s) * 0.06 * m;
  r.hips.rotation.set(0, s * 0.12 * m, 0);
  r.spine.rotation.set(0.05 * m + br * 0.5, -s * 0.08 * m, 0);
  r.chest.rotation.set(br + j(1), -s * 0.1 * m, 0);
  r.head.rotation.set(j(2), s * 0.05 * m + j(3), 0);
  for (const [A, sg] of [[r.L, 1], [r.R, -1]]) {
    const ss = s * sg, cc = c * sg;
    A.thigh.rotation.set(-ss * 0.55 * m, 0, 0);
    A.knee.rotation.set(0.08 + m * Math.max(0, cc) * 0.95, 0, 0);
    A.foot.rotation.set(-(A.thigh.rotation.x + A.knee.rotation.x) * 0.6, 0, 0);
  }

  // pose base dos braços
  const base = { chY: 0, spX: 0, rsx: -s * 0.4 * m - 0.12, rsz: 0.14, rex: -0.4, sw: 0,
    lsx: s * 0.45 * m + j(4), lsz: -0.12, lex: -0.25 - Math.max(0, -s) * 0.3 * m, drop: 0 };
  const v = { ...base };
  if (attack >= 0) {
    const frames = (ATTACKS[attackType] || ATTACKS.overhead).frames;
    for (const ch in base) v[ch] = channel(attack, frames, ch, base[ch]);
  }
  r.R.shoulder.rotation.set(v.rsx + j(5), 0, v.rsz);
  r.R.elbow.rotation.set(v.rex, 0, 0);
  r.L.shoulder.rotation.set(v.lsx, 0, v.lsz);
  r.L.elbow.rotation.set(v.lex, 0, 0);
  if (r.sword) r.sword.rotation.set(v.sw, 0, 0);
  r.chest.rotation.y += v.chY;
  r.spine.rotation.x += v.spX;
  r.hips.position.y -= v.drop;
  if (v.drop > 0) for (const A of [r.L, r.R]) { A.thigh.rotation.x -= v.drop * 2.2; A.knee.rotation.x += v.drop * 4; }
  if (r.jaw) r.jaw.rotation.x = attack >= 0 ? Math.sin(attack * PI) * 0.5 : 0.05 + Math.abs(Math.sin(time * 9)) * 0.08 * m;

  // reação ao golpe: tronco e cabeça jogados para trás, braços abrem
  if (react > 0) {
    const k = Math.sin(react * PI * 0.5);
    r.spine.rotation.x -= 0.4 * k;
    r.chest.rotation.y += 0.35 * k * reactSide;
    r.head.rotation.x -= 0.5 * k;
    r.R.shoulder.rotation.z += 0.5 * k; r.L.shoulder.rotation.z -= 0.5 * k;
    r.hips.position.y -= 0.05 * k;
    if (r.jaw) r.jaw.rotation.x = 0.6 * k;
  }

  // esquiva: cambalhota para a frente em volta do quadril
  if (dodge >= 0) {
    const k = Math.sin(dodge * PI);
    r.hips.position.y = r.p.hipH - 0.45 * k;
    r.hips.rotation.x = Math.PI * 2 * (dodge * dodge * (3 - 2 * dodge));
    r.spine.rotation.x = 0.9 * k; r.head.rotation.x = 0.6 * k;
    for (const A of [r.L, r.R]) { A.thigh.rotation.x = -1.4 * k; A.knee.rotation.x = 1.9 * k; }
    r.R.shoulder.rotation.set(-0.9 * k, 0, 0.2); r.L.shoulder.rotation.set(-0.9 * k, 0, -0.2);
    r.R.elbow.rotation.x = -1.2 * k; r.L.elbow.rotation.x = -1.2 * k;
  }
  if (r.tabard) { r.tabard[0].rotation.x = -Math.abs(s) * 0.25 * m - v.drop * 2; r.tabard[1].rotation.x = Math.abs(s) * 0.2 * m; }
}

export function animateCape(r, move, time) {
  if (!r.cape) return;
  r.cape.forEach((seg, i) => {
    seg.rotation.x = (i === 0 ? 0.18 : 0.06) + move * (0.22 + i * 0.06)
      + Math.sin(time * (3 + move * 5) - i * 0.9) * (0.03 + 0.05 * move);
  });
}

export function poseWolf(w, { phase = 0, move = 0, attack = -1, time = 0, react = 0 }) {
  const m = move;
  w.body.position.y = 0.62 + Math.sin(phase * 2) * 0.03 * m + Math.sin(time * 2.5) * 0.008;
  w.body.rotation.x = attack >= 0 ? kf(attack, [[0, 0], [0.35, 0.25], [0.6, -0.25], [1, 0]]) : Math.sin(phase * 2) * 0.04 * m;
  w.body.rotation.z = react > 0 ? Math.sin(react * 18) * 0.25 * react : 0;
  w.legs.forEach((L, i) => {
    const off = [0, PI, PI, 0][i], front = i < 2;
    L.hip.rotation.x = Math.sin(phase + off) * 0.6 * m;
    L.low.rotation.x = (front ? 1 : -0.7) * Math.max(0, Math.cos(phase + off)) * 0.8 * m;
  });
  w.neck.rotation.x = (attack >= 0 ? kf(attack, [[0, 0], [0.35, -0.25], [0.6, 0.35], [1, 0]]) : 0.1 * m + Math.sin(time * 0.7) * 0.05) - react * 0.5;
  w.head.rotation.y = Math.sin(time * 0.5) * 0.25 * (1 - m);
  w.jaw.rotation.x = attack >= 0 ? kf(attack, [[0, 0.05], [0.35, 0.65], [0.6, 0], [1, 0.05]]) : 0.05 + m * Math.abs(Math.sin(time * 8)) * 0.15 + react * 0.5;
  w.tail.forEach((t, i) => {
    t.rotation.y = Math.sin(time * (m > 0.3 ? 9 : 3) - i) * 0.25;
    t.rotation.x = (i === 0 ? -0.6 + 0.5 * m : 0.12) - react * 0.4;
  });
}

export function poseElder(r, time) {
  poseHumanoid(r, { time });
  r.spine.rotation.x += 0.12;
  r.head.rotation.x = 0.08 + Math.sin(time * 0.8) * 0.05;
  r.R.shoulder.rotation.set(-0.45, 0, 0.2);
  r.R.elbow.rotation.set(-1.05, 0, 0);
  r.marker.position.y = 2.5 + Math.sin(time * 3) * 0.12;
  r.marker.rotation.y = time * 2;
}

// Ajoelhado com a espada cravada no chão (tela de título)
export function poseKneel(r, time) {
  const br = Math.sin(time * 1.6) * 0.012;
  r.hips.position.y = 0.52;
  r.hips.rotation.set(0, 0.15, 0);
  r.spine.rotation.set(0.22 + br, -0.1, 0);
  r.chest.rotation.set(0.12 + br, -0.05, 0);
  r.head.rotation.set(0.42 + br * 2, 0.1, 0);
  r.L.thigh.rotation.set(-1.45, 0, -0.08); r.L.knee.rotation.set(1.5, 0, 0); r.L.foot.rotation.set(0.0, 0, 0);
  r.R.thigh.rotation.set(0.15, 0, 0.12); r.R.knee.rotation.set(1.55, 0, 0); r.R.foot.rotation.set(0.9, 0, 0);
  // mão direita no punho da espada, plantada à frente; esquerda apoiada no joelho
  r.R.shoulder.rotation.set(-1.0, 0, -0.12); r.R.elbow.rotation.set(-0.45, 0, 0);
  r.L.shoulder.rotation.set(-0.85, 0, -0.05); r.L.elbow.rotation.set(-0.75, 0, 0);
  // ângulo total do braço = -1.45 rad; +PI/2 aponta a lâmina para baixo
  if (r.sword) r.sword.rotation.set(PI / 2 + 1.45, 0, 0);
  if (r.tabard) { r.tabard[0].rotation.x = -1.2; r.tabard[1].rotation.x = 0.2; }
  if (r.cape) r.cape.forEach((seg, i) => { seg.rotation.x = (i === 0 ? 0.35 : 0.12) + Math.sin(time * 1.5 - i) * 0.03; });
}
