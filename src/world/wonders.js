import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG } from '../core/rng.js';
import { makeName } from '../gen/names.js';
import { std } from './pois.js';

// Wonders: a few big landmarks per planet, visible from a long way off and
// worth flying over to. Each one is built from primitives and merged into a
// handful of meshes. Everything is in a local frame with Y up and the origin
// on the ground at the wonder's center. g(x, z) gives the ground height at a
// local spot, so parts spread over uneven ground still sit on it.

export const WONDERS = {
  arch: { label: 'Stone Arch', reach: 70, worlds: ['desert', 'barren', 'lush', 'ocean', 'toxic', 'radioactive', 'volcanic', 'frozen', 'dead', 'exotic'] },
  crystals: { label: 'Crystal Titans', reach: 55, worlds: ['frozen', 'exotic', 'radioactive', 'barren', 'dead', 'desert'] },
  bones: { label: 'Leviathan Remains', reach: 70, worlds: ['desert', 'lush', 'toxic', 'barren', 'ocean', 'radioactive'] },
  isles: { label: 'Floating Isles', reach: 90, worlds: ['exotic', 'lush', 'toxic', 'ocean'] },
  geysers: { label: 'Geyser Field', reach: 60, worlds: ['volcanic', 'frozen', 'toxic', 'radioactive'] },
  tree: { label: 'Elder Tree', reach: 55, worlds: ['lush', 'ocean', 'toxic', 'exotic'] },
  wreck: { label: 'Derelict Freighter', reach: 70, worlds: ['desert', 'barren', 'lush', 'ocean', 'toxic', 'radioactive', 'volcanic', 'frozen', 'dead', 'exotic'] },
};

const SHIPS = ['Long Quiet', 'Seventh Verse', 'Halcyon', 'Wandering Star', 'Low Harmony', 'Clearwater', 'Patience', 'Tamsin’s Hope', 'Far Meridian', 'Small Hours', 'Kestrel', 'Open Hand'];

export function wonderName(kind, seed, planetName) {
  const rng = new RNG(seed ^ 0x77e1);
  const n = makeName(seed, 2, 2);
  switch (kind) {
    case 'arch':
      return rng.pick([`Arch of ${n}`, `The ${n} Gate`, `${n}’s Arch`, 'The Sky Gate', 'The Broken Bridge']);
    case 'crystals':
      return rng.pick(['The Glass Titans', `${n} Spires`, 'The Singing Shards', `Crystals of ${n}`, 'The Frozen Choir']);
    case 'bones':
      return rng.pick(['The Bone Cathedral', `Remains of ${n}`, 'The Sleeping Leviathan', 'The Old Ribs', `${n}’s Rest`]);
    case 'isles':
      return rng.pick(['The Drifting Isles', `${n} Skyreach`, `Isles of ${n}`, 'The Hanging Gardens', 'The Lifted Stones']);
    case 'geysers':
      return rng.pick([`${n} Vents`, 'The Breathing Fields', `Geysers of ${n}`, 'The Old Kettles', `${n} Springs`]);
    case 'tree':
      return rng.pick([`The Elder of ${planetName}`, `${n}, the Old Tree`, 'The World Tree', `${n}’s Crown`, 'The Patient Tree']);
    case 'wreck':
      return `Wreck of the ${rng.pick(SHIPS)}`;
  }
  return n;
}

// the kinds that can show up on a planet type
export function wonderKinds(type) {
  return Object.keys(WONDERS).filter((k) => WONDERS[k].worlds.includes(type));
}

// ---------------------------------------------------------------- helpers

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();

function mat(pos, rot, scale) {
  _q.setFromEuler(_e.set(rot ? rot.x : 0, rot ? rot.y : 0, rot ? rot.z : 0));
  _s.set(scale ? scale.x : 1, scale ? scale.y : 1, scale ? scale.z : 1);
  return new THREE.Matrix4().compose(pos, _q, _s);
}

