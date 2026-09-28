import * as THREE from 'three';
import { snoise } from '../core/snoise.js';
import { smoothstep } from '../core/math.js';
import { RNG } from '../core/rng.js';
import { patchStandard } from '../render/materials.js';

// Low poly cloud puffs around a planet. The pattern is the same one
// cloudDensity() in atmosphere.glsl.js draws, which covers clouds seen from
// far away and cloud shadows on the ground, so the two have to stay in sync.

// sectors per cube face edge, each sector is one instanced mesh that can be
// skipped when it's past the horizon
const GRID = 3;

let lumpGeo = null;
function lumpGeometry() {
  if (lumpGeo) return lumpGeo;
  const g = new THREE.IcosahedronGeometry(1, 1);
  // flat bottoms, like cumulus
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < -0.3) p.setY(i, -0.3);
  g.computeVertexNormals();
  lumpGeo = g;
  return g;
}

export function cloudNoise(c, x, y, z) {
  let qx = x * c.scale + c.seed;
  let qy = y * c.scale + c.seed;
  let qz = z * c.scale + c.seed;
  const wx = snoise(qx * 0.3, qy * 0.3, qz * 0.3);
  const wy = snoise(qx * 0.3 + 17, qy * 0.3 + 17, qz * 0.3 + 17);
  const wz = snoise(qx * 0.3 - 9, qy * 0.3 - 9, qz * 0.3 - 9);
  qx += wx * 0.9;
  qy += wy * 0.9;
  qz += wz * 0.9;
  return snoise(qx * 0.55, qy * 0.55, qz * 0.55) * 0.5 + snoise(qx * 1.2 + 3.7, qy * 1.2 + 3.7, qz * 1.2 + 3.7) * 0.33 + snoise(qx * 2.6 - 1.3, qy * 2.6 - 1.3, qz * 2.6 - 1.3) * 0.17;
}

// coverage at which a point turns cloudy, see cloudDensity() in the shader
function appearCoverage(c, x, y, z) {
  const n = cloudNoise(c, x, y, z);
  const band = 0.5 + 0.5 * Math.sin(y * 6 + c.seed);
  const k = 0.7 + 0.6 * band;
  return (0.51 - n) / (0.7 * k);
}

function sectorOf(x, y, z) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let f, u, v;
  if (ax >= ay && ax >= az) {
    f = x > 0 ? 0 : 1;
    u = (x > 0 ? -z : z) / ax;
    v = y / ax;
  } else if (ay >= az) {
    f = y > 0 ? 2 : 3;
    u = x / ay;
    v = (y > 0 ? -z : z) / ay;
  } else {
    f = z > 0 ? 4 : 5;
    u = (z > 0 ? x : -x) / az;
    v = y / az;
  }
  const i = Math.min(GRID - 1, Math.floor((u * 0.5 + 0.5) * GRID));
  const j = Math.min(GRID - 1, Math.floor((v * 0.5 + 0.5) * GRID));
  return (f * GRID + j) * GRID + i;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _basis = new THREE.Matrix4();

// planetUniforms needs center, radius, sky and ground like Planet.uniforms
export function cloudMaterial(color, planetUniforms, uCov, uFade) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, flatShading: true });
  patchStandard(m, {
    key: 'clouds',
    center: planetUniforms.center,
    radius: planetUniforms.radius,
    sky: planetUniforms.sky,
    ground: planetUniforms.ground,
    uniforms: { uCov, uFade },
    vertexPars: 'attribute float aAppear; uniform float uCov; uniform float uFade;',
    // lumps near the edge of a cloud are smaller, so shapes taper off
    vertexBegin: 'transformed *= smoothstep(aAppear, aAppear + 0.15, uCov) * uFade;',
  });
  return m;
}

