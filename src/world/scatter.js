import * as THREE from 'three';
import { forEachCellNear } from '../gen/terrain.js';
import { placementFields } from '../gen/flora.js';
import { buildSpeciesGeometry, materialKind } from './floraGeometry.js';
import { patchStandard } from '../render/materials.js';
import { RESOURCES } from '../game/resources.js';

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

const NEAR_RADIUS = 110;
const FAR_RADIUS = 620;
const BIG_DIST = 300;
const SHADOW_RADIUS = 90;

export function floraMaterial(kind, maxDist) {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: kind === 'crystal' ? 0.3 : kind === 'rock' ? 0.92 : 0.8,
    metalness: kind === 'crystal' ? 0.1 : 0,
    flatShading: kind !== 'plant',
    side: kind === 'plant' ? THREE.DoubleSide : THREE.FrontSide,
  });
  const uniforms = { uMaxDist: { value: maxDist } };
  patchStandard(m, {
    key: `flora-${kind}`,
    // grass blades are seen edge on all the time, a full rim makes them glow
    rim: kind === 'plant' ? 0.2 : 0.5,
    uniforms,
    vertexPars: /* glsl */ `
      attribute float aSway;
      attribute float aGlow;
      varying float vGlow;
      uniform float uMaxDist;
    `,
    vertexBegin: /* glsl */ `
      vGlow = aGlow;
      {
        vec3 iLocal = instanceMatrix[3].xyz;
        vec3 iPos = (modelMatrix * vec4(iLocal, 1.0)).xyz;
        float dist = length(iPos);
        float fade = 1.0 - smoothstep(uMaxDist * 0.72, uMaxDist, dist);
        transformed *= fade;
        float ph = iLocal.x * 0.37 + iLocal.z * 0.23 + iLocal.y * 0.11;
        vec2 w = vec2(sin(uTime * 1.4 + ph), cos(uTime * 1.1 + ph * 1.3)) * aSway * (0.05 + uWind * 0.12);
        transformed.xz += w;
      }
    `,
    fragmentPars: /* glsl */ `varying float vGlow;`,
    // thin leaves and grass should shade the same from both sides
    normal: kind === 'plant' ? 'normal = normalize(vNormal);' : '',
    emissive: /* glsl */ `
      {
        vec3 upG = normalize(vWorldPosP - uAmbCenter);
        float nightK = 1.0 - smoothstep(-0.12, 0.18, dot(upG, normalize(uSunPos - uAmbCenter)));
        totalEmissiveRadiance += vColor.rgb * vGlow * (0.18 + nightK * 1.6);
      }
    `,
  });
  return m;
}

// One InstancedMesh per species where each cell owns a contiguous range of
// slots. Adding or dropping a cell only uploads that range, so streaming
// cells in doesn't re-send every instance to the GPU. Freed slots are zeroed
// (zero scale draws nothing) and reused.
class SlotMesh {
  constructor(parent, geo, mat, withColor) {
    this.parent = parent;
    this.geo = geo;
    this.mat = mat;
    this.withColor = withColor;
    this.ranges = new Map();
    this.free = [];
    this.top = 0;
    this.cap = 0;
    this.mesh = null;
    this.make(256);
  }

