import * as THREE from 'three';
import { LAYER_POST } from './pipeline.js';

// Plasma for atmospheric entry. An open cone like a shuttlecock: a hot cap in
// front of the nose that flares out and back past the ship, so from the chase
// camera you look into a ring of flame. It's on the post layer like the engine
// flames, so the scene depth still hides the parts behind the hull.
const vert = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uHeat;
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
varying float vT;
varying float vAng;
void main() {
  vec3 p = position;
  // 0 at the nose, 1 at the open end
  vT = clamp((1.0 - p.z) / 2.2, 0.0, 1.0);
  vAng = atan(p.y, p.x);
  // hotter means a longer, wider wake
  p.z -= vT * vT * uHeat * 1.2;
  p.xy *= 1.0 + vT * uHeat * 0.25;
  // the wake flutters
  p.xy *= 1.0 + 0.05 * vT * sin(vAng * 5.0 + uTime * 21.0 + vT * 9.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const frag = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uHeat;
uniform float uTime;
uniform vec3 uHot;
uniform vec3 uMid;
uniform vec3 uCool;
varying vec3 vN;
varying vec3 vV;
varying float vT;
varying float vAng;
void main() {
  #include <logdepthbuf_fragment>
  float t = vT;
  // flame tongues streaming back from the nose
  float a = vAng;
  float w = sin(a * 7.0 + sin(t * 7.0 - uTime * 11.0) * 1.3 + uTime * 1.7) * 0.5 + 0.5;
  float w2 = sin(a * 13.0 - t * 9.0 + uTime * 23.0 + sin(a * 3.0) * 2.0) * 0.5 + 0.5;
  float flame = pow(w * (0.45 + 0.55 * w2), 1.6);
  float edge = abs(dot(normalize(vN), normalize(vV)));
  float soft = 0.55 + 0.45 * (1.0 - edge);
  float cap = exp(-t * 7.0) * 2.4;
  float wake = flame * smoothstep(0.02, 0.2, t) * (1.0 - smoothstep(0.6, 1.0, t)) * 2.2;
  vec3 c = mix(uCool, uMid, exp(-t * 2.5));
  c = mix(c, uHot, exp(-t * 9.0));
  float k = (cap + wake) * soft * uHeat;
  gl_FragColor = vec4(c * k * 1.8, 1.0);
}
`;

// profile from the nose back to the open end, [radius, z]
const PROFILE = [
  [0.0, 1.0],
  [0.35, 0.9],
  [0.62, 0.66],
  [0.82, 0.3],
  [0.95, -0.1],
  [1.08, -0.6],
  [1.2, -1.2],
];

const _q = new THREE.Quaternion();
const Z = new THREE.Vector3(0, 0, 1);

export class EntryFx {
  constructor(scene) {
    this.uniforms = {
      uHeat: { value: 0 },
      uTime: { value: 0 },
      uHot: { value: new THREE.Color(1.0, 0.92, 0.7) },
      uMid: { value: new THREE.Color(1.0, 0.55, 0.18) },
      uCool: { value: new THREE.Color(0.9, 0.2, 0.08) },
    };
    // lathe goes around y, turn it so the nose points down +z
    const geo = new THREE.LatheGeometry(PROFILE.map(([r, z]) => new THREE.Vector2(r, z)), 40);
    geo.rotateX(Math.PI / 2);
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: vert,
        fragmentShader: frag,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.mesh.layers.set(LAYER_POST);
    this.mesh.frustumCulled = false;
    this.mesh.scale.set(5.2, 5.2, 6.5);
    scene.add(this.mesh);
    // drawn a couple of frames at zero heat so the shader compiles with everything else
    this.frames = 0;
  }

  // pos relative to the floating origin, dir the world direction of travel
  update(pos, dir, heat, time) {
    this.frames++;
    this.uniforms.uHeat.value = heat;
    this.uniforms.uTime.value = time;
    this.mesh.visible = heat > 0.005 || this.frames < 3;
    if (!this.mesh.visible) return;
    this.mesh.position.copy(pos).addScaledVector(dir, 1.5);
    this.mesh.quaternion.copy(_q.setFromUnitVectors(Z, dir));
  }
}
