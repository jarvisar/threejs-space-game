import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import { patchStandard } from '../render/materials.js';
import { radialTexture } from '../render/textures.js';

// A comet parked somewhere in the system: a faceted icy head, a glowing coma,
// a broad curved dust tail and a thin straight ion tail, both pointing away
// from the star. The tails are additive and write no depth, so the atmosphere
// pass treats them like stars: they show up in night skies and fade by day.

const tailVert = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying float vAlong;
varying vec3 vN;
varying vec3 vW;
void main() {
  vAlong = uv.y;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = mat3(modelMatrix) * normal;
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;

const tailFrag = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uTime;
uniform float uStreak;
varying float vAlong;
varying vec3 vN;
varying vec3 vW;
void main() {
  #include <logdepthbuf_fragment>
  // per pixel, per vertex showed the tube's rings
  float vFacing = abs(dot(normalize(vN), normalize(-vW)));
  // vAlong is 0 at the head, 1 at the far end. Bright near the head,
  // thinning out along the tail, soft at the edges.
  float a = vAlong;
  float fall = pow(1.0 - a, 1.6) * smoothstep(0.0, 0.04, a);
  float body = pow(vFacing, 2.2);
  float streak = 1.0 - uStreak * 0.35 * (0.5 + 0.5 * sin(a * 60.0 - uTime * 0.4));
  gl_FragColor = vec4(uColor * fall * body * streak, 1.0);
}
`;

export function tailMaterial(color, streak) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uStreak: { value: streak } },
    vertexShader: tailVert,
    fragmentShader: tailFrag,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// a tail as a flaring tube that bends as it goes
function tailGeometry(len, r0, r1, bend, seg = 28) {
  const g = new THREE.CylinderGeometry(r1, r0, len, 10, seg, true);
  g.translate(0, len / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / len;
    p.setX(i, p.getX(i) + bend * t * t * len);
  }
  g.computeVertexNormals();
  return g;
}

let _coma = null;

export class Comet {
  constructor(def, name) {
    this.def = def;
    this.name = name;
    this.position = new THREE.Vector3().fromArray(def.position);
    this.radius = def.radius;
    this.group = new THREE.Group();
    const rng = new RNG(def.seed);

    // icy head
    const g = new THREE.IcosahedronGeometry(def.radius, 1);
    const p = g.attributes.position;
    const seen = new Map();
    for (let i = 0; i < p.count; i++) {
      const k = `${p.getX(i).toFixed(2)},${p.getY(i).toFixed(2)},${p.getZ(i).toFixed(2)}`;
      let j = seen.get(k);
      if (j === undefined) seen.set(k, (j = rng.range(0.75, 1.2)));
      p.setXYZ(i, p.getX(i) * j, p.getY(i) * j * 0.8, p.getZ(i) * j);
    }
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c8d8e6'), roughness: 0.6, flatShading: true, emissive: new THREE.Color('#1a2a3a') });
    patchStandard(mat, { key: 'comet' });
    this.head = new THREE.Mesh(g, mat);
    this.group.add(this.head);

    if (!_coma) {
      _coma = radialTexture(128, [[0, 'rgba(255,255,255,1)'], [0.15, 'rgba(255,255,255,0.45)'], [0.45, 'rgba(255,255,255,0.08)'], [1, 'rgba(255,255,255,0)']]);
      _coma.colorSpace = THREE.SRGBColorSpace;
    }
    this.coma = new THREE.Sprite(new THREE.SpriteMaterial({ map: _coma, color: new THREE.Color(def.dust).multiplyScalar(2.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.coma.scale.setScalar(def.radius * 14);
    this.group.add(this.coma);

    // both tails are built along +Y and turned to face away from the star
    this.tails = new THREE.Group();
    this.dustMat = tailMaterial(new THREE.Color(def.dust).multiplyScalar(0.45), 0.3);
    this.ionMat = tailMaterial(new THREE.Color(def.ion).multiplyScalar(0.9), 1);
    // the dust tail is a few overlapping sheets bending by different amounts,
    // which reads as a curved fan instead of a cone
    for (const [bend, w] of [[0.12, 0.1], [0.24, 0.14], [0.38, 0.12]]) {
      this.tails.add(new THREE.Mesh(tailGeometry(def.tail * (1 - bend * 0.6), def.radius * 2.5, def.tail * w, bend), this.dustMat));
    }
    this.tails.add(new THREE.Mesh(tailGeometry(def.tail * 1.4, def.radius * 1.2, def.tail * 0.03, 0), this.ionMat));
    for (const m of this.tails.children) m.frustumCulled = false;
    this.group.add(this.tails);
    const away = this.position.clone().normalize();
    this.tails.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), away);
    // the dust tail curves back along the comet's path, pick a side
    this.tails.rotateY(rng.range(0, Math.PI * 2));
  }

  update(time) {
    this.head.rotation.y = time * 0.02;
    this.dustMat.uniforms.uTime.value = time;
    this.ionMat.uniforms.uTime.value = time;
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