// collects pieces per material and merges them into one mesh each
class Parts {
  constructor() {
    this.lists = new Map();
  }

  add(geo, material, matrix) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (matrix) g.applyMatrix4(matrix);
    if (!this.lists.has(material)) this.lists.set(material, []);
    this.lists.get(material).push(g);
    geo.dispose();
  }

  build(group = new THREE.Group()) {
    for (const [material, geos] of this.lists) {
      const merged = mergeGeometries(geos);
      for (const g of geos) g.dispose();
      const m = new THREE.Mesh(merged, material);
      m.castShadow = !material.isMeshBasicMaterial;
      m.receiveShadow = true;
      group.add(m);
    }
    return group;
  }
}

function rock(rng, r, detail = 0) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position;
  // jitter shared corners the same way so the rock stays closed
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let j = seen.get(k);
    if (j === undefined) seen.set(k, (j = rng.range(0.78, 1.18)));
    p.setXYZ(i, p.getX(i) * j, p.getY(i) * j, p.getZ(i) * j);
  }
  g.computeVertexNormals();
  return g;
}

function shade(hex, k) {
  return new THREE.Color(hex).multiplyScalar(k);
}

function glowMat(color, k = 2.6) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) });
}

// ---------------------------------------------------------------- builders

function buildArch(rng, pal, def, g) {
  const parts = new Parts();
  const stoneA = std(new THREE.Color(pal.cliff).lerp(new THREE.Color(pal.sand), 0.35), { flat: true, rough: 0.9 });
  const stoneB = std(new THREE.Color(pal.high).lerp(new THREE.Color(pal.sand), 0.3), { flat: true, rough: 0.9 });
  const span = rng.range(42, 70);
  const height = span * rng.range(0.55, 0.8);
  const thick = span * rng.range(0.08, 0.11);
  const n = 22;
  const gl = g(-span * 0.5, 0), gr = g(span * 0.5, 0);
  for (let i = 0; i <= n; i++) {
    const a = -0.12 + (Math.PI + 0.24) * (i / n);
    const x = Math.cos(a) * span * 0.5;
    // spans between the two feet even when they're at different heights
    const y = Math.sin(a) * height + gr + (gl - gr) * (0.5 - x / span);
    // thicker at the feet
    const r = thick * (1.25 - 0.45 * Math.sin(Math.max(0, a))) * rng.range(0.85, 1.15);
    parts.add(rock(rng, r, 1), i % 3 === 0 ? stoneB : stoneA, mat(new THREE.Vector3(x, y, rng.range(-0.2, 0.2) * thick), { x: rng.range(0, 3), y: rng.range(0, 3), z: rng.range(0, 3) }, { x: 1.1, y: 0.9, z: 1 }));
  }
  for (let i = 0; i < 9; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side * span * 0.5 + rng.range(-1, 1) * thick * 2, z = rng.range(-1, 1) * thick * 2.5;
    parts.add(rock(rng, thick * rng.range(0.3, 0.7)), stoneA, mat(new THREE.Vector3(x, g(x, z), z), { x: rng.range(0, 3), y: rng.range(0, 3), z: 0 }));
  }
  return { group: parts.build(), height, colliders: [{ x: -span * 0.5, y: gl, z: 0, r: thick * 1.2, h: height * 0.45 }, { x: span * 0.5, y: gr, z: 0, r: thick * 1.2, h: height * 0.45 }] };
}

