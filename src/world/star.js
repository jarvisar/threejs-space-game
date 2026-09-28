import * as THREE from 'three';
import { NOISE_GLSL } from '../render/shaders/noise.glsl.js';
import { radialTexture } from '../render/textures.js';

const starVert = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vN;
varying vec3 vView;
varying vec3 vLocal;
void main() {
  vLocal = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vView = normalize(-wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;

const starFrag = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uTime;
uniform float uIntensity;
varying vec3 vN;
varying vec3 vView;
varying vec3 vLocal;
${NOISE_GLSL}
void main() {
  #include <logdepthbuf_fragment>
  float mu = clamp(dot(normalize(vN), normalize(vView)), 0.0, 1.0);
  float limb = 0.35 + 0.65 * pow(mu, 0.45);
  float g = fbm3(vLocal * 9.0 + vec3(0.0, uTime * 0.02, 0.0)) * 0.5 + 0.5;
  float spots = smoothstep(0.55, 0.75, snoise(vLocal * 2.5 + uTime * 0.005));
  vec3 c = uColor * uIntensity * limb * (0.8 + 0.4 * g) * (1.0 - spots * 0.25);
  c += vec3(1.0) * uIntensity * 0.35 * pow(mu, 3.0);
  gl_FragColor = vec4(c, 1.0);
}
`;

function glowTexture() {
  const tex = radialTexture(256, [[0, 'rgba(255,255,255,1)'], [0.08, 'rgba(255,255,255,0.55)'], [0.25, 'rgba(255,255,255,0.14)'], [0.55, 'rgba(255,255,255,0.03)'], [1, 'rgba(255,255,255,0)']]);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let _glowTex = null;

export class Star {
  constructor(def) {
    this.def = def;
    this.radius = def.radius;
    this.position = new THREE.Vector3(0, 0, 0);
    this.group = new THREE.Group();
    this.color = new THREE.Color(def.color);
    this.lightColor = new THREE.Color(def.light);

    this.uniforms = {
      uColor: { value: this.color.clone() },
      uTime: { value: 0 },
      uIntensity: { value: 40 },
    };
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(this.radius, 64, 32),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: starVert, fragmentShader: starFrag })
    );
    this.group.add(mesh);

    if (!_glowTex) _glowTex = glowTexture();
    const glowMat = new THREE.SpriteMaterial({
      map: _glowTex,
      color: this.color.clone().multiplyScalar(6),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.glow = new THREE.Sprite(glowMat);
    this.glow.scale.setScalar(this.radius * 9);
    this.group.add(this.glow);

    const haloMat = glowMat.clone();
    haloMat.color = this.color.clone().multiplyScalar(0.25);
    this.halo = new THREE.Sprite(haloMat);
    this.halo.scale.setScalar(this.radius * 26);
    this.group.add(this.halo);
  }

  update(time) {
    this.uniforms.uTime.value = time;
  }

  updateRender(origin) {
    this.group.position.subVectors(this.position, origin);
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