  make(cap) {
    const old = this.mesh;
    const m = new THREE.InstancedMesh(this.geo, this.mat, cap);
    m.frustumCulled = false;
    m.castShadow = false;
    m.receiveShadow = true;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceMatrix.array.fill(0);
    if (this.withColor) {
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    if (old) {
      m.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, this.top * 16));
      if (this.withColor) m.instanceColor.array.set(old.instanceColor.array.subarray(0, this.top * 3));
      this.parent.remove(old);
      old.dispose();
    }
    m.count = this.top;
    this.parent.add(m);
    this.mesh = m;
    this.cap = cap;
  }

  alloc(n) {
    for (let i = 0; i < this.free.length; i++) {
      const f = this.free[i];
      if (f.count >= n) {
        const start = f.start;
        f.start += n;
        f.count -= n;
        if (f.count === 0) this.free.splice(i, 1);
        return start;
      }
    }
    if (this.top + n > this.cap) {
      let cap = this.cap;
      while (cap < this.top + n) cap *= 2;
      this.make(cap);
    }
    const start = this.top;
    this.top += n;
    this.mesh.count = this.top;
    return start;
  }

  has(key) {
    return this.ranges.has(key);
  }

  set(key, n, write) {
    if (this.ranges.has(key)) this.release(key);
    if (n === 0) {
      this.ranges.set(key, { start: 0, count: 0 });
      return;
    }
    const start = this.alloc(n);
    this.ranges.set(key, { start, count: n });
    const mats = this.mesh.instanceMatrix;
    write(mats.array, start, this.withColor ? this.mesh.instanceColor.array : null);
    mats.addUpdateRange(start * 16, n * 16);
    mats.needsUpdate = true;
    if (this.withColor) {
      this.mesh.instanceColor.addUpdateRange(start * 3, n * 3);
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  release(key) {
    const r = this.ranges.get(key);
    if (!r) return;
    this.ranges.delete(key);
    if (!r.count) return;
    const mats = this.mesh.instanceMatrix;
    mats.array.fill(0, r.start * 16, (r.start + r.count) * 16);
    mats.addUpdateRange(r.start * 16, r.count * 16);
    mats.needsUpdate = true;
    this.free.push({ start: r.start, count: r.count });
    this.mergeFree();
  }

  mergeFree() {
    this.free.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const f of this.free) {
      const last = merged[merged.length - 1];
      if (last && last.start + last.count === f.start) last.count += f.count;
      else merged.push({ ...f });
    }
    // give back space at the end so the draw count shrinks
    const tail = merged[merged.length - 1];
    if (tail && tail.start + tail.count === this.top) {
      this.top = tail.start;
      merged.pop();
      this.mesh.count = this.top;
    }
    this.free = merged;
  }

  zero(key, k) {
    const r = this.ranges.get(key);
    if (!r || k >= r.count) return;
    const mats = this.mesh.instanceMatrix;
    const o = (r.start + k) * 16;
    mats.array.fill(0, o, o + 16);
    mats.addUpdateRange(o, 16);
    mats.needsUpdate = true;
  }

  dispose() {
    this.parent.remove(this.mesh);
    this.mesh.dispose();
  }
}

// Streams flora/rock instances around the player for one planet. Cells are
// quadtree nodes at a fixed level (about 60-80 m across). Instance matrices are
// in planet-local space, float32 is still sub-millimeter at planet radius.
export class Scatter {
  constructor(planet, pool, species) {
    this.planet = planet;
    this.pool = pool;
    this.species = species;
    const R = planet.radius;
    this.level = Math.max(3, Math.round(Math.log2((R * Math.PI) / 2 / 70)));
    this.cellSize = (R * Math.PI) / 2 / (1 << this.level);
    this.cells = new Map();
    this.removed = new Set(planet.minedSet || []);
    this.group = new THREE.Group();
    this.group.name = 'scatter';
    planet.group.add(this.group);
    this.slots = [];
    this.shadows = [];
    this.bigFields = [];
    this.smallFields = [];
    this.lastSync = -1;
    this.dataChanged = true;
    this.shadowKey = '';
    this.clearing = null;

    for (const sp of species) {
      const resColor = RESOURCES[sp.res] ? RESOURCES[sp.res].color : '#6fd6ff';
      const geo = buildSpeciesGeometry(sp, resColor);
      sp.radius = geo.boundingSphere.radius;
      sp.height = geo.boundingBox.max.y;
      sp.big = sp.maxDist > BIG_DIST;
      const mat = floraMaterial(materialKind(sp.kind), sp.maxDist);
      this.slots.push(new SlotMesh(this.group, geo, mat, true));
      // small near-player copy that only draws into the shadow map. three
      // tests shadow casters against the main camera's layers, so instead of
      // a separate layer the instance count is zeroed for the main pass.
      if (sp.kind !== 'grass' && sp.kind !== 'flower') {
        const sm = new THREE.InstancedMesh(geo, mat, 512);
        sm.count = 0;
        sm.userData.count = 0;
        sm.frustumCulled = false;
        sm.castShadow = true;
        sm.receiveShadow = false;
        sm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        sm.onBeforeShadow = () => {
          sm.count = sm.userData.count;
        };
        sm.onBeforeRender = () => {
          sm.count = 0;
        };
        this.group.add(sm);
        this.shadows.push(sm);
      } else this.shadows.push(null);
      (sp.big ? this.bigFields : this.smallFields).push({ ...placementFields(sp), spIndex: sp.index });
    }
  }

