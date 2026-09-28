import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import { createNoise3D } from '../core/noise.js';
import { patchStandard } from '../render/materials.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();

function rockGeometry(seed) {
  const rng = new RNG(seed);
  const g = new THREE.IcosahedronGeometry(1, 2);
  const noise = createNoise3D(seed);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const stretch = new THREE.Vector3(rng.range(0.7, 1.4), rng.range(0.6, 1.0), rng.range(0.8, 1.3));
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = noise(v.x * 1.3, v.y * 1.3, v.z * 1.3) * 0.28 + noise(v.x * 3.1, v.y * 3.1, v.z * 3.1) * 0.1;
    v.multiplyScalar(1 + n).multiply(stretch);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

const TYPES = [
  { res: 'ferrite', color: '#8c8479', weight: 6 },
  { res: 'cobalt', color: '#5a6a9a', weight: 2 },
  { res: 'hydrogel', color: '#5fb8e0', weight: 2 },
  { res: 'silica', color: '#c8b48a', weight: 1 },
];

// A cluster of tumbling asteroids in system space. Mined with the ship laser.
export class AsteroidField {
  constructor(def, mined) {
    this.def = def;
    this.position = new THREE.Vector3().fromArray(def.position);
    this.radius = def.radius;
    this.group = new THREE.Group();
    const rng = new RNG(def.seed);
    this.rocks = [];
    this.meshes = [];
    this.mined = mined;
    const geos = [rockGeometry(def.seed + 1), rockGeometry(def.seed + 2), rockGeometry(def.seed + 3)];
    const per = Math.ceil(def.count / geos.length);
    for (let gi = 0; gi < geos.length; gi++) {
      const mat = patchStandard(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), { key: 'asteroid' });
      const mesh = new THREE.InstancedMesh(geos[gi], mat, per);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.meshes.push(mesh);
    }
    const col = new THREE.Color();
    for (let i = 0; i < def.count; i++) {
      // flattened cloud, denser in the middle
      const r = Math.pow(rng.next(), 0.7) * this.radius;
      const th = rng.range(0, Math.PI * 2);
      const y = rng.gauss() * this.radius * 0.12;
      const type = rng.weighted(TYPES.map((t) => [t, t.weight]));
      const big = rng.chance(0.08);
      const rock = {
        id: i,
        mesh: i % geos.length,
        slot: Math.floor(i / geos.length),
        pos: new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r),
        scale: big ? rng.range(35, 90) : rng.range(5, 24),
        axis: new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize(),
        spin: rng.range(-0.3, 0.3),
        angle: rng.range(0, 6.28),
        type,
        hp: 1,
        alive: !mined.has(i),
      };
      this.rocks.push(rock);
      col.set(type.color).multiplyScalar(rng.range(0.8, 1.15));
      this.meshes[rock.mesh].setColorAt(rock.slot, col);
    }
    for (const m of this.meshes) {
      m.count = per;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.writeAll(0);
  }

  writeAll(time) {
    for (const r of this.rocks) {
      _q.setFromAxisAngle(r.axis, r.angle + r.spin * time);
      _s.setScalar(r.alive ? r.scale * (0.35 + 0.65 * r.hp) : 0);
      _m.compose(r.pos, _q, _s);
      this.meshes[r.mesh].setMatrixAt(r.slot, _m);
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }

  update(time, origin, camWorld) {
    this.group.position.subVectors(this.position, origin);
    // only bother animating when the player is close enough to notice
    const d = camWorld.distanceTo(this.position);
    this.group.visible = d < this.radius + 250000;
    if (d < this.radius + 20000 && (this.frameCount = (this.frameCount || 0) + 1) % 2 === 0) this.writeAll(time);
  }

  // world ray, returns nearest rock hit
  raycast(origin, dir, range) {
    const o = _v.subVectors(origin, this.position);
    if (o.length() > this.radius + range + 60) return null;
    let best = null;
    for (const r of this.rocks) {
      if (!r.alive) continue;
      const c = r.pos.clone().sub(o);
      const b = c.dot(dir);
      const rad = r.scale * 0.95;
      if (b < 0 || b > range + rad) continue;
      const c2 = c.lengthSq() - b * b;
      if (c2 > rad * rad) continue;
      const t = b - Math.sqrt(rad * rad - c2);
      if (!best || t < best.t) best = { t, rock: r };
    }
    return best;
  }

  // pushes a world-space sphere out of any rock it overlaps, returns the
  // outward normal of the deepest hit or null
  collide(pos, radius) {
    const o = _v.subVectors(pos, this.position);
    if (o.length() > this.radius + 200) return null;
    let hit = null;
    for (const r of this.rocks) {
      if (!r.alive) continue;
      const d = o.distanceTo(r.pos);
      const min = r.scale * 0.85 + radius;
      if (d < min) {
        const n = o.clone().sub(r.pos).normalize();
        o.addScaledVector(n, min - d);
        hit = n;
      }
    }
    if (hit) pos.copy(o).add(this.position);
    return hit;
  }

  dispose() {
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.material.dispose();
      m.dispose();
    }
  }
}
