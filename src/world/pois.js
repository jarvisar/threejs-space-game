import * as THREE from 'three';
import { RNG, hash3 } from '../core/rng.js';
import { faceDir, forEachCellNear } from '../gen/terrain.js';
import { patchStandard } from '../render/materials.js';
import { LAYER_POST } from '../render/pipeline.js';
import { RESOURCES } from '../game/resources.js';
import { surfaceNormal, findLand } from './planet.js';
import { buildWonder, wonderKinds, wonderName, WONDERS } from './wonders.js';

const _v = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

// verb is the E prompt, deposits are mined instead
export const POI_INFO = {
  monolith: { label: 'Echo Stone', color: '#c9a2ff', verb: 'Listen to the Echo Stone' },
  deposit: { label: 'Deposit', color: '#7fe0ff' },
  cache: { label: 'Supply Pod', color: '#ffb45e', verb: 'Open the supply pod' },
  ruin: { label: 'Chorus Ruins', color: '#ffe9b0', verb: 'Take the shard' },
  beacon: { label: 'Signal Beacon', color: '#7dffb0', verb: 'Link to the beacon' },
  spire: { label: 'Chorus Spire', color: '#ffe9b0', verb: 'Touch the spire' },
  wonder: { label: 'Landmark', color: '#ffd98a', verb: 'Search the wreck' },
};

const WEIGHTS = {
  default: [['deposit', 0.3], ['monolith', 0.1], ['cache', 0.08], ['ruin', 0.04], ['beacon', 0.05]],
  barren: [['deposit', 0.4], ['monolith', 0.06], ['cache', 0.12], ['ruin', 0.03], ['beacon', 0.03]],
  dead: [['deposit', 0.45], ['monolith', 0.05], ['cache', 0.12], ['ruin', 0.02], ['beacon', 0.02]],
};

