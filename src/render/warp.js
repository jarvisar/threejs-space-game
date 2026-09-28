import * as THREE from 'three';
import { LAYER_POST } from './pipeline.js';
import { NOISE_GLSL } from './shaders/noise.glsl.js';

const vert = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const frag = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uTime;
uniform float uOpacity;
uniform float uSpeed;
uniform vec3 uColorA;
uniform vec3 uColorB;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  #include <logdepthbuf_fragment>
  float a = vUv.x * 6.2831853;
  float z = vUv.y;
  // streaks: angular noise stretched along the tunnel, scrolling toward the camera
  float s = snoise(vec3(cos(a) * 3.0, sin(a) * 3.0, z * 6.0 + uTime * uSpeed));
  float streak = pow(max(0.0, snoise(vec3(cos(a) * 11.0, sin(a) * 11.0, z * 1.5 + uTime * uSpeed * 0.6))), 3.0) * 6.0;
  float band = smoothstep(0.1, 0.9, s * 0.5 + 0.5);
  vec3 col = mix(uColorA, uColorB, band) * (0.35 + band * 0.9) + vec3(1.0) * streak;
  // bright far end
  col += uColorB * pow(z, 6.0) * 4.0;
  float endFade = smoothstep(0.0, 0.08, z);
  gl_FragColor = vec4(col * endFade * 1.6, uOpacity * endFade);
}
`;

// Hyperspace tunnel that hangs off the camera. Drawn on the post layer with
// depth testing so the ship in front of the camera still covers it.
export class WarpTunnel {
  constructor(camera) {
    this.uniforms = {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uSpeed: { value: 3 },
      uColorA: { value: new THREE.Color(0.1, 0.25, 0.6) },
      uColorB: { value: new THREE.Color(0.7, 0.9, 1.6) },
    };
    const geo = new THREE.CylinderGeometry(38, 38, 900, 64, 1, true);
    // lay it along -Z, far end away from the camera
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, -440);
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: vert,
        fragmentShader: frag,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
      })
    );
    this.mesh.layers.set(LAYER_POST);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 10;
    camera.add(this.mesh);
  }

  setColors(a, b) {
    this.uniforms.uColorA.value.copy(a);
    this.uniforms.uColorB.value.copy(b);
  }

  update(time, opacity, speed) {
    this.uniforms.uTime.value = time;
    this.uniforms.uOpacity.value = opacity;
    this.uniforms.uSpeed.value = speed;
    this.mesh.visible = opacity > 0.001;
  }
}