  key(face, x, y) {
    return `${face}:${x}:${y}`;
  }

  // Hides everything within radius of a planet-local point, so rocks and trees
  // don't poke through the landed ship. null clears it.
  setClearing(pos, radius) {
    const old = this.clearing;
    if (!pos && !old) return;
    if (pos && old && old.pos.distanceToSquared(pos) < 0.25) return;
    this.clearing = pos ? { pos: pos.clone(), r2: radius * radius } : null;
    // refill the cells around the old and new spot
    for (const c of [old, this.clearing]) {
      if (!c) continue;
      for (const cell of this.cells.values()) {
        if (cell.center && cell.center.distanceTo(c.pos) < this.cellSize * 1.5) for (const slot of this.slots) slot.release(cell.key);
      }
    }
    this.shadowKey = '';
    this.dataChanged = true;
  }

  // mined, or inside the clearing. Builds the id string only when something
  // was mined, this runs for every instance when cells fill.
  hidden(cellKey, s, k, pos) {
    if (this.removed.size && this.removed.has(`${cellKey}:${s}:${k}`)) return true;
    const c = this.clearing;
    if (!c) return false;
    const dx = pos[k * 3] - c.pos.x, dy = pos[k * 3 + 1] - c.pos.y, dz = pos[k * 3 + 2] - c.pos.z;
    return dx * dx + dy * dy + dz * dz < c.r2;
  }

  update(local, time) {
    // cell bookkeeping is cheap but not free, a few times a second is plenty
    if (time - this.lastSync < 0.2 && !this.dataChanged) return;
    this.lastSync = time;
    this.dataChanged = false;

    const wanted = [];
    forEachCellNear(this.planet.radius, this.level, _v.copy(local).normalize(), FAR_RADIUS, (face, x, y, dist) => wanted.push({ face, x, y, dist }));
    const keep = new Set();
    for (const c of wanted) {
      const k = this.key(c.face, c.x, c.y);
      keep.add(k);
      let cell = this.cells.get(k);
      if (!cell) {
        cell = { key: k, face: c.face, x: c.x, y: c.y, big: null, small: null, bigJob: null, smallJob: null, dist: c.dist, center: null };
        this.cells.set(k, cell);
      }
      cell.dist = c.dist;
      if (!cell.big && !cell.bigJob && this.bigFields.length) this.requestCell(cell, 'big');
      if (c.dist < NEAR_RADIUS + this.cellSize && !cell.small && !cell.smallJob && this.smallFields.length) this.requestCell(cell, 'small');
      // drop small data when far so memory stays flat
      if (c.dist > NEAR_RADIUS + this.cellSize * 2.5 && cell.small) cell.small = null;
    }
    for (const [k, cell] of this.cells) {
      if (!keep.has(k)) {
        if (cell.bigJob) this.pool.cancel(cell.bigJob);
        if (cell.smallJob) this.pool.cancel(cell.smallJob);
        this.cells.delete(k);
        for (const s of this.slots) s.release(k);
      }
    }
    this.syncSlots();
    this.syncShadows(local);
  }

  // make the slot meshes match what each cell should show, nearest first and
  // a limited number of uploads per call
  syncSlots() {
    const adds = [];
    for (const cell of this.cells.values()) {
      for (let s = 0; s < this.species.length; s++) {
        const sp = this.species[s];
        const data = sp.big ? cell.big : cell.small;
        const want = !!data && cell.dist <= sp.maxDist + this.cellSize;
        const slot = this.slots[s];
        const has = slot.has(cell.key);
        if (want && !has) adds.push({ cell, s, data });
        else if (!want && has) slot.release(cell.key);
      }
    }
    adds.sort((a, b) => a.cell.dist - b.cell.dist);
    const budget = 24;
    for (let i = 0; i < adds.length && i < budget; i++) this.fillSlot(adds[i].cell, adds[i].s, adds[i].data);
    if (adds.length > budget) this.dataChanged = true;
  }

