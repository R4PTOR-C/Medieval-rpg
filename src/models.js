// Personagens: um "rig" de juntas (quadril, coluna, peito, pescoço, cabeça,
// ombros, cotovelos, mãos, coxas, joelhos, pés) vestido com peças low-poly,
// e as funções de pose que animam caminhada, respiração e ataques.
import * as THREE from 'three';
import { glow, tagMat, TAG } from './geo.js';

// materiais dos personagens levam a marca CHAR: o shader ASCII os realça
const matCache = new Map();
function mat(color, emissive = 0) {
  const k = color + ':' + emissive;
  // emissive = a própria cor, fraca: o personagem nunca fica totalmente preto
  if (!matCache.has(k)) matCache.set(k, tagMat(TAG.CHAR, { color, emissive: emissive || color, emissiveIntensity: emissive ? 1 : 0.28 }));
  return matCache.get(k);
}
import { kf } from './util.js';

const PI = Math.PI;
const bx = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 8, open = false) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open);
const sph = (r, ws = 8, hs = 6, ...rest) => new THREE.SphereGeometry(r, ws, hs, ...rest);
const cone = (r, h, s = 6) => new THREE.ConeGeometry(r, h, s);
const dome = (r, s = 10) => new THREE.SphereGeometry(r, s, 5, 0, PI * 2, 0, PI / 2);

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

function makeSword({ blade = 0xdfe6f2, guard = 0xc9a043, grip = 0x4a2e1a, len = 0.85, width = 0.035 } = {}) {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(-width, 0); s.lineTo(width, 0); s.lineTo(width * 0.8, len * 0.85); s.lineTo(0, len);
  s.lineTo(-width * 0.8, len * 0.85); s.closePath();
  const bg = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 });
  bg.translate(0, 0, -0.006);
  const bladeM = tagMat(TAG.CHAR, { color: blade, emissive: 0x2a3040 });
  P(g, bg, bladeM, 0, 0, 0.1, PI / 2, 0, 0);
  P(g, bx(0.012, 0.03, len * 0.6), mat(0x7a8090), 0, 0, 0.1 + len * 0.35);          // sulco
  P(g, bx(0.26, 0.035, 0.035), mat(guard), 0, 0, 0.09);                              // guarda
  for (const sx of [-1, 1]) P(g, sph(0.022, 6, 4), mat(guard), sx * 0.13, 0, 0.09);
  P(g, cyl(0.018, 0.018, 0.16, 6), mat(grip), 0, 0, 0, PI / 2, 0, 0);                 // empunhadura
  P(g, sph(0.03, 8, 6), mat(guard), 0, 0, -0.09);                                    // pomo
  return g;
}

function makeKiteShield(field = 0x23407a, trim = 0xc9a043) {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(-0.24, 0.22); s.lineTo(0.24, 0.22);
  s.quadraticCurveTo(0.27, -0.2, 0, -0.52); s.quadraticCurveTo(-0.27, -0.2, -0.24, 0.22);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.018, bevelSegments: 1 });
  P(g, geo, mat(field));
  P(g, bx(0.055, 0.6, 0.012), mat(trim), 0, -0.13, 0.058);
  P(g, bx(0.34, 0.055, 0.012), mat(trim), 0, 0.04, 0.058);
  P(g, sph(0.05, 8, 6), mat(trim), 0, 0.04, 0.06, 0, 0, 0, 1, 1, 0.5);
  return g;
}

// ---------------------------------------------------------------- cavaleiro

