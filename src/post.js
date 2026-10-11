// Bloom: extrai as partes mais claras da cena, desfoca em baixa resolução e
// devolve uma textura que o passe final soma por cima (o "brilho que vaza").
import * as THREE from 'three';

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export function createBloom(width, height) {
  const opts = { type: THREE.HalfFloatType, depthBuffer: false };
  const a = new THREE.WebGLRenderTarget(1, 1, opts), b = new THREE.WebGLRenderTarget(1, 1, opts);
  const extract = new THREE.ShaderMaterial({
    uniforms: { t: { value: null }, threshold: { value: 0.7 } },
    vertexShader: VERT,
    fragmentShader: `
      uniform sampler2D t; uniform float threshold; varying vec2 vUv;
      void main(){
        vec3 c = texture2D(t, vUv).rgb;
        float m = max(max(c.r, c.g), c.b);
        gl_FragColor = vec4(c * smoothstep(threshold, threshold + 0.5, m), 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const blur = new THREE.ShaderMaterial({
    uniforms: { t: { value: null }, dir: { value: new THREE.Vector2() } },
    vertexShader: VERT,
    fragmentShader: `
      uniform sampler2D t; uniform vec2 dir; varying vec2 vUv;
      void main(){
        vec3 s = texture2D(t, vUv).rgb * 0.227;
        s += (texture2D(t, vUv + dir * 1.385).rgb + texture2D(t, vUv - dir * 1.385).rgb) * 0.316;
        s += (texture2D(t, vUv + dir * 3.231).rgb + texture2D(t, vUv - dir * 3.231).rgb) * 0.070;
        gl_FragColor = vec4(s, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), extract);
  const scene = new THREE.Scene(); scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const pass = (renderer, material, target) => { quad.material = material; renderer.setRenderTarget(target); renderer.render(scene, cam); };
  const api = {
    texture: a.texture,
    setSize(w, h) { const W = Math.max(1, w >> 2), H = Math.max(1, h >> 2); a.setSize(W, H); b.setSize(W, H); api.texel = [1 / W, 1 / H]; },
    render(renderer, source) {
      extract.uniforms.t.value = source; pass(renderer, extract, a);
      for (let i = 0; i < 2; i++) {
        const k = 1 + i * 1.5;
        blur.uniforms.t.value = a.texture; blur.uniforms.dir.value.set(api.texel[0] * k, 0); pass(renderer, blur, b);
        blur.uniforms.t.value = b.texture; blur.uniforms.dir.value.set(0, api.texel[1] * k); pass(renderer, blur, a);
      }
      renderer.setRenderTarget(null);
    },
  };
  api.setSize(width, height);
  return api;
}
