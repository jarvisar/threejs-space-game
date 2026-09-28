import * as THREE from 'three';
import { patchStandard } from '../render/materials.js';
import { LAYER_POST } from '../render/pipeline.js';

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

    const body = toolMaterial(0xd6dbe3, 0.4, 0.35);
    const dark = toolMaterial(0x252b36, 0.6, 0.4);
    const accent = toolMaterial(0xff8a3c, 0.2, 0.5);
    const glowMat = toolMaterial(0x000000, 0, 1, 0x66ddff);
    this.glowMat = glowMat;

    const g = new THREE.Group();
    const main = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.34), body);
    g.add(main);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.26), dark);
    top.position.set(0, 0.055, -0.02);
    g.add(top);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.18, 12), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.005, -0.25);
    g.add(barrel);
    const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.008, 6, 16), accent);
    ring1.position.set(0, 0.005, -0.2);
    g.add(ring1);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 12), glowMat);
    tip.rotation.x = Math.PI / 2;
    tip.position.set(0, 0.005, -0.345);
    g.add(tip);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.07), dark);
    grip.position.set(0, -0.09, 0.08);
    grip.rotation.x = 0.25;
    g.add(grip);
    const cell = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 10), glowMat);
    cell.rotation.x = Math.PI / 2;
    cell.position.set(0.042, 0.02, 0.04);
    g.add(cell);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.05, 0.12), accent);
    fin.position.set(0, 0.09, 0.05);
    g.add(fin);
    g.rotation.y = 0.06;
    this.model = g;
    this.root.add(g);
    this.muzzle = new THREE.Vector3(0, 0.005, -0.36);

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

    const flashTex = makeFlashTexture();
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

function makeFlashTexture() {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}