function buildCrystals(rng, pal, def, g) {
  const parts = new Parts();
  const tint = { frozen: '#9fe4ff', radioactive: '#b6ff6a', exotic: pal.glow, dead: '#b9c8ff', barren: '#ffd18a', desert: '#ff9ec7' }[def.type] || pal.glow;
  const c1 = new THREE.Color(tint);
  const c2 = c1.clone().offsetHSL(0.06, 0, -0.08);
  const m1 = std(c1, { flat: true, rough: 0.2, metal: 0.1, emissive: c1.clone().multiplyScalar(0.35) });
  const m2 = std(c2, { flat: true, rough: 0.2, metal: 0.1, emissive: c2.clone().multiplyScalar(0.3) });
  const base = std(shade(pal.cliff, 0.9), { flat: true, rough: 0.95 });
  const colliders = [];
  const n = rng.int(6, 10);
  let top = 0;
  for (let i = 0; i < n; i++) {
    const main = i === 0;
    const h = main ? rng.range(38, 52) : rng.range(12, 34);
    const r = main ? rng.range(4, 5.5) : rng.range(1.8, 3.8);
    const a = rng.range(0, Math.PI * 2);
    const d = main ? 0 : rng.range(5, 17);
    const tilt = main ? rng.range(0, 0.08) : rng.range(0.15, 0.55);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const body = new THREE.CylinderGeometry(r * 0.85, r, h, 6);
    body.translate(0, h / 2, 0);
    const tip = new THREE.ConeGeometry(r * 0.85, r * 2.2, 6);
    tip.translate(0, h + r * 1.1, 0);
    const gy = g(x, z);
    const m = mat(new THREE.Vector3(x, gy - 1.5, z), { x: Math.sin(a) * tilt, y: rng.range(0, 1), z: -Math.cos(a) * tilt });
    parts.add(body, i % 2 ? m2 : m1, m);
    parts.add(tip, i % 2 ? m2 : m1, m);
    top = Math.max(top, h * Math.cos(tilt));
    colliders.push({ x, y: gy, z, r: r * 0.9, h: h * 0.6 });
  }
  for (let i = 0; i < 12; i++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(2, 18);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    parts.add(rock(rng, rng.range(1.2, 3.5)), base, mat(new THREE.Vector3(x, g(x, z), z), { x: rng.range(0, 3), y: rng.range(0, 3), z: 0 }, { x: 1.2, y: 0.6, z: 1.1 }));
  }
  return { group: parts.build(), height: top, colliders };
}

function buildBones(rng, pal, def, g) {
  const parts = new Parts();
  const boneCol = new THREE.Color('#efe4cc').lerp(new THREE.Color(pal.sand), 0.25);
  const bone = std(boneCol, { flat: true, rough: 0.75 });
  const boneDark = std(boneCol.clone().multiplyScalar(0.82), { flat: true, rough: 0.8 });
  const len = rng.range(55, 85);
  const lift = rng.range(4, 9);
  const spine = [];
  const n = 26;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = (t - 0.5) * len;
    // an arched back that dips into the ground at the tail
    const y = Math.sin(t * Math.PI) * lift + (t < 0.2 ? (0.2 - t) * 20 : 0) - (t > 0.85 ? (t - 0.85) * 40 : 0);
    const z = Math.sin(t * 5 + rng.range(0, 1)) * 2;
    spine.push(new THREE.Vector3(x, y + g(x, z), z));
  }
  for (let i = 0; i < spine.length; i++) {
    const t = i / n;
    const r = (1.2 + Math.sin(t * Math.PI) * 1.4) * (t < 0.2 ? 1.3 : 1);
    parts.add(new THREE.DodecahedronGeometry(r, 0), i % 2 ? bone : boneDark, mat(spine[i], { x: rng.range(0, 1), y: rng.range(0, 1), z: rng.range(0, 1) }, { x: 1.3, y: 1, z: 1 }));
  }
  // ribs: arcs from the spine down to the ground on both sides
  const ribs = 10;
  for (let i = 0; i < ribs; i++) {
    const t = 0.25 + (i / (ribs - 1)) * 0.55;
    const base = spine[Math.round(t * n)];
    const size = (1 - Math.abs(t - 0.5) * 1.2) * rng.range(0.9, 1.1);
    for (const side of [-1, 1]) {
      if (rng.chance(0.12)) continue; // a few ribs are missing
      const w = (12 + 10 * size) * side;
      const foot = g(base.x + 2, base.z + w * 1.05);
      const h = base.y + 8 + 10 * size;
      const curve = new THREE.CatmullRomCurve3([
        base.clone(),
        base.clone().add(new THREE.Vector3(0, 4 + 6 * size, w * 0.45)),
        new THREE.Vector3(base.x + 1, (h + foot) * 0.55, base.z + w * 0.95),
        new THREE.Vector3(base.x + 2, foot - 1.5, base.z + w * 1.05),
      ]);
      parts.add(new THREE.TubeGeometry(curve, 10, 0.55 + 0.5 * size, 5, false), bone);
    }
  }
  // skull at the head end
  const head = spine[Math.round(n * 0.12)].clone().add(new THREE.Vector3(-6, 1, 0));
  parts.add(rock(rng, 5.5, 1), bone, mat(head, { x: 0, y: 0, z: 0.25 }, { x: 1.8, y: 1, z: 1.1 }));
  parts.add(rock(rng, 4, 1), boneDark, mat(head.clone().add(new THREE.Vector3(-4, -3.5, 0)), { x: 0, y: 0, z: -0.15 }, { x: 1.9, y: 0.45, z: 0.9 }));
  for (let i = 0; i < 6; i++) {
    const tooth = new THREE.ConeGeometry(0.45, 2.2, 5);
    parts.add(tooth, bone, mat(head.clone().add(new THREE.Vector3(-9 + i * 1.2, -2.2, (i % 2 ? 1 : -1) * 2.8)), { x: Math.PI, y: 0, z: 0 }));
  }
  const colliders = [];
  for (let i = 3; i < spine.length; i += 5) {
    const gy = g(spine[i].x, spine[i].z);
    colliders.push({ x: spine[i].x, y: gy, z: spine[i].z, r: 2.4, h: spine[i].y - gy + 2 });
  }
  return { group: parts.build(), height: lift + 22, colliders };
}

