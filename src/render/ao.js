import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { EffectShader } from './n8ao/EffectShader.js';
import { PoissionBlur } from './n8ao/PoissionBlur.js';
import bluenoiseBits from './n8ao/BlueNoise.js';

// N8AO screen space ambient occlusion, driven straight from the scene's color
// and depth targets instead of through N8AOPass (which re-renders the scene
// and needs the postprocessing library). Only the AO term comes out, the
// atmosphere pass multiplies it in before haze and water, so distant ground
// fades out of it naturally.
//
// Settings are tuned for walking scale: a 2 m radius picks up contact shadows
// under rocks, plants and creatures without darkening whole faces. Past a few
// hundred meters the radius is under a few pixels and it does nothing useful,
// so the pipeline skips it when the camera is high up.

const AO_SAMPLES = 16;
const DENOISE_SAMPLES = 8;
const DENOISE_ITERATIONS = 2;

function hemisphereSamples(n) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const theta = 2.399963 * k;
    const r = Math.sqrt(k + 0.5) / Math.sqrt(n);
    const x = r * Math.cos(theta), y = r * Math.sin(theta);
    out.push(new THREE.Vector3(x, y, Math.sqrt(1 - (x * x + y * y))));
  }
  return out;
}

function denoiseSamples(n, rings) {
  const step = (2 * Math.PI * rings) / n;
  const out = [];
  let radius = 1 / n;
  let angle = 0;
  for (let i = 0; i < n; i++) {
    out.push(new THREE.Vector2(Math.cos(angle), Math.sin(angle)).multiplyScalar(Math.pow(radius, 0.75)));
    radius += 1 / n;
    angle += step;
  }
  return out;
}

function target(w, h) {
  const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  rt.texture.generateMipmaps = false;
  return rt;
}

export class AmbientOcclusion {
  constructor() {
    this.radius = 2;
    this.falloff = 1;
    this.denoiseRadius = 12;

    this.noise = new THREE.DataTexture(bluenoiseBits, 128, 128);
    this.noise.colorSpace = THREE.NoColorSpace;
    this.noise.wrapS = this.noise.wrapT = THREE.RepeatWrapping;
    this.noise.minFilter = this.noise.magFilter = THREE.NearestFilter;
    this.noise.needsUpdate = true;

    this.aoMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(EffectShader.uniforms),
      vertexShader: EffectShader.vertexShader,
      fragmentShader: '#define LOGDEPTH\n' + EffectShader.fragmentShader.replace('16', AO_SAMPLES).replace('16.0', AO_SAMPLES + '.0'),
      depthTest: false,
      depthWrite: false,
    });
    const u = this.aoMat.uniforms;
    u.samples.value = hemisphereSamples(AO_SAMPLES);
    u.bluenoise.value = this.noise;
    // bias scaled by how fast depth changes across a pixel, keeps big flat
    // faces seen at a distance from reading as occluded
    u.biasAdjustment.value.set(0, 1);

    this.blurMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(PoissionBlur.uniforms),
      vertexShader: PoissionBlur.vertexShader,
      fragmentShader: '#define LOGDEPTH\n' + PoissionBlur.fragmentShader.replace('__N8AO_DENOISE_SAMPLES__', DENOISE_SAMPLES),
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat.uniforms.poissonDisk.value = denoiseSamples(DENOISE_SAMPLES, 11);
    this.blurMat.uniforms.blueNoise.value = this.noise;

    this.quad = new FullScreenQuad(this.aoMat);
    this.resolution = new THREE.Vector2();
  }

  setSize(w, h) {
    if (this.rtA) {
      this.rtA.dispose();
      this.rtB.dispose();
    }
    this.rtA = target(w, h);
    this.rtB = target(w, h);
    this.resolution.set(w, h);
  }

  // returns a texture with the occlusion in .r (1 = open)
  render(r, camera, colorTex, depthTex) {
    const u = this.aoMat.uniforms;
    u.sceneDiffuse.value = colorTex;
    u.sceneDepth.value = depthTex;
    u.projMat.value = camera.projectionMatrix;
    u.projectionMatrixInv.value = camera.projectionMatrixInverse;
    u.viewMat.value = camera.matrixWorldInverse;
    u.viewMatrixInv.value = camera.matrixWorld;
    // positions in the shader are view space, the camera sits at their origin
    u.cameraPos.value.set(0, 0, 0);
    u.resolution.value = this.resolution;
    u.radius.value = this.radius;
    u.distanceFalloff.value = this.falloff;
    u.near.value = camera.near;
    u.far.value = camera.far;
    this.quad.material = this.aoMat;
    r.setRenderTarget(this.rtA);
    this.quad.render(r);

    const b = this.blurMat.uniforms;
    b.sceneDepth.value = depthTex;
    b.projectionMatrixInv.value = camera.projectionMatrixInverse;
    b.viewMatrixInv.value = camera.matrixWorld;
    b.resolution.value = this.resolution;
    b.radius.value = this.denoiseRadius;
    b.worldRadius.value = this.radius;
    b.distanceFalloff.value = this.falloff;
    b.near.value = camera.near;
    b.far.value = camera.far;
    this.quad.material = this.blurMat;
    let read = this.rtA, write = this.rtB;
    for (let i = 0; i < DENOISE_ITERATIONS; i++) {
      b.tDiffuse.value = read.texture;
      b.index.value = i;
      r.setRenderTarget(write);
      this.quad.render(r);
      [read, write] = [write, read];
    }
    return read.texture;
  }

  dispose() {
    this.rtA?.dispose();
    this.rtB?.dispose();
    this.noise.dispose();
    this.aoMat.dispose();
    this.blurMat.dispose();
  }
}
