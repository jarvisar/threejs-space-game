import * as THREE from 'three';
import { LAYER_POST } from '../render/pipeline.js';

// Shooting stars on clear nights. One streak at a time, a few seconds apart.
// Drawn after the atmosphere pass so hills still hide them, as a thin ribbon
// rebuilt every frame facing the camera.

const D = 6000;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();

export function meteorMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute float aFade;
      varying float vFade;
      void main() {
        vFade = aFade;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uK;
      uniform vec3 uColor;
      varying float vFade;
      void main() {
        #include <logdepthbuf_fragment>
        gl_FragColor = vec4(uColor * vFade * vFade * uK * 6.0, 1.0);
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export class Meteors {
  constructor(scene) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    // head bright, tail fading out
    geo.setAttribute('aFade', new THREE.BufferAttribute(new Float32Array([1, 1, 0, 0]), 1));
    geo.setIndex([0, 1, 2, 1, 3, 2]);
    this.uniforms = { uK: { value: 0 }, uColor: { value: new THREE.Color(1, 0.95, 0.85) } };
    const mat = meteorMaterial(this.uniforms);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.layers.set(LAYER_POST);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.cur = null;
    this.wait = 4;
  }

  // planet: the body the camera is on, null when not on one. up is the local
  // up at the camera, in the planet frame.
  update(dt, planet, up) {
    const night = planet && up ? -planet.sunDirLocal(_v).dot(up) : -1;
    if (!planet || night < 0.12) {
      this.mesh.visible = false;
      this.cur = null;
      return;
    }
    if (!this.cur) {
      this.wait -= dt;
      if (this.wait > 0) {
        this.mesh.visible = false;
        return;
      }
      this.wait = 3 + Math.random() * 9;
      // start somewhere 25-70 degrees up, travel along the sky, mostly downward
      const t1 = new THREE.Vector3(0, 1, 0).cross(up).normalize();
      const t2 = up.clone().cross(t1);
      const az = Math.random() * Math.PI * 2;
      const el = 0.45 + Math.random() * 0.75;
      const start = up.clone().multiplyScalar(Math.sin(el)).addScaledVector(t1, Math.cos(el) * Math.cos(az)).addScaledVector(t2, Math.cos(el) * Math.sin(az)).normalize();
      const sideways = t1.clone().multiplyScalar(-Math.sin(az)).addScaledVector(t2, Math.cos(az));
      const dir = sideways.multiplyScalar(Math.random() < 0.5 ? 1 : -1).addScaledVector(up, -0.35 - Math.random() * 0.4).normalize();
      this.cur = { planet, start, dir, t: 0, life: 0.5 + Math.random() * 0.7, speed: 0.35 + Math.random() * 0.25, bright: 0.5 + Math.random() * 0.8 };
    }
    const m = this.cur;
    m.t += dt;
    const k = m.t / m.life;
    if (k >= 1 || m.planet !== planet) {
      this.cur = null;
      this.mesh.visible = false;
      return;
    }
    // head and tail directions in the planet frame, then to world orientation
    const head = _a.copy(m.start).addScaledVector(m.dir, m.speed * k).normalize();
    const tail = _b.copy(m.start).addScaledVector(m.dir, m.speed * Math.max(0, k - 0.35)).normalize();
    head.applyQuaternion(planet.quat).multiplyScalar(D);
    tail.applyQuaternion(planet.quat).multiplyScalar(D);
    const side = _s.subVectors(head, tail).cross(head).normalize().multiplyScalar(D * 0.0011);
    const p = this.mesh.geometry.attributes.position.array;
    p[0] = head.x + side.x; p[1] = head.y + side.y; p[2] = head.z + side.z;
    p[3] = head.x - side.x; p[4] = head.y - side.y; p[5] = head.z - side.z;
    p[6] = tail.x + side.x * 0.2; p[7] = tail.y + side.y * 0.2; p[8] = tail.z + side.z * 0.2;
    p[9] = tail.x - side.x * 0.2; p[10] = tail.y - side.y * 0.2; p[11] = tail.z - side.z * 0.2;
    this.mesh.geometry.attributes.position.needsUpdate = true;
    // flares up quickly, burns out at the end
    this.uniforms.uK.value = Math.min(1, k * 6) * (1 - k * k) * m.bright * Math.min(1, (night - 0.12) * 5);
    this.mesh.visible = true;
  }
}