function buildIsles(rng, pal, def, g) {
  const group = new THREE.Group();
  const rockMat = std(shade(pal.cliff, 1.0), { flat: true, rough: 0.9 });
  const rockMat2 = std(new THREE.Color(pal.high), { flat: true, rough: 0.9 });
  const grass = std(new THREE.Color(pal.veg), { flat: true, rough: 0.85 });
  const leaf = std(new THREE.Color(pal.leaf[0]), { flat: true, rough: 0.8 });
  const trunk = std(new THREE.Color(pal.trunk), { flat: true, rough: 0.9 });
  const vine = std(new THREE.Color(pal.leaf[1]).multiplyScalar(0.8), { flat: true, rough: 0.9 });
  const isles = [];
  const n = rng.int(4, 7);
  let top = 0;
  for (let i = 0; i < n; i++) {
    const parts = new Parts();
    const r = i === 0 ? rng.range(14, 20) : rng.range(5, 12);
    const a = rng.range(0, Math.PI * 2), d = i === 0 ? 0 : rng.range(18, 55);
    const y = i === 0 ? rng.range(60, 80) : rng.range(28, 110);
    // body: a jagged cone pointing down
    const body = new THREE.ConeGeometry(r, r * rng.range(1.6, 2.4), 7, 3);
    const p = body.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const yy = p.getY(k);
      if (yy > body.parameters.height * 0.49) continue;
      p.setX(k, p.getX(k) * rng.range(0.8, 1.15));
      p.setZ(k, p.getZ(k) * rng.range(0.8, 1.15));
    }
    body.rotateX(Math.PI);
    body.translate(0, -body.parameters.height / 2, 0);
    parts.add(body, rockMat);
    parts.add(new THREE.CylinderGeometry(r * 1.02, r * 1.02, r * 0.18, 7), grass, mat(new THREE.Vector3(0, r * 0.05, 0)));
    parts.add(new THREE.CylinderGeometry(r * 0.99, r * 0.95, r * 0.3, 7), rockMat2, mat(new THREE.Vector3(0, -r * 0.18, 0)));
    const trees = Math.max(1, Math.round(r / 5));
    for (let k = 0; k < trees; k++) {
      const ta = rng.range(0, Math.PI * 2), td = rng.range(0, r * 0.6);
      const th = rng.range(3, 7);
      const tp = new THREE.Vector3(Math.cos(ta) * td, 0, Math.sin(ta) * td);
      const tr = new THREE.CylinderGeometry(0.25, 0.4, th, 5);
      tr.translate(0, th / 2, 0);
      parts.add(tr, trunk, mat(tp));
      parts.add(rock(rng, th * 0.45, 0), leaf, mat(tp.clone().add(new THREE.Vector3(0, th, 0)), null, { x: 1, y: 0.8, z: 1 }));
    }
    for (let k = 0; k < Math.round(r / 2); k++) {
      const va = rng.range(0, Math.PI * 2), vd = r * rng.range(0.4, 0.95);
      const vl = rng.range(4, 14);
      const v = new THREE.CylinderGeometry(0.12, 0.2, vl, 4);
      v.translate(0, -vl / 2, 0);
      parts.add(v, vine, mat(new THREE.Vector3(Math.cos(va) * vd, -r * 0.15, Math.sin(va) * vd)));
    }
    const isle = parts.build();
    isle.position.set(Math.cos(a) * d, y + g(Math.cos(a) * d, Math.sin(a) * d), Math.sin(a) * d);
    isle.rotation.y = rng.range(0, Math.PI * 2);
    group.add(isle);
    isles.push({ obj: isle, y: isle.position.y, phase: rng.range(0, 6), amp: rng.range(1, 2.5), spin: rng.range(-0.02, 0.02) });
    top = Math.max(top, y + 8);
  }
  // a few boulders on the ground below where they "broke off"
  const parts = new Parts();
  for (let i = 0; i < 7; i++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(4, 40);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    parts.add(rock(rng, rng.range(1.5, 4)), rockMat, mat(new THREE.Vector3(x, g(x, z), z), { x: rng.range(0, 3), y: 0, z: rng.range(0, 3) }));
  }
  parts.build(group);
  const update = (t) => {
    for (const s of isles) {
      s.obj.position.y = s.y + Math.sin(t * 0.3 + s.phase) * s.amp;
      s.obj.rotation.y += s.spin * 0.016;
    }
  };
  return { group, height: top, colliders: [], update };
}

