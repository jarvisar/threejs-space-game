import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Cheap depth of field, the same idea as three's dof_basic example: blur a
// copy of the frame and mix it back in by how far each pixel is from the
// focus distance. A few differences so it holds up here:
// - the blur runs at half resolution and every pixel is weighted by its own
//   blur amount, so sharp foreground doesn't smear halos over the background
// - distance from focus is relative (|d - f| / f), scenes go from 1 m to
//   thousands of km
// - autofocus reads the depth under the crosshair on the GPU and eases toward
//   it in a 1x1 target, so nothing is read back to the CPU
// - the sky never blurs, otherwise stars would smear out at night

const vert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// shared by every pass that needs a pixel's blur amount
export const DOF_GLSL = /* glsl */ `
uniform float uLogFar;
uniform vec3 uDofRange;
float dofDist(float d) {
  return d >= 0.99999 ? -1.0 : exp2(d * uLogFar) - 1.0;
}
// uDofRange: x, y = relative distance where blur starts and is full, z = near blur amount
float dofCoc(float dist, float focus) {
  if (dist < 0.0) return 0.0;
  float rel = (dist - focus) / max(focus, 0.01);
  float far = smoothstep(uDofRange.x, uDofRange.y, rel);
  float near = smoothstep(uDofRange.x, uDofRange.y, -rel * 3.0) * uDofRange.z;
  return max(far, near);
}
`;

const focusFrag = /* glsl */ `
uniform sampler2D tDepth;
uniform sampler2D tPrev;
uniform float uLogFar;
uniform float uManual;
uniform float uK;
varying vec2 vUv;
float dist(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  // the sky counts as far away, but not infinitely
  return d >= 0.99999 ? 1e5 : exp2(d * uLogFar) - 1.0;
}
void main() {
  // a small cross of taps so a single blade of grass doesn't grab focus
  float c = dist(vec2(0.5));
  float s = min(min(dist(vec2(0.49, 0.5)), dist(vec2(0.51, 0.5))), min(dist(vec2(0.5, 0.485)), dist(vec2(0.5, 0.515))));
  float target = uManual > 0.0 ? uManual : mix(c, max(c, s), 0.5);
  float prev = texture2D(tPrev, vec2(0.5)).x;
  // ease in log space so going from 2 m to 2 km feels as quick as 2 to 20 m
  float f = prev <= 0.0 ? target : exp(mix(log(prev), log(max(target, 0.05)), uK));
  gl_FragColor = vec4(f, 0.0, 0.0, 1.0);
}
`;

const downFrag = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tFocus;
uniform vec2 uTexel;
varying vec2 vUv;
${DOF_GLSL}
void main() {
  float focus = texture2D(tFocus, vec2(0.5)).x;
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 4; i++) {
    vec2 o = (vec2(float(i & 1), float(i >> 1)) - 0.5) * uTexel;
    float w = dofCoc(dofDist(texture2D(tDepth, vUv + o).x), focus);
    acc += vec4(texture2D(tColor, vUv + o).rgb * w, w);
  }
  gl_FragColor = acc * 0.25;
}
`;

const blurFrag = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec4 acc = texture2D(tSrc, vUv) * 0.2270270;
  acc += (texture2D(tSrc, vUv + uDir * 1.0) + texture2D(tSrc, vUv - uDir * 1.0)) * 0.1945946;
  acc += (texture2D(tSrc, vUv + uDir * 2.0) + texture2D(tSrc, vUv - uDir * 2.0)) * 0.1216216;
  acc += (texture2D(tSrc, vUv + uDir * 3.0) + texture2D(tSrc, vUv - uDir * 3.0)) * 0.0540541;
  acc += (texture2D(tSrc, vUv + uDir * 4.0) + texture2D(tSrc, vUv - uDir * 4.0)) * 0.0162162;
  gl_FragColor = acc;
}
`;

function target(w, h, type = THREE.HalfFloatType) {
  const rt = new THREE.WebGLRenderTarget(w, h, { type, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  rt.texture.generateMipmaps = false;
  return rt;
}

export class DepthOfField {
  constructor() {
    // amount is 0..1, the pipeline skips the passes at 0
    this.amount = 0;
    this.range = new THREE.Vector3(1, 6, 0);
    this.manualFocus = 0;
    this.spread = 1.6;
    this.logFar = { value: 1 };
    this.rangeU = { value: this.range };
    this.focusRT = [target(1, 1, THREE.FloatType), target(1, 1, THREE.FloatType)];
    for (const rt of this.focusRT) rt.texture.minFilter = rt.texture.magFilter = THREE.NearestFilter;
    this.focusIdx = 0;
    this.focusMat = new THREE.ShaderMaterial({
      uniforms: { tDepth: { value: null }, tPrev: { value: null }, uLogFar: this.logFar, uManual: { value: 0 }, uK: { value: 1 } },
      vertexShader: vert,
      fragmentShader: focusFrag,
      depthTest: false,
      depthWrite: false,
    });
    this.downMat = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null }, tDepth: { value: null }, tFocus: { value: null }, uTexel: { value: new THREE.Vector2() }, uLogFar: this.logFar, uDofRange: this.rangeU },
      vertexShader: vert,
      fragmentShader: downFrag,
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: vert,
      fragmentShader: blurFrag,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.focusMat);
  }

  setSize(w, h) {
    if (this.rtA) {
      this.rtA.dispose();
      this.rtB.dispose();
    }
    this.w = w;
    this.h = h;
    this.rtA = target(Math.max(1, w >> 1), Math.max(1, h >> 1));
    this.rtB = target(Math.max(1, w >> 1), Math.max(1, h >> 1));
  }

  get focusTexture() {
    return this.focusRT[this.focusIdx].texture;
  }

  // keeps the focus distance moving even while the blur is off, so turning
  // it on doesn't start from a stale distance
  updateFocus(r, depthTex, logFar, dt) {
    this.logFar.value = logFar;
    const prev = this.focusRT[this.focusIdx];
    this.focusIdx ^= 1;
    const u = this.focusMat.uniforms;
    u.tDepth.value = depthTex;
    u.tPrev.value = prev.texture;
    u.uManual.value = this.manualFocus;
    u.uK.value = this.manualFocus > 0 ? 1 : 1 - Math.exp(-dt * 6);
    this.quad.material = this.focusMat;
    r.setRenderTarget(this.focusRT[this.focusIdx]);
    this.quad.render(r);
  }

  // returns the blurred half res texture, alpha holds the blur weight
  render(r, colorTex, depthTex) {
    const q = this.quad;
    const d = this.downMat.uniforms;
    d.tColor.value = colorTex;
    d.tDepth.value = depthTex;
    d.tFocus.value = this.focusTexture;
    d.uTexel.value.set(1 / this.w, 1 / this.h);
    q.material = this.downMat;
    r.setRenderTarget(this.rtA);
    q.render(r);
    // spread is in half res texels at 1080p
    const s = this.spread * (this.h / 1080);
    const b = this.blurMat.uniforms;
    q.material = this.blurMat;
    b.tSrc.value = this.rtA.texture;
    b.uDir.value.set(s / this.rtA.width, 0);
    r.setRenderTarget(this.rtB);
    q.render(r);
    b.tSrc.value = this.rtB.texture;
    b.uDir.value.set(0, s / this.rtA.height);
    r.setRenderTarget(this.rtA);
    q.render(r);
    return this.rtA.texture;
  }

  dispose() {
    for (const rt of [...this.focusRT, this.rtA, this.rtB]) if (rt) rt.dispose();
    this.focusMat.dispose();
    this.downMat.dispose();
    this.blurMat.dispose();
  }
}