export function makeKnight() {
  const r = makeRig(HUMAN);
  const steel = mat(0xb4bccb), steelD = mat(0x6f7686), mail = mat(0x55595f), gold = mat(0xc9a043);
  const red = mat(0x8e1c1c), redD = mat(0x6a1414), leather = mat(0x5a3a22), dark = glow(0x050507);

  // quadril: cota de malha, cinto, bolsa, escarcelas
  P(r.hips, cyl(0.19, 0.2, 0.16, 10), mail);
  P(r.hips, cyl(0.205, 0.205, 0.06, 12), leather, 0, 0.07, 0);
  P(r.hips, bx(0.07, 0.06, 0.02), gold, 0, 0.07, 0.205);
  P(r.hips, bx(0.1, 0.1, 0.06), leather, 0.17, 0, 0.1, 0, 0.6, 0);
  for (const s of [-1, 1]) P(r.hips, bx(0.12, 0.17, 0.22), steelD, s * 0.2, -0.06, 0, 0, 0, s * 0.25);
  // tabardo (frente e costas), com cruz dourada
  const tabF = J(r.hips, 0, 0.04, 0.19), tabB = J(r.hips, 0, 0.04, -0.19);
  P(tabF, bx(0.24, 0.44, 0.02), red, 0, -0.22, 0);
  P(tabF, bx(0.25, 0.03, 0.025), gold, 0, -0.43, 0);
  P(tabF, bx(0.04, 0.2, 0.025), gold, 0, -0.17, 0.004);
  P(tabF, bx(0.13, 0.04, 0.025), gold, 0, -0.13, 0.004);
  P(tabB, bx(0.26, 0.46, 0.02), redD, 0, -0.23, 0);
  r.tabard = [tabF, tabB];

  // tronco: faixa abdominal e peitoral com quilha
  P(r.spine, cyl(0.2, 0.19, 0.2, 10), steel, 0, 0.1, 0, 0, 0, 0, 1.08, 1, 0.8);
  P(r.chest, cyl(0.25, 0.2, 0.34, 12), steel, 0, 0.16, 0, 0, 0, 0, 1, 1, 0.72);
  P(r.chest, bx(0.035, 0.3, 0.04), steel, 0, 0.16, 0.162, -0.12, 0, 0);
  P(r.chest, bx(0.4, 0.03, 0.3), gold, 0, 0.01, 0, 0, 0, 0, 1, 1, 0.9);
  P(r.chest, cyl(0.12, 0.15, 0.08, 10), steelD, 0, 0.34, 0);                        // gorjal

  // capa em segmentos (animada em animateCape)
  r.cape = [];
  let parent = J(r.chest, 0, 0.3, -0.17);
  for (let i = 0; i < 4; i++) {
    const seg = J(parent, 0, i ? -0.21 : 0, 0);
    P(seg, bx(0.42 + i * 0.05, 0.22, 0.025), i % 2 ? redD : red, 0, -0.105, 0);
    r.cape.push(seg); parent = seg;
  }

  // elmo: cilindro + cúpula, viseira, respiros, faixa dourada e penacho
  P(r.neck, cyl(0.07, 0.08, 0.1, 8), mail, 0, 0.04, 0);
  P(r.head, cyl(0.135, 0.14, 0.27, 12), steel, 0, 0.14, 0);
  P(r.head, dome(0.137, 12), steel, 0, 0.275, 0, 0, 0, 0, 1, 0.55, 1);
  P(r.head, bx(0.22, 0.03, 0.03), dark, 0, 0.17, 0.128);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) P(r.head, bx(0.014, 0.045, 0.03), dark, s * (0.035 + i * 0.026), 0.08, 0.126);
  P(r.head, cyl(0.143, 0.143, 0.03, 12), gold, 0, 0.235, 0);
  P(r.head, bx(0.03, 0.2, 0.012), gold, 0, 0.12, 0.142);
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    P(r.head, bx(0.05, 0.08, 0.09), i % 2 ? redD : red, 0, 0.36 + Math.sin(t * PI) * 0.07 - t * 0.12, 0.04 - t * 0.27, -t * 1.1, 0, 0);
  }

  // braços
  for (const [A, s] of [[r.L, -1], [r.R, 1]]) {
    P(A.shoulder, dome(0.145), steel, s * 0.03, 0.03, 0, 0, 0, -s * 0.35, 1.1, 0.95, 1.2);
    P(A.shoulder, dome(0.13), steelD, s * 0.05, -0.05, 0, 0, 0, -s * 0.5, 1.05, 0.7, 1.1);
    P(A.shoulder, cyl(0.062, 0.056, 0.27, 8), mail, 0, -0.14, 0);
    P(A.shoulder, cyl(0.068, 0.064, 0.13, 8), steel, 0, -0.2, 0);
    P(A.elbow, sph(0.07, 8, 6), steel);
    P(A.elbow, bx(0.025, 0.09, 0.09), steelD, s * 0.06, 0, -0.02);
    P(A.elbow, cyl(0.064, 0.054, 0.24, 8), steel, 0, -0.13, 0);
    P(A.hand, cyl(0.062, 0.075, 0.06, 8), steel, 0, 0.02, 0);
    P(A.hand, bx(0.085, 0.11, 0.1), steelD, 0, -0.05, 0.01);
  }
  // pernas
  for (const [A] of [[r.L], [r.R]]) {
    P(A.thigh, cyl(0.088, 0.072, 0.42, 8), steel, 0, -0.21, 0);
    P(A.knee, sph(0.074, 8, 6), steel, 0, 0, 0.015);
    P(A.knee, bx(0.1, 0.06, 0.03), steelD, 0, 0.01, 0.065);
    P(A.knee, cyl(0.068, 0.054, 0.4, 8), steel, 0, -0.2, 0);
    P(A.foot, bx(0.1, 0.07, 0.24), steelD, 0, 0, 0.045);
    P(A.foot, bx(0.075, 0.05, 0.08), steel, 0, -0.005, 0.19);
  }

  // espada na mão direita, escudo no antebraço esquerdo
  const sword = makeSword(); sword.position.set(0, -0.06, 0); r.R.hand.add(sword);
  const shield = makeKiteShield();
  shield.position.set(-0.085, -0.15, 0);
  shield.rotation.set(PI / 2, 0, -PI / 2 + 0.35, 'ZYX');
  r.L.elbow.add(shield);

  // lanterna na cintura + luz que acompanha o herói
  const lant = J(r.hips, -0.22, -0.02, 0.06);
  P(lant, bx(0.09, 0.02, 0.09), mat(0x2a2a2a), 0, 0.02, 0);
  P(lant, bx(0.06, 0.09, 0.06), glow(0xffd080), 0, -0.04, 0);
  P(lant, bx(0.09, 0.02, 0.09), mat(0x2a2a2a), 0, -0.1, 0);
  const light = new THREE.PointLight(0xffc890, 14, 16, 2); light.position.set(0.2, 1.7, 0.9);
  r.root.add(light);
  return r;
}