// puffs for one geyser plume, reused every eruption
const puffGeo = new THREE.IcosahedronGeometry(1, 1);

function buildGeysers(rng, pal, def, g) {
  const parts = new Parts();
  const crust = std(new THREE.Color(pal.sand).lerp(new THREE.Color('#f4efe2'), 0.35), { flat: true, rough: 0.9 });
  const crust2 = std(shade(pal.cliff, 0.95), { flat: true, rough: 0.9 });
  const hot = def.type === 'volcanic';
  const steamCol = hot ? '#ff8a3c' : def.type === 'toxic' ? '#c8ff7a' : def.type === 'radioactive' ? '#e8ff9a' : '#ffffff';
  const steam = hot
    ? glowMat(steamCol, 2.2)
    : std(new THREE.Color(steamCol), { flat: true, rough: 1 });
  const rim = glowMat(hot ? '#ff6a1a' : def.type === 'toxic' ? '#9cff3a' : '#7fe8ff', hot ? 3 : 1.6);
  const vents = [];
  const colliders = [];
  const n = rng.int(4, 7);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2), d = i === 0 ? 0 : rng.range(10, 30);
    const r = i === 0 ? rng.range(5, 7) : rng.range(2.5, 4.5);
    const h = r * rng.range(0.6, 1.0);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const gy = Math.min(g(x, z), g(x + r, z), g(x - r, z), g(x, z + r), g(x, z - r));
    // tall enough to still stand clear of the ground on the uphill side
    const mound = new THREE.CylinderGeometry(r * 0.35, r, h + 2, 8, 1);
    mound.translate(0, (h + 2) / 2 - 2, 0);
    parts.add(mound, i % 2 ? crust : crust2, mat(new THREE.Vector3(x, gy, z)));
    for (let k = 1; k <= 2; k++) {
      const t = new THREE.CylinderGeometry(r * (1 + k * 0.45), r * (1.1 + k * 0.45), 1.4, 9);
      parts.add(t, crust, mat(new THREE.Vector3(x, gy - 0.35 - k * 0.15, z), { x: 0, y: rng.range(0, 1), z: 0 }));
    }
    parts.add(new THREE.TorusGeometry(r * 0.33, r * 0.07, 4, 8), rim, mat(new THREE.Vector3(x, gy + h - 0.35, z), { x: Math.PI / 2, y: 0, z: 0 }));
    colliders.push({ x, y: gy, z, r: r * 0.7, h });
    const plume = new THREE.InstancedMesh(puffGeo, steam, 14);
    plume.frustumCulled = false;
    plume.castShadow = false;
    vents.push({ x, z, top: gy + h, plume, period: rng.range(10, 18), len: rng.range(4, 6.5), phase: rng.range(0, 20), power: i === 0 ? rng.range(28, 40) : rng.range(12, 24), r });
  }
  const group = parts.build();
  for (const v of vents) group.add(v.plume);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const update = (t) => {
    for (const v of vents) {
      const c = (t + v.phase) % v.period;
      for (let i = 0; i < v.plume.count; i++) {
        // each puff launches a little after the one before
        const age = c - i * (v.len / v.plume.count);
        let k = 0;
        if (age > 0 && age < v.len + 2.5) k = Math.min(1, age / 0.4) * (1 - Math.max(0, (age - v.len) / 2.5));
        const life = Math.max(0, age);
        const y = v.top + life * v.power * 0.55 * (1 - life / (v.len + 6));
        const size = (0.6 + life * 0.9) * k * v.r * 0.35;
        p.set(v.x + Math.sin(i * 2.1 + t * 0.5) * life * 0.6, y, v.z + Math.cos(i * 1.7) * life * 0.6);
        q.setFromEuler(_e.set(i, i * 0.7, 0));
        s.setScalar(Math.max(0.0001, size));
        m.compose(p, q, s);
        v.plume.setMatrixAt(i, m);
      }
      v.plume.instanceMatrix.needsUpdate = true;
    }
  };
  update(0);
  return { group, height: 30, colliders, update };
}

