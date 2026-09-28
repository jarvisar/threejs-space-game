import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Dual filter bloom: soft threshold, 13 tap downsample chain, tent upsample
// accumulated back up the chain. mips[0] ends up holding the bloom.

const vert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const downFrag = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uPrefilter;
varying vec2 vUv;
vec3 s(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
void main() {
  vec3 a = s(vec2(-2.0, 2.0)), b = s(vec2(0.0, 2.0)), c = s(vec2(2.0, 2.0));
  vec3 d = s(vec2(-2.0, 0.0)), e = s(vec2(0.0, 0.0)), f = s(vec2(2.0, 0.0));
  vec3 g = s(vec2(-2.0, -2.0)), h = s(vec2(0.0, -2.0)), i = s(vec2(2.0, -2.0));
  vec3 j = s(vec2(-1.0, 1.0)), k = s(vec2(1.0, 1.0)), l = s(vec2(-1.0, -1.0)), m = s(vec2(1.0, -1.0));
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  if (uPrefilter > 0.5) {
    col = min(col, vec3(60.0));
    float br = max(col.r, max(col.g, col.b));
    float knee = uThreshold * 0.5;
    float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
    col *= contrib;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

const upFrag = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uScatter;
varying vec2 vUv;
vec3 s(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
void main() {
  vec3 col = s(vec2(0.0)) * 4.0;
  col += (s(vec2(-1.0, 0.0)) + s(vec2(1.0, 0.0)) + s(vec2(0.0, -1.0)) + s(vec2(0.0, 1.0))) * 2.0;
  col += s(vec2(-1.0, -1.0)) + s(vec2(1.0, -1.0)) + s(vec2(-1.0, 1.0)) + s(vec2(1.0, 1.0));
  gl_FragColor = vec4(col / 16.0 * uScatter, 1.0);
}
`;

export class Bloom {
  constructor(levels = 6) {
    this.levels = levels;
    this.mips = [];
    this.threshold = 1.0;
    this.scatter = 0.85;
    this.downMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1 }, uPrefilter: { value: 0 } },
      vertexShader: vert,
      fragmentShader: downFrag,
      depthTest: false,
      depthWrite: false,
    });
    this.upMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uScatter: { value: 1 } },
      vertexShader: vert,
      fragmentShader: upFrag,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      transparent: true,
    });
    this.quad = new FullScreenQuad(this.downMat);
  }

  setSize(w, h) {
    for (const m of this.mips) m.dispose();
    this.mips = [];
    let mw = w, mh = h;
    for (let i = 0; i < this.levels; i++) {
      mw = Math.max(1, Math.floor(mw / 2));
      mh = Math.max(1, Math.floor(mh / 2));
      const rt = new THREE.WebGLRenderTarget(mw, mh, {
        type: THREE.HalfFloatType,
        depthBuffer: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      });
      rt.texture.generateMipmaps = false;
      this.mips.push(rt);
    }
  }

  render(renderer, srcTexture, srcW, srcH) {
    const q = this.quad;
    q.material = this.downMat;
    let src = srcTexture;
    let sw = srcW, sh = srcH;
    for (let i = 0; i < this.levels; i++) {
      this.downMat.uniforms.tSrc.value = src;
      this.downMat.uniforms.uTexel.value.set(1 / sw, 1 / sh);
      this.downMat.uniforms.uThreshold.value = this.threshold;
      this.downMat.uniforms.uPrefilter.value = i === 0 ? 1 : 0;
      renderer.setRenderTarget(this.mips[i]);
      q.render(renderer);
      src = this.mips[i].texture;
      sw = this.mips[i].width;
      sh = this.mips[i].height;
    }
    q.material = this.upMat;
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    for (let i = this.levels - 1; i > 0; i--) {
      this.upMat.uniforms.tSrc.value = this.mips[i].texture;
      this.upMat.uniforms.uTexel.value.set(1 / this.mips[i].width, 1 / this.mips[i].height);
      this.upMat.uniforms.uScatter.value = this.scatter;
      renderer.setRenderTarget(this.mips[i - 1]);
      q.render(renderer);
    }
    renderer.autoClear = prevAuto;
    return this.mips[0].texture;
  }

  dispose() {
    for (const m of this.mips) m.dispose();
    this.downMat.dispose();
    this.upMat.dispose();
  }
}