export function std(color, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.7, metalness: opts.metal ?? 0.1, emissive: opts.emissive || 0x000000, flatShading: !!opts.flat });
  return patchStandard(m, { key: opts.flat ? 'poi-flat' : 'poi' });
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
varying vec2 vUv;
void main() {
  #include <logdepthbuf_fragment>
  float edge = sin(vUv.x * 3.14159);
  float fall = pow(1.0 - vUv.y, 1.5);
  float pulse = 0.7 + 0.3 * sin(vUv.y * 40.0 - uTime * 3.0);
  gl_FragColor = vec4(uColor * edge * edge * fall * pulse * 2.5, 1.0);
}
`;

export function makeBeam(color, height, width) {
  const geo = new THREE.CylinderGeometry(width, width, height, 16, 1, true);
  geo.translate(0, height / 2, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 } },
    vertexShader: beamVert,
    fragmentShader: beamFrag,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(geo, mat);
  m.layers.set(LAYER_POST);
  m.frustumCulled = false;
  return m;
}

function buildMesh(poi, planet) {
  const g = new THREE.Group();
  const pal = planet.def.palette;
  const rng = new RNG(poi.seed);
  const glowCol = new THREE.Color(POI_INFO[poi.type].color);
  switch (poi.type) {
    case 'monolith': {
      const stone = std('#23202c', { rough: 0.55, metal: 0.3, flat: true });
      const geo = new THREE.BoxGeometry(1.6, 6.5, 0.9, 1, 4, 1);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const t = (p.getY(i) + 3.25) / 6.5;
        p.setX(i, p.getX(i) * (1 - t * 0.35));
        p.setZ(i, p.getZ(i) * (1 - t * 0.25));
      }
      geo.computeVertexNormals();
      geo.translate(0, 3.0, 0);
      const slab = new THREE.Mesh(geo, stone);
      slab.rotation.z = rng.range(-0.08, 0.08);
      g.add(slab);
      const glyph = new THREE.MeshBasicMaterial({ color: glowCol.clone().multiplyScalar(2.5) });
      for (let i = 0; i < 7; i++) {
        const w = rng.range(0.2, 0.9);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, 0.02), glyph);
        bar.position.set(rng.range(-0.3, 0.3), 1.2 + i * 0.65, 0.46 - (i * 0.65) / 26);
        slab.add(bar);
      }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 8, 40), glyph);
      ring.position.y = 8;
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      poi.spin = ring;
      poi.height = 7;
      poi.colRadius = 1.1;
      break;
    }
    case 'deposit': {
      const col = new THREE.Color(RESOURCES[poi.res].color);
      const crystal = std(col, { rough: 0.25, metal: 0.1, emissive: col.clone().multiplyScalar(0.35), flat: true });
      const base = std(pal.cliff, { rough: 0.9, flat: true });
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4, 1), base);
      rock.scale.set(1.4, 0.55, 1.3);
      g.add(rock);
      const n = rng.int(7, 11);
      for (let i = 0; i < n; i++) {
        const h = rng.range(1.5, 4.5) * (i === 0 ? 1.4 : 1);
        const r = rng.range(0.3, 0.6);
        const body = new THREE.CylinderGeometry(r, r, h, 6);
        body.translate(0, h / 2, 0);
        const tip = new THREE.ConeGeometry(r, r * 2, 6);
        tip.translate(0, h + r, 0);
        const m1 = new THREE.Mesh(body, crystal);
        const m2 = new THREE.Mesh(tip, crystal);
        const c = new THREE.Group();
        c.add(m1, m2);
        const a = rng.range(0, Math.PI * 2);
        const tilt = i === 0 ? 0 : rng.range(0.2, 0.7);
        c.position.set(Math.cos(a) * rng.range(0.2, 1.4), 0.2, Math.sin(a) * rng.range(0.2, 1.4));
        c.rotation.set(Math.cos(a) * tilt, 0, -Math.sin(a) * tilt);
        g.add(c);
      }
      poi.height = 4;
      poi.colRadius = 2.2;
      break;
    }
    case 'cache': {
      const hull = std('#c9ccd4', { metal: 0.5, rough: 0.4 });
      const dark = std('#2a2f38', { metal: 0.5, rough: 0.5 });
      const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 2.2, 6, 14), hull);
      pod.rotation.z = Math.PI / 2 - 0.35;
      pod.position.y = 0.6;
      g.add(pod);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.3, 14), dark);
      band.rotation.z = Math.PI / 2 - 0.35;
      band.position.y = 0.6;
      g.add(band);
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2, 0.6) }));
      light.position.set(0.3, 1.55, 0.2);
      g.add(light);
      poi.blink = light;
      for (let i = 0; i < 5; i++) {
        const d = new THREE.Mesh(new THREE.BoxGeometry(rng.range(0.2, 0.6), rng.range(0.1, 0.3), rng.range(0.2, 0.6)), dark);
        d.position.set(rng.range(-3, 3), 0.05, rng.range(-3, 3));
        d.rotation.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
        g.add(d);
      }
      poi.height = 2;
      poi.colRadius = 1.6;
      break;
    }
    case 'ruin': {
      const stone = std(new THREE.Color(pal.high).lerp(new THREE.Color('#d8d0c0'), 0.5), { rough: 0.85, flat: true });
      const n = rng.int(6, 9);
      poi.pillars = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const h = rng.chance(0.3) ? rng.range(0.8, 2) : rng.range(3, 6);
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, h, 7), stone);
        p.position.set(Math.cos(a) * 6.5, h / 2 - 0.2, Math.sin(a) * 6.5);
        p.rotation.set(rng.range(-0.08, 0.08), 0, rng.range(-0.08, 0.08));
        g.add(p);
        poi.pillars.push(p.position.clone());
      }
      const altar = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.5, 0.9, 8), stone);
      altar.position.y = 0.3;
      g.add(altar);
      const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), new THREE.MeshBasicMaterial({ color: glowCol.clone().multiplyScalar(3) }));
      shard.position.y = 2.2;
      shard.scale.set(0.7, 1.4, 0.7);
      g.add(shard);
      poi.spin = shard;
      poi.height = 3;
      poi.colRadius = 1.4;
      break;
    }
    case 'beacon': {
      const metal = std('#8f98a8', { metal: 0.6, rough: 0.4 });
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 6, 8), metal);
      mast.position.y = 3;
      g.add(mast);
      const legs = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.2, 3, 1, true), metal);
      legs.position.y = 0.6;
      g.add(legs);
      const glow = new THREE.MeshBasicMaterial({ color: glowCol.clone().multiplyScalar(3) });
      for (let i = 0; i < 3; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.35 - i * 0.08, 0.03, 6, 20), glow);
        ring.position.y = 3.5 + i * 0.9;
        ring.rotation.x = Math.PI / 2;
        g.add(ring);
      }
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), glow);
      top.position.y = 6.2;
      g.add(top);
      poi.blink = top;
      poi.height = 6;
      poi.colRadius = 0.6;
      break;
    }
    case 'spire': {
      const stone = std('#1d1a26', { rough: 0.45, metal: 0.35, flat: true });
      const geo = new THREE.CylinderGeometry(0.6, 4.5, 46, 6, 6);
      geo.translate(0, 23, 0);
      g.add(new THREE.Mesh(geo, stone));
      const glyph = new THREE.MeshBasicMaterial({ color: glowCol.clone().multiplyScalar(4) });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const line = new THREE.Mesh(new THREE.BoxGeometry(0.12, 40, 0.12), glyph);
        line.position.set(Math.cos(a) * 2.3, 21, Math.sin(a) * 2.3);
        line.rotation.set(Math.sin(a) * 0.085, 0, -Math.cos(a) * 0.085);
        g.add(line);
      }
      const base = new THREE.Mesh(new THREE.CylinderGeometry(9, 11, 1.2, 12), std('#2e2a36', { rough: 0.8, flat: true }));
      base.position.y = 0.2;
      g.add(base);
      const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 1), glyph);
      orb.position.y = 50;
      g.add(orb);
      poi.spin = orb;
      const beam = makeBeam(glowCol, 2400, 2.2);
      beam.position.y = 50;
      g.add(beam);
      poi.beam = beam;
      poi.height = 46;
      poi.colRadius = 4.2;
      break;
    }
  }
  g.traverse((o) => {
    if (o.isMesh && o.layers.mask === 1) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}

// Deterministic points of interest on a coarse grid of ~900 m cells. Only
// cells near the player are generated and only close ones get meshes.
export class PoiManager {
  constructor(game, planet) {
    this.game = game;
    this.planet = planet;
    const R = planet.radius;
    this.level = Math.max(2, Math.round(Math.log2((R * Math.PI) / 2 / 900)));
    this.cellSize = (R * Math.PI) / 2 / (1 << this.level);
    this.cells = new Map();
    this.group = new THREE.Group();
    planet.group.add(this.group);
    const st = game.state;
    if (!st.pois[planet.def.id]) st.pois[planet.def.id] = { revealed: [], used: [], mined: {} };
    this.record = st.pois[planet.def.id];
    // wonders the player has been close enough to see properly
    if (!this.record.found) this.record.found = [];
    this.special = [];
    if (planet.def.spire) this.addSpire();
    this.addWonders();
  }

  // A few big landmarks per planet on flat dry ground, spread out. Seeded by
  // the planet so they're always in the same places.
  addWonders() {
    const p = this.planet;
    const def = p.def;
    const kinds = wonderKinds(def.type);
    this.wonders = [];
    if (!kinds.length) return;
    const rng = new RNG((def.seed ^ 0xa11d) >>> 0);
    const count = def.isMoon ? rng.int(1, 2) : rng.int(3, 5);
    const dirs = [];
    const hint = this.game.wonderHint ? this.game.wonderHint(p) : null;
    const usedKinds = [];
    const names = new Set();
    for (let i = 0; i < count; i++) {
      // repeat a kind only once every kind the planet allows is used
      const fresh = kinds.filter((k) => !usedKinds.includes(k));
      const kind = i === 0 && hint ? hint.kind : rng.pick(fresh.length ? fresh : kinds);
      usedKinds.push(kind);
      let dir = null;
      const tries = i === 0 && hint ? hint.dirs.length + 60 : 60;
      for (let t = 0; t < tries && !dir; t++) {
        // hinted spots first, then anywhere
        const near = i === 0 && hint && t < hint.dirs.length;
        const d = near ? hint.dirs[t].clone() : randomDir(rng);
        if (p.heightAt(d) < 3) continue;
        if (surfaceNormal(p, d, 15).dot(d) < (near ? 0.9 : 0.94)) continue;
        if (dirs.some((o) => o.dot(d) > 0.985)) continue;
        dir = d;
      }
      if (!dir) continue;
      const seed = rng.seed();
      const poi = this.makePoi('wonder', dir, `w${i}`, seed);
      poi.kind = kind;
      let name = wonderName(kind, seed, def.name);
      for (let k = 1; names.has(name) && k < 8; k++) name = wonderName(kind, seed + k * 977, def.name);
      names.add(name);
      poi.name = name;
      poi.reach = WONDERS[kind].reach;
      this.special.push(poi);
      this.wonders.push(poi);
      dirs.push(dir);
    }
    const world = this.game.state.discoveries[def.id];
    if (world) world.wonderTotal = this.wonders.length;
  }

  isFound(poi) {
    return this.record.found.includes(poi.id);
  }

  addSpire() {
    const d = new THREE.Vector3().fromArray(this.planet.def.spire.dir).normalize();
    const land = findLand(this.planet, d, 3);
    const poi = this.makePoi('spire', land, 'spire', 42);
    poi.story = this.planet.def.spire.index;
    this.special.push(poi);
    if (!this.record.revealed.includes(poi.id)) this.record.revealed.push(poi.id);
  }

  makePoi(type, dir, id, seed) {
    const p = this.planet;
    const h = Math.max(0, p.heightAt(dir));
    const poi = {
      id,
      type,
      seed,
      dir: dir.clone(),
      pos: dir.clone().multiplyScalar(p.radius + h),
      mesh: null,
      res: null,
      hp: 1,
    };
    if (type === 'deposit') {
      const rng = new RNG(seed ^ 0x77);
      poi.res = rng.chance(0.55) ? p.def.resource : rng.pick(['hydrogel', 'ferrite', 'lumen', p.def.resource]);
      poi.amount = rng.int(50, 90);
    }
    return poi;
  }

  generateCell(face, x, y) {
    const p = this.planet;
    const seed = hash3(face * 131 + this.level, x, y, p.def.seed);
    const rng = new RNG(seed);
    const size = 2 / (1 << this.level);
    const table = WEIGHTS[p.def.type] || WEIGHTS.default;
    const out = [];
    for (let k = 0; k < 2; k++) {
      let type = null;
      let r = rng.next();
      for (const [t, w] of table) {
        if (r < w) {
          type = t;
          break;
        }
        r -= w;
      }
      const u = -1 + (x + rng.range(0.1, 0.9)) * size;
      const v = -1 + (y + rng.range(0.1, 0.9)) * size;
      const s2 = rng.seed();
      if (!type) continue;
      const d = faceDir(face, u, v, [0, 0, 0]);
      const dir = new THREE.Vector3(d[0], d[1], d[2]);
      const h = p.heightAt(dir);
      if (p.seaLevel !== null && h < 1.5) continue;
      if (surfaceNormal(p, dir, 3).dot(dir) < 0.9) continue;
      out.push(this.makePoi(type, dir, `${face}:${x}:${y}:${k}`, s2));
    }
    return out;
  }

  update(local, time) {
    if (!this.lastCellCheck || time - this.lastCellCheck > 1) {
      this.lastCellCheck = time;
      const near = [];
      forEachCellNear(this.planet.radius, this.level, _v.copy(local).normalize(), 4000, (f, x, y) => near.push([f, x, y]));
      const keep = new Set();
      for (const [f, x, y] of near) {
        const k = `${f}:${x}:${y}`;
        keep.add(k);
        if (!this.cells.has(k)) this.cells.set(k, this.generateCell(f, x, y));
      }
      for (const [k, list] of this.cells) {
        if (!keep.has(k)) {
          for (const poi of list) this.dropMesh(poi);
          this.cells.delete(k);
        }
      }
    }
    for (const poi of this.all()) {
      const d = _v.subVectors(poi.pos, local).length();
      const far = poi.type === 'spire' ? 1e9 : poi.type === 'wonder' ? 7000 : 1700;
      if (d < far && !poi.mesh && !this.isGone(poi)) this.addMesh(poi);
      else if (poi.mesh && (d > far + 300 || this.isGone(poi))) this.dropMesh(poi);
      if (poi.mesh) {
        if (poi.spin) poi.spin.rotation.y = time * 0.6;
        if (poi.blink) poi.blink.visible = Math.sin(time * 4 + poi.seed) > -0.2;
        if (poi.beam) poi.beam.material.uniforms.uTime.value = time;
        if (poi.anim && d < 2500) poi.anim(time);
      }
      if (poi.type === 'wonder') {
        // big enough to spot by eye, so it gets a marker once it's close
        if (d < 1600 && !this.isRevealed(poi)) this.record.revealed.push(poi.id);
        if (d < poi.reach + 30 && !this.isFound(poi)) {
          this.record.found.push(poi.id);
          this.game.discoverWonder(poi, this.planet);
        }
      }
    }
  }

  *all() {
    for (const p of this.special) yield p;
    for (const list of this.cells.values()) for (const p of list) yield p;
  }

  isGone(poi) {
    return poi.type === 'deposit' && (this.record.mined[poi.id] || 0) >= poi.amount;
  }

  isUsed(poi) {
    return this.record.used.includes(poi.id);
  }

  isRevealed(poi) {
    return this.record.revealed.includes(poi.id);
  }

  addMesh(poi) {
    const up = poi.dir;
    const q = new THREE.Quaternion().setFromUnitVectors(Y, up);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(Y, new RNG(poi.seed).range(0, Math.PI * 2)));
    // wonders span tens of meters of uneven ground, sink them a bit more
    const base = poi.pos.clone().addScaledVector(up, poi.type === 'wonder' ? -1.2 : -0.3);
    let m;
    if (poi.type === 'wonder') {
      // ground height at a spot in the wonder's own frame, relative to its origin
      const planet = this.planet;
      const p = new THREE.Vector3();
      const ground = (x, z) => {
        p.set(x, 0, z).applyQuaternion(q).add(base);
        const r = p.length();
        return planet.floorRadius(p.divideScalar(r)) - r;
      };
      const w = buildWonder(poi.kind, poi.seed, planet.def, ground);
      m = w.group;
      poi.height = w.height;
      poi.wColliders = w.colliders;
      poi.anim = w.update || null;
    } else m = buildMesh(poi, this.planet);
    m.position.copy(base);
    m.quaternion.copy(q);
    this.group.add(m);
    poi.mesh = m;
  }

  dropMesh(poi) {
    if (!poi.mesh) return;
    this.group.remove(poi.mesh);
    poi.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material.dispose) o.material.dispose();
    });
    poi.mesh = null;
    poi.spin = null;
    poi.blink = null;
    poi.beam = null;
    poi.anim = null;
  }

  // scanner reveal, returns newly revealed pois
  reveal(local, radius, types) {
    const fresh = [];
    for (const poi of this.all()) {
      if (types && !types.includes(poi.type)) continue;
      if (this.isRevealed(poi) || this.isGone(poi)) continue;
      if (_v.subVectors(poi.pos, local).length() > radius) continue;
      this.record.revealed.push(poi.id);
      fresh.push(poi);
    }
    return fresh;
  }

  markers(local) {
    const out = [];
    for (const poi of this.all()) {
      if (!this.isRevealed(poi) || this.isGone(poi)) continue;
      if (poi.type === 'wonder') {
        // found wonders keep a marker, except a searched wreck
        if (poi.kind !== 'wreck' || !this.isUsed(poi)) out.push(poi);
        continue;
      }
      if (poi.type !== 'deposit' && poi.type !== 'spire' && this.isUsed(poi)) continue;
      out.push(poi);
    }
    return out;
  }

  raycast(origin, dir, range) {
    let best = null;
    for (const poi of this.all()) {
      if (!poi.mesh || poi.type === 'wonder') continue;
      const up = poi.dir;
      const c = _v.copy(poi.pos).addScaledVector(up, Math.min(poi.height * 0.45, 3));
      const r = poi.type === 'spire' ? 5 : poi.type === 'deposit' ? 2.8 : 1.6;
      const oc = c.sub(origin);
      const b = oc.dot(dir);
      if (b < 0 || b > range + r) continue;
      const c2 = oc.lengthSq() - b * b;
      if (c2 > r * r) continue;
      const t = b - Math.sqrt(r * r - c2);
      if (!best || t < best.t) best = { t, poi };
    }
    return best;
  }

  nearestInteractive(local, maxDist) {
    let best = null;
    let bd = maxDist;
    for (const poi of this.all()) {
      if (poi.type === 'deposit' || !poi.mesh) continue;
      // of the wonders only the wreck has anything to search
      if (poi.type === 'wonder' && poi.kind !== 'wreck') continue;
      const d = _v.subVectors(poi.pos, local).length() - (poi.type === 'spire' ? 10 : poi.type === 'ruin' ? 3 : poi.type === 'wonder' ? 14 : 0);
      if (d < bd) {
        bd = d;
        best = poi;
      }
    }
    return best;
  }

  describe(poi) {
    const info = POI_INFO[poi.type];
    if (poi.type === 'wonder') return { name: poi.name, sub: this.isUsed(poi) ? 'Already searched' : 'Press E to search' };
    if (poi.type === 'deposit') {
      const left = poi.amount - (this.record.mined[poi.id] || 0);
      return { name: `${RESOURCES[poi.res].name} Deposit`, sub: `${left} units remaining` };
    }
    return { name: info.label, sub: this.isUsed(poi) ? 'Already explored' : 'Press E to interact' };
  }

  mine(poi, dt, power) {
    if (poi.type !== 'deposit' || this.game.isFull(poi.res)) return null;
    const rec = this.record.mined;
    poi.acc = (poi.acc || 0) + dt * power * 9;
    const want = Math.min(Math.floor(poi.acc), poi.amount - (rec[poi.id] || 0));
    if (want > 0) {
      poi.acc -= want;
      // with a full hold the rest stays in the ground
      rec[poi.id] = (rec[poi.id] || 0) + this.game.gain(poi.res, want, true);
    }
    const left = poi.amount - (rec[poi.id] || 0);
    if (left <= 0) {
      this.game.effects.burst(this.planet, poi.pos.clone().addScaledVector(poi.dir, 2), RESOURCES[poi.res].color, 4);
      this.dropMesh(poi);
      return { done: true, progress: 1 };
    }
    return { done: false, progress: 1 - left / poi.amount };
  }

  markUsed(poi) {
    if (!this.record.used.includes(poi.id)) this.record.used.push(poi.id);
  }

  collidersNear(local, r, out) {
    for (const poi of this.all()) {
      if (poi.wColliders && poi.mesh) {
        if (_v.subVectors(poi.pos, local).length() > r + poi.reach + 20) continue;
        for (const c of poi.wColliders) {
          const lp = new THREE.Vector3(c.x, c.y || 0, c.z).applyQuaternion(poi.mesh.quaternion).add(poi.mesh.position);
          if (_v.subVectors(lp, local).length() > r + c.r + 4) continue;
          out.push({ pos: lp, radius: c.r, height: c.h + 1.2 });
        }
        continue;
      }
      if (!poi.mesh || !poi.colRadius) continue;
      if (_v.subVectors(poi.pos, local).length() > r + 10) continue;
      out.push({ pos: poi.pos, radius: poi.colRadius, height: poi.height });
      if (poi.pillars) {
        for (const pp of poi.pillars) {
          const lp = pp.clone().applyQuaternion(poi.mesh.quaternion).add(poi.mesh.position);
          out.push({ pos: lp, radius: 0.55, height: 5 });
        }
      }
    }
    return out;
  }

  dispose() {
    for (const poi of this.all()) this.dropMesh(poi);
    this.planet.group.remove(this.group);
  }
}

function randomDir(rng) {
  const z = rng.range(-0.85, 0.85);
  const t = rng.range(0, Math.PI * 2);
  const r = Math.sqrt(1 - z * z);
  return new THREE.Vector3(r * Math.cos(t), z, r * Math.sin(t));
}
