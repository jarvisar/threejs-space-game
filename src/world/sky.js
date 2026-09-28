import * as THREE from 'three';
import { NOISE_GLSL } from '../render/shaders/noise.glsl.js';
import { STAR_CLASSES, CLASS_KEYS, CORE_INDEX } from '../gen/galaxy.js';
import { RNG } from '../core/rng.js';

// Background sky built from the real galaxy: every other star system is drawn
// in its true direction, so the view changes after each jump and stars seen
// in the sky are the ones on the galaxy map.

const SKY_R = 4e8;

const bgVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const bgFrag = /* glsl */ `
uniform vec3 uCoreDir;
uniform float uCoreDist;
uniform float uSeed;
uniform vec3 uNebA;
uniform vec3 uNebB;
uniform float uIntensity;
varying vec3 vDir;
${NOISE_GLSL}
void main() {
  vec3 d = normalize(vDir);
  float near = 1.0 - smoothstep(80.0, 700.0, uCoreDist);
  float band = exp(-pow(d.y * mix(4.5, 1.2, near), 2.0));
  float toCore = max(dot(d, uCoreDir), 0.0);
  float core = pow(toCore, mix(6.0, 2.0, near)) * (0.6 + near * 2.0);
  float n = fbm5(d * 3.2 + uSeed) * 0.5 + 0.5;
  float lanes = smoothstep(0.45, 0.75, fbm5(d * 7.0 + uSeed * 1.7) * 0.5 + 0.5);
  vec3 bandCol = mix(vec3(0.55, 0.6, 0.85), vec3(1.0, 0.82, 0.62), toCore);
  vec3 col = bandCol * band * (0.25 + 0.75 * n) * (1.0 - lanes * 0.7 * band);
  col += vec3(1.0, 0.85, 0.65) * core * band;
  float neb = smoothstep(0.52, 0.9, fbm5(d * 1.6 + uSeed * 3.1) * 0.5 + 0.5);
  float nebMix = fbm3(d * 4.0 + uSeed) * 0.5 + 0.5;
  col += mix(uNebA, uNebB, nebMix) * neb * 0.9;
  gl_FragColor = vec4(col * uIntensity, 1.0);
}
`;

const starVert = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
uniform float uScale;
varying vec3 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.0, aSize * uScale);
  gl_Position = projectionMatrix * mv;
}
`;

const starFrag = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.0, d);
  a = a * a;
  gl_FragColor = vec4(vColor * a, 1.0);
}
`;

export class Sky {
  constructor(galaxy) {
    this.galaxy = galaxy;
    this.group = new THREE.Group();
    this.bgUniforms = {
      uCoreDir: { value: new THREE.Vector3(1, 0, 0) },
      uCoreDist: { value: 800 },
      uSeed: { value: 0 },
      uNebA: { value: new THREE.Color(0.4, 0.1, 0.5) },
      uNebB: { value: new THREE.Color(0.1, 0.3, 0.6) },
      uIntensity: { value: 0.06 },
    };
    const bg = new THREE.Mesh(
      new THREE.SphereGeometry(SKY_R, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: this.bgUniforms,
        vertexShader: bgVert,
        fragmentShader: bgFrag,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
      })
    );
    bg.renderOrder = -1e8;
    bg.frustumCulled = false;
    this.group.add(bg);

