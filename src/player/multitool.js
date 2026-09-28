import * as THREE from 'three';
import { patchStandard } from '../render/materials.js';
import { LAYER_POST } from '../render/pipeline.js';
import { radialTexture } from '../render/textures.js';

// First person multitool. It hangs off the camera on the post layer and
// squashes its depth so it always draws in front of the world.

function toolMaterial(color, metal, rough, emissive) {
  const m = new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough, emissive: emissive || 0x000000 });
  patchStandard(m, {
    key: 'tool',
    extra: (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <logdepthbuf_fragment>',
        '#include <logdepthbuf_fragment>\n gl_FragDepth *= 0.02;'
      );
    },
  });
  return m;
}

const beamVert = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;
const beamFrag = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uTime;
uniform float uLen;
uniform float uPower;
varying vec2 vUv;
void main() {
  #include <logdepthbuf_fragment>
  float across = abs(vUv.x - 0.5) * 2.0;
  float core = exp(-across * across * 18.0);
  float glow = exp(-across * across * 3.0) * 0.4;
  float along = vUv.y * uLen;
  float wave = 0.75 + 0.25 * sin(along * 3.0 - uTime * 40.0);
  vec3 c = (uColor * glow + mix(uColor, vec3(1.0), 0.6) * core) * wave * uPower * 3.0;
  gl_FragColor = vec4(c, 1.0);
}
`;

export class Multitool {
  constructor(camera) {
    this.root = new THREE.Group();
    this.root.position.set(0.28, -0.26, -0.55);
    camera.add(this.root);

    // chunky and rounded, closer to a toy than a rifle
    const body = toolMaterial(0xeee6d6, 0.05, 0.55);
    const dark = toolMaterial(0x2a303b, 0.3, 0.5);
    const accent = toolMaterial(0xff8a3c, 0.1, 0.5);
    const glowMat = toolMaterial(0x000000, 0, 1, 0x66ddff);
    this.glowMat = glowMat;
    const along = (geo) => geo.rotateX(Math.PI / 2);

    const g = new THREE.Group();
    const add = (geo, mat, x, y, z, rx = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.x = rx;
      g.add(m);
      return m;
    };
    add(along(new THREE.CapsuleGeometry(0.046, 0.19, 3, 8)), body, 0, 0, -0.02);
    // energy canister on top, with dark end caps
    add(along(new THREE.CylinderGeometry(0.021, 0.021, 0.13, 8)), glowMat, 0, 0.055, 0.02);
    add(along(new THREE.CylinderGeometry(0.027, 0.027, 0.022, 8)), dark, 0, 0.055, 0.095);
    add(along(new THREE.CylinderGeometry(0.027, 0.027, 0.022, 8)), dark, 0, 0.055, -0.055);
    // flared nozzle with a ring
    add(along(new THREE.CylinderGeometry(0.024, 0.038, 0.08, 8)), dark, 0, 0, -0.18);
    add(new THREE.TorusGeometry(0.043, 0.009, 6, 12), accent, 0, 0, -0.145);
    add(along(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 8)), glowMat, 0, 0, -0.222);
    // grip and side fins
    add(new THREE.CapsuleGeometry(0.022, 0.07, 2, 6), dark, 0, -0.075, 0.07, 0.3);
    for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.012, 0.03, 0.09), accent, side * 0.047, -0.01, 0.02);
    g.rotation.y = 0.06;
    this.model = g;
    this.root.add(g);
    this.muzzle = new THREE.Vector3(0, 0, -0.23);

    this.beamUniforms = {
      uColor: { value: new THREE.Color(1.0, 0.45, 0.2) },
      uTime: { value: 0 },
      uLen: { value: 1 },
      uPower: { value: 1 },
    };
    const beamGeo = new THREE.PlaneGeometry(1, 1, 1, 1);
    beamGeo.translate(0, 0.5, 0);
    beamGeo.rotateX(-Math.PI / 2);
    this.beam = new THREE.Mesh(
      beamGeo,
      new THREE.ShaderMaterial({
        uniforms: this.beamUniforms,
        vertexShader: beamVert,
        fragmentShader: beamFrag,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.beam.frustumCulled = false;
    this.beam.visible = false;
    camera.add(this.beam);

    const flashTex = radialTexture(64, [[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]);
    this.impact = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: new THREE.Color(4, 1.8, 0.8), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.impact.visible = false;
    this.impact.frustumCulled = false;
    camera.add(this.impact);

    this.root.traverse((o) => o.layers.set(LAYER_POST));
    this.beam.layers.set(LAYER_POST);
    this.impact.layers.set(LAYER_POST);

    this.kick = 0;
    this.sway = new THREE.Vector2();
    this.visible = true;
  }

  setVisible(v) {
    this.visible = v;
    this.root.visible = v;
    if (!v) {
      this.beam.visible = false;
      this.impact.visible = false;
    }
  }

  // target is camera-space (camera at origin, looking down -Z) or null
  update(dt, time, firing, targetCam, bob, look) {
    this.beamUniforms.uTime.value = time;
    this.sway.x += ((look ? -look.x * 0.6 : 0) - this.sway.x) * Math.min(1, dt * 8);
    this.sway.y += ((look ? look.y * 0.6 : 0) - this.sway.y) * Math.min(1, dt * 8);
    this.kick += ((firing ? 1 : 0) - this.kick) * Math.min(1, dt * 10);
    this.root.position.set(0.28 + this.sway.x * 0.1, -0.26 + bob * 0.4 + this.sway.y * 0.1, -0.55 + this.kick * 0.015);
    this.model.rotation.z = this.sway.x * 0.2;
    this.glowMat.emissive.setRGB(0.4 + this.kick * 1.8, 0.8 + this.kick, 1.0 + this.kick * 0.5);

    if (firing && targetCam) {
      const start = this.muzzle.clone().applyMatrix4(this.root.matrix);
      const end = targetCam;
      const dir = new THREE.Vector3().subVectors(end, start);
      const len = dir.length();
      dir.normalize();
      this.beam.visible = true;
      this.beam.position.copy(start);
      // orient the flat beam along dir, facing the camera as much as possible
      const zAxis = dir.clone().negate();
      const toCam = start.clone().negate().normalize();
      const xAxis = new THREE.Vector3().crossVectors(toCam, zAxis).normalize();
      const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis);
      const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
      this.beam.quaternion.setFromRotationMatrix(m);
      this.beam.scale.set(0.035 + Math.random() * 0.01, 1, len);
      this.beamUniforms.uLen.value = len;
      this.impact.visible = true;
      this.impact.position.copy(end);
      const s = 0.5 + Math.random() * 0.4;
      this.impact.scale.set(s, s, s);
    } else {
      this.beam.visible = false;
      this.impact.visible = false;
    }
  }
}