  fillSlot(cell, s, data) {
    const d = data.find((x) => x.sp === s);
    const slot = this.slots[s];
    if (!d) {
      slot.set(cell.key, 0);
      return;
    }
    const sp = this.species[s];
    const tint = sp.plant || sp.kind === 'crystal';
    const ox = cell.center.x, oy = cell.center.y, oz = cell.center.z;
    slot.set(cell.key, d.count, (arr, start, col) => {
      for (let k = 0; k < d.count; k++) {
        const dst = (start + k) * 16;
        if (this.hidden(cell.key, s, k, d.pos)) {
          arr.fill(0, dst, dst + 16);
          continue;
        }
        const src = k * 16;
        for (let j = 0; j < 12; j++) arr[dst + j] = d.mats[src + j];
        arr[dst + 12] = d.mats[src + 12] + ox;
        arr[dst + 13] = d.mats[src + 13] + oy;
        arr[dst + 14] = d.mats[src + 14] + oz;
        arr[dst + 15] = 1;
        if (col) {
          const c = (start + k) * 3;
          if (tint) {
            const h = ((k * 2654435761) >>> 0) / 4294967296;
            col[c] = 0.86 + h * 0.28;
            col[c + 1] = 0.86 + ((h * 7.13) % 1) * 0.28;
            col[c + 2] = 0.86 + ((h * 3.71) % 1) * 0.28;
          } else col[c] = col[c + 1] = col[c + 2] = 1;
        }
      }
    });
  }

