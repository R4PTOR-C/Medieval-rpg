// Pós-processamento: transforma a imagem 3D em caracteres.
// Cada célula da tela vira um glifo escolhido pelo brilho; o canal alpha da
// cena (ver TAG em geo.js) escolhe o conjunto de glifos: água, grama, folhagem
// ou sólido. Bordas de profundidade viram contornos | _ / \.
import * as THREE from 'three';

const SETS = [
  ' .,:-=+*ox%#&@', // 0 sólido
  ' .,-~~~~=≈≈%#@', // 1 água
  ' .,,\'\'"";;!!||', // 2 grama
  ' .,:;+**%%&&@@', // 3 folhagem
  '|_/\\',          // 4 contornos
];
const COUNT = 14;

function makeAtlas() {
  const W = 32, H = 48, c = document.createElement('canvas');
  c.width = W * COUNT; c.height = H * SETS.length;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff'; g.font = 'bold 40px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  SETS.forEach((set, row) => [...set].forEach((ch, i) => g.fillText(ch, i * W + W / 2, row * H + H / 2 + 2)));
  const t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  return t;
}

export function createAscii(sceneRT, near, far) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: sceneRT.texture }, tDepth: { value: sceneRT.depthTexture }, tGlyphs: { value: makeAtlas() },
      resolution: { value: new THREE.Vector2(innerWidth, innerHeight) },
      cell: { value: 7 }, count: { value: COUNT }, rows: { value: SETS.length },
      asciiOn: { value: 0 }, near: { value: near }, far: { value: far }, exposure: { value: 1.7 },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tScene; uniform sampler2D tDepth; uniform sampler2D tGlyphs;
      uniform vec2 resolution; uniform float cell; uniform float count; uniform float rows;
      uniform float asciiOn; uniform float near; uniform float far; uniform float exposure;
      varying vec2 vUv;

      vec3 samp(vec2 uv) { return texture2D(tScene, uv).rgb; }
      float depth(vec2 uv) { float d = texture2D(tDepth, uv).r; return near * far / (far - d * (far - near)); }
      float glyph(float idx, float row, vec2 local) {
        return texture2D(tGlyphs, vec2((idx + local.x) / count, (rows - 1.0 - row + local.y) / rows)).r;
      }
      float h21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

      void main() {
        vec3 gam = vec3(1.0 / 2.2);
        if (asciiOn < 0.5) { gl_FragColor = vec4(pow(samp(vUv), gam), 1.0); return; }

        vec2 cs = vec2(cell, floor(cell * 1.5));
        vec2 px = vUv * resolution;
        vec2 id = floor(px / cs);
        vec2 uc = (id + 0.5) * cs / resolution;
        vec2 q = cs * 0.25 / resolution;
        vec3 col = (samp(uc) * 2.0 + samp(uc + q) + samp(uc - q)
                  + samp(uc + vec2(q.x, -q.y)) + samp(uc + vec2(-q.x, q.y))) / 6.0;
        float tag = texture2D(tScene, uc).a;
        float row = tag < 0.125 ? 1.0 : tag < 0.375 ? 2.0 : tag < 0.625 ? 3.0 : 0.0;
        bool isChar = tag > 0.625 && tag < 0.875;

        col = pow(max(col * exposure, 0.0), gam);
        float l = clamp(dot(col, vec3(0.299, 0.587, 0.114)) * 1.05, 0.0, 1.0);
        if (row == 2.0) l = clamp(l * 1.5 + 0.1, 0.0, 1.0);   // capim sempre visível
        if (isChar) l = clamp(l * 1.5 + 0.18, 0.0, 1.0);      // personagens se destacam
        float gi = min(floor(l * count), count - 1.0);
        vec2 local = fract(px / cs);
        float mx = max(max(col.r, col.g), col.b);
        vec3 tint = col / max(mx, 1e-4) * mix(0.4, 1.0, l);

        // contornos (não em água nem grama)
        vec2 ox = vec2(cs.x / resolution.x, 0.0), oy = vec2(0.0, cs.y / resolution.y);
        float nt = min(min(texture2D(tScene, uc - ox).a, texture2D(tScene, uc + ox).a),
                       min(texture2D(tScene, uc - oy).a, texture2D(tScene, uc + oy).a));
        bool nearPlant = (nt > 0.125 && nt < 0.625) || (row > 1.5 && row < 3.5);
        if (row < 0.5 && (!nearPlant || isChar)) {
          float zc = depth(uc), zl = depth(uc - ox), zr = depth(uc + ox), zd = depth(uc - oy), zu = depth(uc + oy);
          float lap = abs(zl + zr + zd + zu - 4.0 * zc) / zc;
          if (lap > (isChar ? 0.03 : 0.08) && zc < 120.0) {
            vec2 gr = vec2(zr - zl, zu - zd);
            float a = abs(atan(gr.y, gr.x));
            float e = (a < 0.39 || a > 2.75) ? 0.0 : (a > 1.18 && a < 1.96) ? 1.0
                    : ((gr.x > 0.0) == (gr.y > 0.0)) ? 3.0 : 2.0;
            vec3 ec = isChar ? max(tint, vec3(0.75, 0.72, 0.65)) : max(tint, vec3(0.10, 0.11, 0.16)) * 1.15;
            gl_FragColor = vec4(ec * glyph(e, 4.0, local), 1.0);
            return;
          }
        }

        float m;
        if (row == 2.0 && gi >= 9.0) {
          // folhas de grama mais claras: | / \\ escolhidos por célula
          float h = h21(id);
          m = glyph(h < 0.5 ? 0.0 : h < 0.75 ? 2.0 : 3.0, 4.0, local);
        } else {
          m = glyph(gi, row, local);
        }
        gl_FragColor = vec4(tint * m + col * 0.05, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return {
    material, scene, camera,
    setSize(w, h) { material.uniforms.resolution.value.set(w, h); },
  };
}