function buildTree(rng, pal) {
  const parts = new Parts();
  const bark = std(new THREE.Color(pal.trunk).lerp(new THREE.Color('#6b5040'), 0.3), { flat: true, rough: 0.9 });
  const leafMats = pal.leaf.map((c) => std(new THREE.Color(c), { flat: true, rough: 0.85 }));
  const fruitMat = glowMat(pal.glow, 2.2);
  const h = rng.range(44, 58);
  const r = rng.range(3.8, 5);
  const trunk = new THREE.CylinderGeometry(r * 0.55, r, h, 8, 4);
  const p = trunk.attributes.position;
  const lean = rng.range(-0.08, 0.08);
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) + h / 2) / h;
    p.setX(i, p.getX(i) + Math.sin(t * 3) * 1.2 + lean * t * h);
  }
  trunk.translate(0, h / 2 - 1, 0);
  parts.add(trunk, bark);
  // root flares
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const root = new THREE.ConeGeometry(r * 0.55, r * 3.2, 5);
    parts.add(root, bark, mat(new THREE.Vector3(Math.cos(a) * r * 0.9, 0.6, Math.sin(a) * r * 0.9), { x: Math.sin(a) * 1.15, y: 0, z: -Math.cos(a) * 1.15 }));
  }
  // branches and canopy blobs
  const top = new THREE.Vector3(lean * h, h - 2, 0);
  const blobs = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const out = rng.range(11, 18);
    const end = top.clone().add(new THREE.Vector3(Math.cos(a) * out, rng.range(3, 9), Math.sin(a) * out));
    const start = top.clone().add(new THREE.Vector3(0, -rng.range(6, 12), 0));
    const curve = new THREE.CatmullRomCurve3([start, start.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 3, 0)), end]);
    parts.add(new THREE.TubeGeometry(curve, 6, r * 0.28, 5, false), bark);
    blobs.push(end);
  }
  blobs.push(top.clone().add(new THREE.Vector3(0, 10, 0)));
  for (let i = 0; i < blobs.length; i++) {
    const br = i === blobs.length - 1 ? rng.range(14, 18) : rng.range(10, 14);
    parts.add(rock(rng, br, 1), leafMats[i % leafMats.length], mat(blobs[i].clone().add(new THREE.Vector3(0, 2, 0)), { x: rng.range(0, 3), y: rng.range(0, 3), z: 0 }, { x: 1.15, y: 0.75, z: 1.15 }));
    // glowing fruit hanging under each blob
    for (let k = 0; k < 4; k++) {
      const fa = rng.range(0, Math.PI * 2);
      const fp = blobs[i].clone().add(new THREE.Vector3(Math.cos(fa) * br * 0.7, -br * 0.45, Math.sin(fa) * br * 0.7));
      parts.add(new THREE.OctahedronGeometry(rng.range(0.6, 1.0), 0), fruitMat, mat(fp));
    }
  }
  const g = parts.build();
  return { group: g, height: h + 20, colliders: [{ x: 0, z: 0, r: r * 1.1, h }] };
}