  // refill the shadow caster copies from cells right around the player
  syncShadows(local) {
    const near = [];
    for (const cell of this.cells.values()) if (cell.center && cell.big && cell.dist < SHADOW_RADIUS + this.cellSize) near.push(cell);
    const key = near.map((c) => c.key).sort().join('|') + ':' + this.removed.size;
    if (key === this.shadowKey) return;
    this.shadowKey = key;
    for (let s = 0; s < this.species.length; s++) {
      const mesh = this.shadows[s];
      if (!mesh) continue;
      const sp = this.species[s];
      let n = 0;
      let arr = mesh.instanceMatrix.array;
      for (const cell of near) {
        const data = sp.big ? cell.big : cell.small;
        if (!data) continue;
        const d = data.find((x) => x.sp === s);
        if (!d) continue;
        for (let k = 0; k < d.count; k++) {
          if (this.hidden(cell.key, s, k, d.pos)) continue;
          if (n >= mesh.instanceMatrix.count) break;
          const src = k * 16, dst = n * 16;
          for (let j = 0; j < 12; j++) arr[dst + j] = d.mats[src + j];
          arr[dst + 12] = d.mats[src + 12] + cell.center.x;
          arr[dst + 13] = d.mats[src + 13] + cell.center.y;
          arr[dst + 14] = d.mats[src + 14] + cell.center.z;
          arr[dst + 15] = 1;
          n++;
        }
      }
      mesh.userData.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  requestCell(cell, tier) {
    const fields = tier === 'big' ? this.bigFields : this.smallFields;
    const job = this.pool.request(
      { type: 'scatter', planetId: this.planet.def.id, face: cell.face, level: this.level, x: cell.x, y: cell.y, species: fields },
      () => (tier === 'small' ? cell.dist * 0.4 : cell.dist + 30),
      (res) => {
        if (tier === 'big') cell.bigJob = null;
        else cell.smallJob = null;
        if (this.disposed || !this.cells.has(cell.key)) return;
        cell.center = new THREE.Vector3().fromArray(res.center);
        cell[tier] = this.unpack(cell, res, fields);
        this.dataChanged = true;
      }
    );
    if (tier === 'big') cell.bigJob = job;
    else cell.smallJob = job;
  }

  // worker gives pos/up/scale/rot per instance, turn that into matrices once
  unpack(cell, res, fields) {
    const out = [];
    for (let i = 0; i < res.species.length; i++) {
      const r = res.species[i];
      const sp = this.species[fields[i].spIndex];
      const n = r.count;
      const mats = new Float32Array(n * 16);
      const pos = new Float32Array(n * 3);
      const scales = new Float32Array(n);
      for (let k = 0; k < n; k++) {
        const o = k * 8;
        _up.set(r.data[o + 3], r.data[o + 4], r.data[o + 5]);
        _q.setFromUnitVectors(Y, _up);
        _q.multiply(_q2.setFromAxisAngle(Y, r.data[o + 7]));
        _s.setScalar(r.data[o + 6]);
        _m.compose(_v.set(r.data[o], r.data[o + 1], r.data[o + 2]), _q, _s);
        _m.toArray(mats, k * 16);
        pos[k * 3] = r.data[o] + cell.center.x;
        pos[k * 3 + 1] = r.data[o + 1] + cell.center.y;
        pos[k * 3 + 2] = r.data[o + 2] + cell.center.z;
        scales[k] = r.data[o + 6];
      }
      out.push({ sp: sp.index, count: n, mats, pos, scales });
    }
    return out;
  }

  // nearest instance hit by a ray (planet-local), within maxDist
  raycast(origin, dir, maxDist) {
    let best = null;
    for (const cell of this.cells.values()) {
      if (!cell.center) continue;
      if (_v.subVectors(cell.center, origin).length() > maxDist + this.cellSize) continue;
      for (const tier of ['big', 'small']) {
        const data = cell[tier];
        if (!data) continue;
        for (const d of data) {
          const sp = this.species[d.sp];
          for (let k = 0; k < d.count; k++) {
            const px = d.pos[k * 3], py = d.pos[k * 3 + 1], pz = d.pos[k * 3 + 2];
            const s = d.scales[k];
            // sphere around the middle of the object
            const up = _up.set(px, py, pz).normalize();
            const hc = sp.height * s * 0.45;
            const cx = px + up.x * hc - origin.x, cy = py + up.y * hc - origin.y, cz = pz + up.z * hc - origin.z;
            const r = Math.max(0.35, Math.min(sp.radius, sp.height * 0.6) * s * 0.75);
            const b = cx * dir.x + cy * dir.y + cz * dir.z;
            if (b < 0 || b > maxDist + r) continue;
            const c2 = cx * cx + cy * cy + cz * cz - b * b;
            if (c2 > r * r) continue;
            const t = b - Math.sqrt(r * r - c2);
            if (!best || t < best.t) {
              if (this.hidden(cell.key, d.sp, k, d.pos)) continue;
              best = { t, id: `${cell.key}:${d.sp}:${k}`, species: sp, scale: s, pos: new THREE.Vector3(px, py, pz), center: new THREE.Vector3(cx + origin.x, cy + origin.y, cz + origin.z), radius: r };
            }
          }
        }
      }
    }
    return best;
  }

  // trunks and boulders near a point, for walker collision
  collidersNear(local, radius, out) {
    for (const cell of this.cells.values()) {
      if (!cell.center || !cell.big) continue;
      if (_v.subVectors(cell.center, local).length() > radius + this.cellSize) continue;
      for (const d of cell.big) {
        const sp = this.species[d.sp];
        if (!sp.collider) continue;
        for (let k = 0; k < d.count; k++) {
          const px = d.pos[k * 3], py = d.pos[k * 3 + 1], pz = d.pos[k * 3 + 2];
          const dx = px - local.x, dy = py - local.y, dz = pz - local.z;
          if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
          if (this.hidden(cell.key, d.sp, k, d.pos)) continue;
          out.push({ pos: new THREE.Vector3(px, py, pz), radius: sp.collider * d.scales[k], height: sp.colH * d.scales[k] });
        }
      }
    }
    return out;
  }

  // id is `${cellKey}:${species}:${index}`, the cell key itself has colons
  remove(id) {
    this.removed.add(id);
    const parts = id.split(':');
    const k = parseInt(parts.pop(), 10);
    const s = parseInt(parts.pop(), 10);
    const cellKey = parts.join(':');
    if (this.slots[s]) this.slots[s].zero(cellKey, k);
    this.shadowKey = '';
    this.dataChanged = true;
  }

  dispose() {
    this.disposed = true;
    for (const c of this.cells.values()) {
      if (c.bigJob) this.pool.cancel(c.bigJob);
      if (c.smallJob) this.pool.cancel(c.smallJob);
    }
    for (const s of this.slots) {
      s.dispose();
      s.geo.dispose();
      s.mat.dispose();
    }
    for (const m of this.shadows) if (m) m.dispose();
    this.planet.group.remove(this.group);
  }
}