    const n = galaxy.count;
    this.starGeo = new THREE.BufferGeometry();
    this.starGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.starGeo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.starGeo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1));
    this.starUniforms = { uScale: { value: 1 } };
    const pts = new THREE.Points(
      this.starGeo,
      new THREE.ShaderMaterial({
        uniforms: this.starUniforms,
        vertexShader: starVert,
        fragmentShader: starFrag,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        transparent: false,
      })
    );
    pts.renderOrder = -9e7;
    pts.frustumCulled = false;
    this.group.add(pts);

    // faint filler stars so the sky doesn't feel sparse between real systems
    const fill = 16000;
    const fg = new THREE.BufferGeometry();
    const fp = new Float32Array(fill * 3);
    const fc = new Float32Array(fill * 3);
    const fs = new Float32Array(fill);
    const rng = new RNG(galaxy.seed ^ 0xabc);
    for (let i = 0; i < fill; i++) {
      let y = rng.range(-1, 1);
      if (rng.chance(0.6)) y *= 0.18;
      const t = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(1 - y * y);
      fp[i * 3] = r * Math.cos(t) * SKY_R * 0.98;
      fp[i * 3 + 1] = y * SKY_R * 0.98;
      fp[i * 3 + 2] = r * Math.sin(t) * SKY_R * 0.98;
      const b = rng.range(0.05, 0.35) * rng.range(0.3, 1);
      const warm = rng.next();
      fc[i * 3] = b * (0.8 + warm * 0.3);
      fc[i * 3 + 1] = b * (0.85 + warm * 0.1);
      fc[i * 3 + 2] = b * (1.1 - warm * 0.3);
      fs[i] = rng.range(1, 2);
    }
    fg.setAttribute('position', new THREE.BufferAttribute(fp, 3));
    fg.setAttribute('aColor', new THREE.BufferAttribute(fc, 3));
    fg.setAttribute('aSize', new THREE.BufferAttribute(fs, 1));
    const fillPts = new THREE.Points(fg, pts.material);
    fillPts.renderOrder = -9.5e7;
    fillPts.frustumCulled = false;
    this.group.add(fillPts);
  }

  setSystem(starIndex) {
    const g = this.galaxy;
    // the core is at the origin, sit just off it so the core direction below isn't NaN
    const [cx, cy, cz] = starIndex === CORE_INDEX ? [0.5, 0.5, 0.5] : g.pos(starIndex);
    const pos = this.starGeo.attributes.position.array;
    const col = this.starGeo.attributes.aColor.array;
    const size = this.starGeo.attributes.aSize.array;
    const tmp = new THREE.Color();
    for (let i = 0; i < g.count; i++) {
      let dx = g.positions[i * 3] - cx, dy = g.positions[i * 3 + 1] - cy, dz = g.positions[i * 3 + 2] - cz;
      const d = Math.hypot(dx, dy, dz);
      if (i === starIndex || d < 0.001) {
        size[i] = 0;
        continue;
      }
      pos[i * 3] = (dx / d) * SKY_R;
      pos[i * 3 + 1] = (dy / d) * SKY_R;
      pos[i * 3 + 2] = (dz / d) * SKY_R;
      const cls = STAR_CLASSES[CLASS_KEYS[g.classes[i]]];
      tmp.set(cls.color);
      const b = Math.min(3.5, 0.18 + 900 / (d * d + 30)) * (cls.tier >= 3 ? 1.4 : 1);
      col[i * 3] = tmp.r * b;
      col[i * 3 + 1] = tmp.g * b;
      col[i * 3 + 2] = tmp.b * b;
      size[i] = Math.min(4.5, 1.2 + 60 / (d + 8));
    }
    this.starGeo.attributes.position.needsUpdate = true;
    this.starGeo.attributes.aColor.needsUpdate = true;
    this.starGeo.attributes.aSize.needsUpdate = true;
    this.starGeo.computeBoundingSphere();

    const coreDist = Math.hypot(cx, cy, cz);
    this.bgUniforms.uCoreDir.value.set(-cx, -cy, -cz).normalize();
    this.bgUniforms.uCoreDist.value = coreDist;
    // nebula tint drifts across the galaxy so nearby systems share a look
    const region = new RNG(Math.floor(cx / 150) * 73856093 ^ Math.floor(cz / 150) * 19349663 ^ g.seed);
    this.bgUniforms.uSeed.value = region.range(0, 100);
    const hueA = region.next();
    this.bgUniforms.uNebA.value.setHSL(hueA, 0.7, 0.35);
    this.bgUniforms.uNebB.value.setHSL((hueA + region.range(0.15, 0.45)) % 1, 0.7, 0.3);
  }

  setPixelRatio(pr) {
    this.starUniforms.uScale.value = pr;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
