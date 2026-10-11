// Materiais, marcação de tipo para o shader ASCII e o "Batch" que junta
// geometria estática num único mesh (poucas draw calls).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rand } from './util.js';

// O canal alpha da cena diz ao shader ASCII qual conjunto de caracteres usar.
export const TAG = { WATER: 0.0, GRASS: 0.25, FOLIAGE: 0.5, CHAR: 0.75, SOLID: 1.0 };

const matCache = new Map();
export function mat(color, emissive = 0) {
  const k = color + ':' + emissive;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshLambertMaterial({ color, emissive, flatShading: true }));
  return matCache.get(k);
}
const glowCache = new Map();
export function glow(color) {
  if (!glowCache.has(color)) glowCache.set(color, new THREE.MeshBasicMaterial({ color }));
  return glowCache.get(color);
}
// material opaco que grava `tag` no alpha (NoBlending faz o three não forçar alpha = 1)
export function tagMat(tag, opts = {}) {
  return new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, blending: THREE.NoBlending, opacity: tag, ...opts });
}

// Vento: desloca vértices proporcionalmente à altura. Funciona com InstancedMesh.
export const wind = { time: { value: 0 }, pusher: { value: new THREE.Vector3(1e4, 0, 1e4) } };
export function applyWind(material, amp, push, hScale = 1) {
  material.onBeforeCompile = sh => {
    sh.uniforms.uTime = wind.time;
    sh.uniforms.uPusher = wind.pusher;
    sh.vertexShader = 'uniform float uTime; uniform vec3 uPusher;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
      vec3 transformed = vec3(position);
      #ifdef USE_INSTANCING
        vec3 wIp = instanceMatrix[3].xyz; mat3 wIm = mat3(instanceMatrix);
      #else
        vec3 wIp = vec3(0.0); mat3 wIm = mat3(1.0);
      #endif
      float hh = max(position.y, 0.0) * ${hScale.toFixed(3)};
      vec3 ww = vec3(sin(uTime * 1.7 + wIp.x * 0.31 + wIp.z * 0.17) + 0.4 * sin(uTime * 3.1 + wIp.z * 0.8),
                     0.0, 0.6 * cos(uTime * 1.3 + wIp.z * 0.27 + wIp.x * 0.1)) * ${amp.toFixed(3)};
      ${push ? `vec2 dp = wIp.xz - uPusher.xz; float dd = length(dp);
      if (dd < 1.4) ww.xz += normalize(dp + 1e-4) * (1.4 - dd) * 1.3;` : ''}
      transformed += transpose(wIm) * ww * hh * hh;`);
  };
  material.customProgramCacheKey = () => `wind-${amp}-${push}-${hScale}`;
  return material;
}

const tmpC = new THREE.Color();
// pinta a geometria com uma cor por vértice, variando o tom a cada face (visual facetado)
export function colorize(geo, color, jitter = 0.08) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count, arr = new Float32Array(n * 3);
  tmpC.set(color);
  for (let i = 0; i < n; i += 3) {
    const f = 1 + (rand() * 2 - 1) * jitter;
    for (let k = 0; k < 3 && i + k < n; k++) {
      arr[(i + k) * 3] = tmpC.r * f; arr[(i + k) * 3 + 1] = tmpC.g * f; arr[(i + k) * 3 + 2] = tmpC.b * f;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
export class Batch {
  constructor() { this.geos = []; this.frame = new THREE.Matrix4(); }
  setFrame(x, y, z, ry = 0) {
    this.frame.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(0, ry, 0)), _s.set(1, 1, 1)); return this;
  }
  resetFrame() { this.frame.identity(); return this; }
  add(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, jitter = 0.08) {
    const g = colorize(geo, color, jitter);
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(this.frame, _m));
    this.geos.push(g); return this;
  }
  box(w, h, d, color, x, y, z, rx = 0, ry = 0, rz = 0, jitter) {
    return this.add(new THREE.BoxGeometry(w, h, d), color, x, y, z, rx, ry, rz, 1, 1, 1, jitter);
  }
  cyl(rt, rb, h, seg, color, x, y, z, rx = 0, ry = 0, rz = 0) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, x, y, z, rx, ry, rz);
  }
  merged() { return this.geos.length ? mergeGeometries(this.geos) : null; }
  build(material, shadows = true) {
    const geo = this.merged(); if (!geo) return null;
    const m = new THREE.Mesh(geo, material); m.castShadow = m.receiveShadow = shadows; return m;
  }
}

// Recorte em volta do herói: fragmentos que estão NA FRENTE dele (mais perto da
// câmera) e dentro de um círculo na tela são descartados com um pontilhado,
// para que árvores e telhados não escondam o personagem.
export const cutout = {
  center: { value: new THREE.Vector2(-1e4, -1e4) }, radius: { value: 90 }, depth: { value: 0 },
};
export function applyCutout(material) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uCutC = cutout.center; sh.uniforms.uCutR = cutout.radius; sh.uniforms.uCutZ = cutout.depth;
    sh.fragmentShader = 'uniform vec2 uCutC; uniform float uCutR; uniform float uCutZ;\n' +
      sh.fragmentShader.replace('void main() {', `void main() {
        float cutD = length(gl_FragCoord.xy - uCutC) / uCutR;
        if (cutD < 1.0 && gl_FragCoord.z < uCutZ &&
            fract(sin(dot(floor(gl_FragCoord.xy / 3.0), vec2(12.9898, 78.233))) * 43758.5453) > cutD * cutD * 0.9) discard;`);
  };
  const prevKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => prevKey() + '-cut';
  return material;
}