// ---------------------------------------------------------------- esqueleto

export function makeSkeleton(lord = false) {
  const r = makeRig({ ...HUMAN, hipH: 0.88, shoulderW: 0.22 });
  const bone = mat(lord ? 0xcfc6a0 : 0xdcd6c0), boneD = mat(lord ? 0xa89e80 : 0xb4ac94);
  const eye = glow(lord ? 0xff2a10 : 0xff4a30), rag = mat(0x3a3428);

  // bacia, vértebras, costelas, esterno, clavículas
  P(r.hips, bx(0.28, 0.08, 0.12), bone);
  for (const s of [-1, 1]) P(r.hips, sph(0.08, 6, 4), boneD, s * 0.1, 0.03, 0, 0, 0, 0, 1, 0.7, 0.5);
  for (let i = 0; i < 4; i++) P(r.spine, bx(0.05, 0.035, 0.05), bone, 0, 0.02 + i * 0.05, -0.03);
  for (let i = 0; i < 5; i++) {
    P(r.chest, new THREE.TorusGeometry(0.15 - i * 0.012, 0.014, 4, 10, PI * 1.6), bone,
      0, 0.05 + i * 0.058, -0.01, PI / 2, 0, 0.7 * PI, 1, 0.8, 1);
  }
  P(r.chest, bx(0.04, 0.22, 0.03), bone, 0, 0.15, 0.13);
  P(r.chest, bx(0.05, 0.3, 0.05), boneD, 0, 0.14, -0.13);
  for (const s of [-1, 1]) P(r.chest, bx(0.2, 0.025, 0.025), bone, s * 0.1, 0.29, 0.04, 0, s * 0.3, 0);

  // crânio: caixa, mandíbula, órbitas com brilho
  P(r.neck, cyl(0.025, 0.025, 0.1, 6), bone, 0, 0.04, 0);
  P(r.head, sph(0.13, 10, 8), bone, 0, 0.13, 0, 0, 0, 0, 0.95, 1, 1.08);
  P(r.head, bx(0.15, 0.06, 0.13), boneD, 0, 0.02, 0.05);
  for (const s of [-1, 1]) P(r.head, sph(0.032, 6, 4), eye, s * 0.047, 0.14, 0.11);
  P(r.head, bx(0.03, 0.04, 0.02), glow(0x100808), 0, 0.08, 0.135);
  for (let i = 0; i < 5; i++) P(r.head, bx(0.016, 0.03, 0.01), bone, -0.04 + i * 0.02, 0.05, 0.123);

  for (const [A, s] of [[r.L, -1], [r.R, 1]]) {
    P(A.shoulder, sph(0.035, 6, 4), boneD);
    P(A.shoulder, cyl(0.022, 0.018, 0.27, 6), bone, 0, -0.14, 0);
    P(A.elbow, sph(0.03, 6, 4), boneD);
    for (const o of [-1, 1]) P(A.elbow, cyl(0.012, 0.012, 0.25, 5), bone, o * 0.014, -0.13, 0);
    P(A.hand, bx(0.06, 0.08, 0.03), boneD, 0, -0.04, 0);
    P(A.thigh, sph(0.04, 6, 4), boneD);
    P(A.thigh, cyl(0.026, 0.02, 0.42, 6), bone, 0, -0.21, 0);
    P(A.knee, sph(0.036, 6, 4), boneD);
    for (const o of [-1, 1]) P(A.knee, cyl(0.014, 0.012, 0.4, 5), bone, o * 0.016, -0.2, 0);
    P(A.foot, bx(0.07, 0.03, 0.16), boneD, 0, 0, 0.04);
  }
  // trapos
  P(r.hips, bx(0.22, 0.24, 0.02), rag, 0, -0.12, 0.08, 0.1, 0, 0);
  P(r.hips, bx(0.2, 0.2, 0.02), rag, 0, -0.1, -0.08, -0.1, 0, 0);

  if (lord) {
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * PI * 2;
      P(r.head, bx(0.035, 0.1, 0.035), glow(0xffd040), Math.cos(a) * 0.12, 0.27, Math.sin(a) * 0.12);
    }
    P(r.head, cyl(0.13, 0.13, 0.04, 10), mat(0xc9a043), 0, 0.23, 0);
    r.cape = [];
    let parent = J(r.chest, 0, 0.3, -0.14);
    for (let i = 0; i < 4; i++) {
      const seg = J(parent, 0, i ? -0.21 : 0, 0);
      P(seg, bx(0.42 + i * 0.06, 0.22, 0.025), mat(i % 2 ? 0x2e1640 : 0x40205a), 0, -0.105, 0);
      r.cape.push(seg); parent = seg;
    }
    for (const s of [-1, 1]) P(r.L.shoulder.parent, dome(0.12), mat(0x3a3a44), s * 0.24, 0.27, 0, 0, 0, -s * 0.4);
    const gs = makeSword({ blade: 0x9aa0b8, guard: 0x3a3a44, len: 1.15, width: 0.05 });
    gs.position.set(0, -0.06, 0); r.R.hand.add(gs);
    r.root.scale.setScalar(1.6);
  } else {
    const sw = makeSword({ blade: 0x8a6a4a, guard: 0x5a4a3a, grip: 0x3a2a1a, len: 0.7 });
    sw.position.set(0, -0.06, 0); r.R.hand.add(sw);
    const buckler = new THREE.Group();
    P(buckler, cyl(0.19, 0.19, 0.04, 10), mat(0x4a3a2a));
    P(buckler, cyl(0.2, 0.2, 0.02, 10), mat(0x5a4a3a), 0, 0.02, 0);
    P(buckler, sph(0.05, 6, 4), mat(0x6a6050), 0, 0.03, 0);
    buckler.position.set(-0.07, -0.14, 0); buckler.rotation.set(0, 0, PI / 2 - 0.3, 'ZYX');
    r.L.elbow.add(buckler);
  }
  return r;
}