export class CloudPuffs {
  constructor(planet) {
    this.planet = planet;
    const def = planet.def;
    const c = def.clouds;
    this.def = c;
    const R = planet.radius;
    const rc = R + c.altitude;
    this.rc = rc;
    // storms close the layer up, so hazard worlds need the extra puffs
    const stormy = def.hazard && def.hazard.type !== 'none';
    const maxCov = Math.min(0.95, c.coverage + (stormy ? 0.35 : 0));
    const spacing = Math.min(240, Math.max(110, rc * 0.035));
    const n = Math.round((4 * Math.PI) / ((spacing / rc) * (spacing / rc)));
    const rng = new RNG((def.seed ^ 0xc10d) >>> 0);
    const lists = Array.from({ length: 6 * GRID * GRID }, () => []);
    const golden = Math.PI * (3 - Math.sqrt(5));
    const jitter = (spacing / rc) * 0.35;

    for (let i = 0; i < n; i++) {
      const y0 = 1 - ((i + 0.5) / n) * 2;
      const r0 = Math.sqrt(1 - y0 * y0);
      const th = i * golden;
      _up.set(Math.cos(th) * r0, y0, Math.sin(th) * r0);
      // break up the spiral pattern of the lattice
      tangents(_up, _t1, _t2);
      _up.addScaledVector(_t1, rng.range(-jitter, jitter)).addScaledVector(_t2, rng.range(-jitter, jitter)).normalize();
      const appear = appearCoverage(c, _up.x, _up.y, _up.z);
      if (appear > maxCov + 0.02) continue;
      tangents(_up, _t1, _t2);
      const yaw = rng.range(0, Math.PI * 2);
      const ca = Math.cos(yaw), sa = Math.sin(yaw);
      const ax = _t1.clone().multiplyScalar(ca).addScaledVector(_t2, sa);
      // right handed, or the basis isn't a rotation
      const az = new THREE.Vector3().crossVectors(ax, _up);
      const main = spacing * rng.range(0.42, 0.58);
      const lumps = rng.int(2, 4);
      const list = lists[sectorOf(_up.x, _up.y, _up.z)];
      const base = _up.clone().multiplyScalar(rc + rng.range(-12, 18));
      for (let k = 0; k < lumps; k++) {
        let r = main;
        let ox = 0, oz = 0, oy = 0;
        if (k > 0) {
          const a = rng.range(0, Math.PI * 2);
          const d = main * rng.range(0.6, 1.1);
          ox = Math.cos(a) * d;
          oz = Math.sin(a) * d;
          r = main * rng.range(0.5, 0.8);
          oy = -main * 0.12 * (1 - r / main);
        }
        const pos = base.clone().addScaledVector(ax, ox).addScaledVector(az, oz).addScaledVector(_up, oy);
        // outer lumps show up a bit later, so clouds grow from the middle out
        list.push({ pos, ax: ax.clone(), az: az.clone(), up: _up.clone(), sx: r * rng.range(0.9, 1.25), sy: r * rng.range(0.55, 0.75), sz: r * rng.range(0.9, 1.2), appear: appear + k * 0.035 });
      }
    }

    this.uCov = { value: c.coverage };
    this.uFade = { value: 1 };
    this.baseColor = new THREE.Color(c.color);
    this.material = cloudMaterial(this.baseColor.clone(), planet.uniforms, this.uCov, this.uFade);

    this.group = new THREE.Group();
    this.sectors = [];
    const geo = lumpGeometry();
    for (let s = 0; s < lists.length; s++) {
      const list = lists[s];
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(geo, this.material, list.length);
      const appearArr = new Float32Array(list.length);
      const center = new THREE.Vector3();
      for (let i = 0; i < list.length; i++) {
        const L = list[i];
        _basis.makeBasis(L.ax, L.up, L.az);
        _q.setFromRotationMatrix(_basis);
        _s.set(L.sx, L.sy, L.sz);
        _m.compose(L.pos, _q, _s);
        mesh.setMatrixAt(i, _m);
        appearArr[i] = L.appear;
        center.add(L.up);
      }
      mesh.geometry = geo.clone();
      mesh.geometry.setAttribute('aAppear', new THREE.InstancedBufferAttribute(appearArr, 1));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      center.normalize();
      let spread = 0;
      for (const L of list) spread = Math.max(spread, Math.acos(Math.min(1, L.up.dot(center))));
      this.sectors.push({ mesh, dir: center, angle: spread + (spacing * 1.5) / rc });
      this.group.add(mesh);
    }
    planet.group.add(this.group);
  }

  update(time, storm) {
    const p = this.planet;
    const c = this.def;
    const a = time * c.speed;
    // same drift as cloudDensity(), which rotates the lookup by +a
    this.group.rotation.y = -a;
    this.uCov.value = Math.min(0.95, c.coverage + storm * 0.35);
    const k = p.camDist / p.radius;
    this.uFade.value = 1 - smoothstep(6, 9, k);
    this.group.visible = this.uFade.value > 0.001;
    if (!this.group.visible) return;
    this.material.color.copy(this.baseColor).multiplyScalar(1 - storm * 0.45);

    // camera direction in the drifting cloud frame
    const ca = Math.cos(a), sa = Math.sin(a);
    const l = p.camLocal;
    _p.set(ca * l.x + sa * l.z, l.y, -sa * l.x + ca * l.z).normalize();
    const R = p.radius;
    const reach = Math.acos(Math.min(1, R / Math.max(R, p.camDist))) + Math.acos(R / this.rc);
    for (const s of this.sectors) {
      const ang = Math.acos(Math.max(-1, Math.min(1, s.dir.dot(_p))));
      s.mesh.visible = ang - s.angle < reach;
    }
  }

  dispose() {
    this.planet.group.remove(this.group);
    for (const s of this.sectors) {
      s.mesh.geometry.dispose();
      s.mesh.dispose();
    }
    this.material.dispose();
  }
}

function tangents(up, t1, t2) {
  t1.set(0, 1, 0).cross(up);
  if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0).cross(up);
  t1.normalize();
  t2.copy(up).cross(t1).normalize();
}
