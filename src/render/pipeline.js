import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { atmosphereVertex, atmosphereFragment, MAX_ATMO_PLANETS } from './shaders/atmosphere.glsl.js';
import { Bloom } from './bloom.js';

export const LAYER_MAIN = 0;
export const LAYER_POST = 1;

const finalFrag = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uExposure;
uniform float uTime;
uniform float uVignette;
uniform float uSaturation;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform float uAberration;
uniform float uGrain;
varying vec2 vUv;

vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 c) {
  const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  return clamp(outM * RRTAndODTFit(inM * c), 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 uv = vUv;
  vec2 dc = uv - 0.5;
  vec3 col;
  if (uAberration > 0.0) {
    vec2 off = dc * uAberration * 0.02;
    col.r = texture2D(tColor, uv + off).r;
    col.g = texture2D(tColor, uv).g;
    col.b = texture2D(tColor, uv - off).b;
  } else {
    col = texture2D(tColor, uv).rgb;
  }
  col += texture2D(tBloom, uv).rgb * uBloom;
  col *= uExposure;
  col = aces(col);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSaturation);
  col = mix(col, uFlashColor, uFlash);
  float vig = smoothstep(0.85, 0.2, length(dc * vec2(1.0, 0.8)));
  col *= mix(1.0, vig, uVignette);
  col = toSRGB(col);
  col += (rand(uv * 731.0 + fract(uTime * 7.0)) - 0.5) * uGrain;
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Pipeline {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.samples = 4;
    this.bloom = new Bloom(6);

    const planetSlots = [];
    for (let i = 0; i < MAX_ATMO_PLANETS; i++) planetSlots.push(Pipeline.emptySlot());
    this.atmoUniforms = {
      planets: { value: planetSlots },
      uCount: { value: 0 },
      tScene: { value: null },
      tDepth: { value: null },
      uProjInv: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uLogFar: { value: Math.log2(camera.far + 1) },
      uTime: { value: 0 },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uSunIntensity: { value: 15 },
      uNightAmbient: { value: new THREE.Color(0.01, 0.013, 0.022) },
      uDebug: { value: 0 },
    };
    this.atmoMaterial = new THREE.ShaderMaterial({
      uniforms: this.atmoUniforms,
      vertexShader: atmosphereVertex,
      fragmentShader: atmosphereFragment,
      depthTest: true,
      depthWrite: true,
      depthFunc: THREE.AlwaysDepth,
    });
    this.atmoQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.atmoMaterial);
    this.atmoQuad.frustumCulled = false;
    this.atmoQuad.renderOrder = -1e9;
    this.atmoQuad.layers.set(LAYER_POST);
    scene.add(this.atmoQuad);

    this.finalUniforms = {
      tColor: { value: null },
      tBloom: { value: null },
      uBloom: { value: 0.9 },
      uExposure: { value: 1.0 },
      uTime: { value: 0 },
      uVignette: { value: 0.35 },
      uSaturation: { value: 1.1 },
      uFlash: { value: 0 },
      uFlashColor: { value: new THREE.Color(1, 1, 1) },
      uAberration: { value: 0 },
      uGrain: { value: 0.012 },
    };
    this.finalQuad = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: this.finalUniforms,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: finalFrag,
        depthTest: false,
        depthWrite: false,
      })
    );
    this.width = 1;
    this.height = 1;
  }

  static emptySlot() {
    return {
      center: new THREE.Vector3(),
      radius: 1,
      atmoRadius: 1,
      camAlt: 0,
      betaR: new THREE.Vector3(),
      betaM: 0,
      scaleR: 1,
      scaleM: 1,
      mieG: 0.76,
      solidR: 1,
      sunDir: new THREE.Vector3(1, 0, 0),
      rot: new THREE.Matrix3(),
      ocean: 0,
      oceanShallow: new THREE.Color(),
      oceanDeep: new THREE.Color(),
      cloudCov: 0,
      cloudAlt: 0,
      cloudColor: new THREE.Color(1, 1, 1),
      cloudScale: 4,
      cloudSeed: 0,
      cloudSpeed: 0,
      ambient: new THREE.Color(),
    };
  }

  setSize(w, h) {
    this.width = w;
    this.height = h;
    if (this.rtScene) {
      this.rtScene.depthTexture.dispose();
      this.rtScene.dispose();
      this.rtPost.dispose();
    }
    const depthTexture = new THREE.DepthTexture(w, h, THREE.FloatType);
    this.rtScene = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: this.samples,
      depthBuffer: true,
      depthTexture,
    });
    this.rtPost = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: 0,
      depthBuffer: true,
    });
    this.bloom.setSize(w, h);
  }

  // atmosphere slots in draw order (farthest first)
  setAtmospheres(list) {
    const slots = this.atmoUniforms.planets.value;
    const n = Math.min(list.length, MAX_ATMO_PLANETS);
    for (let i = 0; i < n; i++) list[i].fillAtmoSlot(slots[i]);
    this.atmoUniforms.uCount.value = n;
  }

  // plain render of another scene (the galaxy map) through bloom and tonemap
  renderExternal(scene, camera) {
    const r = this.renderer;
    r.setRenderTarget(this.rtPost);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, true);
    r.render(scene, camera);
    const bloomTex = this.bloom.render(r, this.rtPost.texture, this.width, this.height);
    this.finalUniforms.tColor.value = this.rtPost.texture;
    this.finalUniforms.tBloom.value = bloomTex;
    r.setRenderTarget(null);
    this.finalQuad.render(r);
  }

  render(time, shadowsDirty) {
    const r = this.renderer;
    const cam = this.camera;
    this.atmoUniforms.uTime.value = time;
    this.finalUniforms.uTime.value = time;
    this.atmoUniforms.uLogFar.value = Math.log2(cam.far + 1);
    this.atmoUniforms.uProjInv.value.copy(cam.projectionMatrixInverse);
    this.atmoUniforms.uCamWorld.value.copy(cam.matrixWorld);

    // the shadow map texture has to exist even while shadows are idle, or
    // materials end up sampling a placeholder with the wrong sampler type
    if (shadowsDirty || !this.shadowInit) {
      r.shadowMap.needsUpdate = true;
      this.shadowInit = true;
    }
    const timing = this.timing;
    const gl = r.getContext();
    let t = timing ? performance.now() : 0;
    const lap = (name) => {
      if (!timing) return;
      gl.finish();
      const n = performance.now();
      timing[name] = Math.max(timing[name] || 0, n - t);
      t = n;
    };

    cam.layers.set(LAYER_MAIN);
    r.setRenderTarget(this.rtScene);
    r.clear(true, true, true);
    r.render(this.scene, cam);
    lap('scene');

    cam.layers.set(LAYER_POST);
    this.atmoUniforms.tScene.value = this.rtScene.texture;
    this.atmoUniforms.tDepth.value = this.rtScene.depthTexture;
    r.setRenderTarget(this.rtPost);
    r.clear(true, true, true);
    r.render(this.scene, cam);
    cam.layers.set(LAYER_MAIN);
    lap('atmo');

    const bloomTex = this.bloom.render(r, this.rtPost.texture, this.width, this.height);
    this.finalUniforms.tColor.value = this.rtPost.texture;
    this.finalUniforms.tBloom.value = bloomTex;
    r.setRenderTarget(null);
    this.finalQuad.render(r);
    lap('post');
  }
}