function buildWreck(rng, pal, def, g) {
  const parts = new Parts();
  const hullCol = new THREE.Color(rng.pick(['#c9ced6', '#d8d2c4', '#bfc9d4']));
  const hull = std(hullCol, { flat: true, rough: 0.55, metal: 0.4 });
  const hullDark = std(hullCol.clone().multiplyScalar(0.55), { flat: true, rough: 0.6, metal: 0.4 });
  const stripe = std(new THREE.Color(rng.pick(['#ff8a3c', '#3cc8ff', '#ffcc3c', '#ff4f6a'])), { flat: true, rough: 0.5 });
  const dark = std(new THREE.Color('#262a33'), { flat: true, rough: 0.7, metal: 0.3 });
  const lampMat = glowMat('#ffb45e', 3);
  const len = rng.range(70, 95);
  const rad = rng.range(7, 10);
  // the whole ship is built along +X, then tilted into the ground
  const ship = new Parts();
  const body = new THREE.CylinderGeometry(rad, rad * 1.05, len, 8, 6);
  body.rotateZ(Math.PI / 2);
  ship.add(body, hull);
  const nose = new THREE.ConeGeometry(rad, rad * 2.4, 8);
  nose.rotateZ(-Math.PI / 2);
  nose.translate(len / 2 + rad * 1.2, 0, 0);
  ship.add(nose, hull);
  for (let i = 0; i < 4; i++) {
    const band = new THREE.CylinderGeometry(rad * 1.06, rad * 1.06, 2.2, 8);
    band.rotateZ(Math.PI / 2);
    band.translate(-len / 2 + len * (0.2 + i * 0.2), 0, 0);
    ship.add(band, i === 1 ? stripe : hullDark);
  }
  // engine block and nozzles at the back
  ship.add(new THREE.BoxGeometry(rad * 2, rad * 1.6, rad * 2.6), hullDark, mat(new THREE.Vector3(-len / 2 - rad * 0.6, 0, 0)));
  for (const [y, z] of [[rad * 0.45, rad * 0.6], [rad * 0.45, -rad * 0.6], [-rad * 0.45, 0]]) {
    const nz = new THREE.CylinderGeometry(rad * 0.35, rad * 0.5, rad * 1.2, 7);
    nz.rotateZ(Math.PI / 2);
    nz.translate(-len / 2 - rad * 2.1, y, z);
    ship.add(nz, dark);
  }
  // one wing still on, one snapped off and lying in the dirt
  ship.add(new THREE.BoxGeometry(len * 0.35, 1.2, rad * 3.2), hull, mat(new THREE.Vector3(-len * 0.1, -rad * 0.2, rad * 2.2), { x: 0.1, y: 0.2, z: 0 }));
  ship.add(new THREE.BoxGeometry(rad * 1.2, rad * 1.1, rad * 1.4), hullDark, mat(new THREE.Vector3(len * 0.12, rad * 0.9, 0)));
  const lamps = [];
  for (let i = 0; i < 5; i++) {
    const lp = new THREE.Vector3(-len / 2 + len * (0.15 + i * 0.18), rad * 0.95, rng.range(-1, 1) * rad * 0.4);
    ship.add(new THREE.OctahedronGeometry(0.5, 0), lampMat, mat(lp));
    lamps.push(lp);
  }
  const shipGroup = ship.build();
  const tilt = rng.range(0.12, 0.25);
  const roll = rng.range(0.15, 0.4);
  shipGroup.rotation.set(roll, 0, -tilt);
  shipGroup.position.y = rad * 0.35;
  const group = new THREE.Group();
  group.add(shipGroup);
  parts.add(new THREE.BoxGeometry(len * 0.32, 1.2, rad * 3), hull, mat(new THREE.Vector3(len * 0.1, 0.8, -rad * 3.2), { x: 0.3, y: 0.6, z: 0.15 }));
  // dug up ground ahead of where it came down
  const dirt = std(shade(new THREE.Color(pal.sand).lerp(new THREE.Color(pal.cliff), 0.5).getHex(), 0.85), { flat: true, rough: 0.95 });
  for (let i = 0; i < 14; i++) {
    const x = len * 0.5 + rad + i * 4 + rng.range(-2, 2), z = rng.range(-1, 1) * rad * 1.2;
    parts.add(rock(rng, rng.range(1.5, 4)), dirt, mat(new THREE.Vector3(x, g(x, z), z), { x: rng.range(0, 3), y: 0, z: 0 }, { x: 1.4, y: 0.6, z: 1 }));
  }
  for (let i = 0; i < 12; i++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(rad * 2, len * 0.7);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    parts.add(new THREE.BoxGeometry(rng.range(1, 4), rng.range(0.3, 1.2), rng.range(1, 3)), rng.chance(0.5) ? hull : hullDark, mat(new THREE.Vector3(x, g(x, z) + 0.2, z), { x: rng.range(0, 1), y: rng.range(0, 3), z: rng.range(0, 1) }));
  }
  parts.build(group);
  const colliders = [];
  for (let i = 0; i <= 6; i++) {
    const x = -len / 2 + (len * i) / 6;
    const gy = g(x * Math.cos(tilt), 0);
    colliders.push({ x: x * Math.cos(tilt), y: gy, z: 0, r: rad * 0.9, h: Math.max(2, rad * 1.4 + x * Math.sin(tilt) - gy) });
  }
  // the lamps blink out of step
  const lampMesh = shipGroup.children.find((c) => c.material === lampMat);
  const update = (t) => {
    if (lampMesh) lampMesh.visible = Math.sin(t * 2.2) > -0.3;
  };
  return { group, height: rad * 2 + 10, colliders, update };
}

const BUILDERS = { arch: buildArch, crystals: buildCrystals, bones: buildBones, isles: buildIsles, geysers: buildGeysers, tree: buildTree, wreck: buildWreck };

// returns { group, height, colliders: [{ x, y, z, r, h }], update?(time) }
// g(x, z) is the ground height at a local spot, flat ground if left out
export function buildWonder(kind, seed, def, g = () => 0) {
  const rng = new RNG(seed);
  return BUILDERS[kind](rng, def.palette, def, g);
}