// ---------------------------------------------------------------- lobo

export function makeWolf() {
  const root = new THREE.Group();
  const fur = mat(0x6b6a70), furD = mat(0x45444a), furL = mat(0x8e8c94), nose = glow(0x0a0a0a), eye = glow(0xffd040);
  const body = J(root, 0, 0.62, 0);
  P(body, sph(0.24, 8, 6), fur, 0, 0.02, 0.22, 0, 0, 0, 0.95, 1, 1.25);
  P(body, sph(0.2, 8, 6), furD, 0, 0.01, -0.16, 0, 0, 0, 0.9, 0.9, 1.4);
  for (let i = 0; i < 6; i++) P(body, cone(0.05, 0.15, 4), furD, 0, 0.2 - i * 0.008, 0.38 - i * 0.13, -0.9, 0, 0);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) P(body, cone(0.04, 0.12, 4), furL, s * 0.2, -0.1, 0.3 - i * 0.12, PI, 0, s * 0.3);

  const neck = J(body, 0, 0.1, 0.45);
  P(neck, sph(0.16, 8, 6), fur, 0, 0.04, 0.04, 0, 0, 0, 1.05, 1, 1.3);
  for (let i = 0; i < 5; i++) { const a = -0.8 + i * 0.4; P(neck, cone(0.05, 0.16, 4), furL, Math.sin(a) * 0.15, -0.05, 0.08 + Math.cos(a) * 0.04, PI * 0.8, 0, a); }
  const head = J(neck, 0, 0.13, 0.17);
  P(head, bx(0.22, 0.18, 0.22), fur, 0, 0, 0.02);
  P(head, bx(0.13, 0.1, 0.2), furL, 0, -0.04, 0.19);
  P(head, bx(0.05, 0.04, 0.04), nose, 0, -0.01, 0.3);
  const jaw = J(head, 0, -0.08, 0.1);
  P(jaw, bx(0.1, 0.04, 0.17), furD, 0, -0.01, 0.07);
  for (const s of [-1, 1]) {
    P(head, cone(0.05, 0.14, 4), furD, s * 0.08, 0.14, -0.02, 0, 0, -s * 0.2);
    P(head, bx(0.045, 0.03, 0.02), eye, s * 0.065, 0.03, 0.13);
  }
  const legs = [[-0.13, 0.32], [0.13, 0.32], [-0.13, -0.34], [0.13, -0.34]].map(([x, z], i) => {
    const hip = J(body, x, -0.06, z);
    P(hip, cyl(0.055, 0.04, 0.3, 6), i < 2 ? fur : furD, 0, -0.15, 0);
    const low = J(hip, 0, -0.3, 0);
    P(low, cyl(0.035, 0.03, 0.24, 6), furD, 0, -0.12, 0);
    P(low, bx(0.07, 0.04, 0.1), furD, 0, -0.25, 0.02);
    return { hip, low };
  });
  const tail = [];
  let parent = J(body, 0, 0.12, -0.42);
  for (let i = 0; i < 3; i++) {
    const seg = J(parent, 0, 0, i ? -0.15 : 0);
    P(seg, cyl(0.05 - i * 0.008, 0.06 - i * 0.012, 0.17, 6), i === 2 ? furL : fur, 0, 0, -0.08, PI / 2, 0, 0);
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

// st: { phase, move (0..1), attack (-1 ou 0..1), time, shield, jitter }
export function poseHumanoid(r, { phase = 0, move = 0, attack = -1, time = 0, shield = false, jitter = 0 }) {
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
  if (shield) {
    r.L.shoulder.rotation.set(-0.35 + s * 0.08 * m, 0, -0.18);
    r.L.elbow.rotation.set(-1.2, 0, 0);
  } else {
    r.L.shoulder.rotation.set(s * 0.45 * m + j(4), 0, -0.12);
    r.L.elbow.rotation.set(-0.25 - Math.max(0, -s) * 0.3 * m, 0, 0);
  }
  let sx = -s * 0.4 * m - 0.12, ex = -0.4, chY = 0, spX = 0;
  if (attack >= 0) {
    sx = kf(attack, [[0, sx], [0.3, -2.7], [0.55, -0.45], [1, sx]]);
    ex = kf(attack, [[0, ex], [0.3, -1.1], [0.55, -0.05], [1, ex]]);
    chY = kf(attack, [[0, 0], [0.3, 0.45], [0.55, -0.5], [1, 0]]);
    spX = kf(attack, [[0, 0], [0.3, -0.08], [0.55, 0.22], [1, 0]]);
  }
  r.R.shoulder.rotation.set(sx + j(5), 0, 0.14);
  r.R.elbow.rotation.set(ex, 0, 0);
  r.chest.rotation.y += chY;
  r.spine.rotation.x += spX;
  if (r.tabard) { r.tabard[0].rotation.x = -Math.abs(s) * 0.25 * m; r.tabard[1].rotation.x = Math.abs(s) * 0.2 * m; }
}

export function animateCape(r, move, time) {
  if (!r.cape) return;
  r.cape.forEach((seg, i) => {
    seg.rotation.x = (i === 0 ? 0.18 : 0.06) + move * (0.22 + i * 0.06)
      + Math.sin(time * (3 + move * 5) - i * 0.9) * (0.03 + 0.05 * move);
  });
}

export function poseWolf(w, { phase = 0, move = 0, attack = -1, time = 0 }) {
  const m = move;
  w.body.position.y = 0.62 + Math.sin(phase * 2) * 0.03 * m + Math.sin(time * 2.5) * 0.008;
  w.body.rotation.x = attack >= 0 ? kf(attack, [[0, 0], [0.35, 0.25], [0.6, -0.25], [1, 0]]) : Math.sin(phase * 2) * 0.04 * m;
  w.legs.forEach((L, i) => {
    const off = [0, PI, PI, 0][i], front = i < 2;
    L.hip.rotation.x = Math.sin(phase + off) * 0.6 * m;
    L.low.rotation.x = (front ? 1 : -0.7) * Math.max(0, Math.cos(phase + off)) * 0.8 * m;
  });
  w.neck.rotation.x = attack >= 0 ? kf(attack, [[0, 0], [0.35, -0.25], [0.6, 0.35], [1, 0]]) : 0.1 * m + Math.sin(time * 0.7) * 0.05;
  w.head.rotation.y = Math.sin(time * 0.5) * 0.25 * (1 - m);
  w.jaw.rotation.x = attack >= 0 ? kf(attack, [[0, 0.05], [0.35, 0.65], [0.6, 0], [1, 0.05]]) : 0.05 + m * Math.abs(Math.sin(time * 8)) * 0.15;
  w.tail.forEach((t, i) => {
    t.rotation.y = Math.sin(time * (m > 0.3 ? 9 : 3) - i) * 0.25;
    t.rotation.x = i === 0 ? -0.6 + 0.5 * m : 0.12;
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
