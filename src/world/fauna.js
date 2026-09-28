import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG, hashCombine } from '../core/rng.js';
import { speciesName } from '../gen/names.js';
import { patchStandard } from '../render/materials.js';

// Procedural creatures: grazers that wander in herds, flocks of flyers and
// drifting floaters. Only a few dozen exist at once, all near the player, so
// behaviour runs on the CPU and the animation (legs, wings, tentacles) is
// done in the vertex shader from per-vertex part ids.

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

const LABELS = { grazer: 'Grazer', flyer: 'Flyer', floater: 'Drifter', leviathan: 'Leviathan' };

const FAUNA_TYPES = {
  lush: [['grazer', 3], ['flyer', 2], ['floater', 1]],
  ocean: [['flyer', 3], ['grazer', 2], ['floater', 1]],
  desert: [['grazer', 3], ['flyer', 1]],
  frozen: [['grazer', 3], ['flyer', 1], ['floater', 1]],
  volcanic: [['flyer', 2], ['grazer', 1]],
  toxic: [['floater', 3], ['grazer', 2], ['flyer', 1]],
  radioactive: [['grazer', 2], ['floater', 2]],
  barren: [['grazer', 1]],
  exotic: [['floater', 3], ['flyer', 2], ['grazer', 2]],
};

export function faunaSpecies(def) {
  if (def.kind !== 'rocky' || !def.faunaDensity || !def.atmosphere) return [];
  const rng = new RNG(hashCombine(def.seed, 4242));
  const table = FAUNA_TYPES[def.type] || [];
  const n = def.faunaDensity > 0.7 ? 3 : def.faunaDensity > 0.35 ? 2 : def.faunaDensity > 0.1 ? 1 : 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    const kind = rng.weighted(table);
    const seed = hashCombine(def.seed, 5000 + i);
    const r = new RNG(seed);
    const pal = def.palette;
    const colors = [pal.leaf[r.int(0, 2)], pal.high, pal.low, pal.veg2 || pal.sand];
    out.push({
      id: `${def.id}:fauna:${i}`,
      kind,
      label: LABELS[kind],
      seed,
      name: speciesName(seed ^ 0x999),
      plant: false,
      fauna: true,
      body: r.pick(colors),
      belly: r.pick(colors),
      accent: pal.glow,
      size: kind === 'grazer' ? r.range(0.7, 2.2) : kind === 'flyer' ? r.range(0.5, 1.4) : r.range(0.8, 2.0),
      legs: r.chance(0.3) ? 6 : 4,
      legLen: r.range(0.6, 1.4),
      neck: r.range(0.2, 1.0),
      horns: r.chance(0.4),
      tail: r.range(0.3, 1.2),
      glow: r.chance(0.5),
      group: kind === 'grazer' ? r.int(3, 7) : kind === 'flyer' ? r.int(5, 12) : r.int(2, 5),
      speed: kind === 'grazer' ? r.range(1.2, 2.6) : kind === 'flyer' ? r.range(6, 12) : r.range(0.4, 1.0),
    });
  }
  // the occasional sky leviathan, a huge slow flyer circling far overhead
  if (['lush', 'ocean', 'exotic'].includes(def.type) && rng.chance(0.45)) {
    const seed = hashCombine(def.seed, 5999);
    const r = new RNG(seed);
    const pal = def.palette;
    out.push({
      id: `${def.id}:fauna:leviathan`,
      kind: 'leviathan',
      label: LABELS.leviathan,
      seed,
      name: speciesName(seed ^ 0x777),
      plant: false,
      fauna: true,
      body: pal.leaf[r.int(0, 2)],
      belly: pal.sand,
      accent: pal.glow,
      size: r.range(24, 38),
      glow: true,
      group: 1,
      speed: 0,
    });
  }
  return out;
}

function tagged(geo, color, part, extra = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const c = new THREE.Color(color);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
  g.setAttribute('aExtra', new THREE.BufferAttribute(new Float32Array(n).fill(extra), 1));
  return g;
}

function blob(r, sx, sy, sz, detail = 1) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  g.scale(sx, sy, sz);
  return g;
}

// Part ids: 0 body, 1..6 legs (extra = hip height), 10 wing (extra = side),
// 20 tentacle (extra = phase), 30 glow
function buildGrazer(sp) {
  const parts = [];
  const L = sp.legLen;
  const bodyY = L + 0.35;
  parts.push(tagged(blob(0.6, 1.5, 0.85, 0.9), sp.body, 0).translate(0, bodyY, 0));
  parts.push(tagged(blob(0.45, 1.3, 0.5, 0.8), sp.belly, 0).translate(0, bodyY - 0.22, 0));
  const neckLen = sp.neck;
  const neck = new THREE.CylinderGeometry(0.16, 0.24, neckLen + 0.2, 6);
  neck.rotateX(-0.9);
  parts.push(tagged(neck, sp.body, 0).translate(0, bodyY + 0.25 + neckLen * 0.3, -0.8));
  const hy = bodyY + 0.3 + neckLen * 0.6;
  const hz = -1.0 - neckLen * 0.5;
  parts.push(tagged(blob(0.3, 1.0, 0.85, 1.35), sp.body, 0).translate(0, hy, hz));
  for (const s of [-1, 1]) {
    parts.push(tagged(new THREE.IcosahedronGeometry(0.07, 0), sp.accent, 30).translate(s * 0.17, hy + 0.08, hz - 0.28));
    if (sp.horns) {
      const horn = new THREE.ConeGeometry(0.06, 0.45, 5);
      horn.rotateZ(s * -0.5);
      horn.rotateX(0.4);
      parts.push(tagged(horn, sp.belly, 0).translate(s * 0.15, hy + 0.35, hz + 0.05));
    }
  }
  const tail = new THREE.ConeGeometry(0.14, sp.tail, 5);
  tail.rotateX(Math.PI / 2 + 0.5);
  parts.push(tagged(tail, sp.body, 0).translate(0, bodyY + 0.1, 0.95 + sp.tail * 0.35));
  const legs = sp.legs;
  for (let i = 0; i < legs; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const row = Math.floor(i / 2);
    const z = legs === 4 ? (row === 0 ? -0.5 : 0.5) : -0.6 + row * 0.6;
    const leg = new THREE.CylinderGeometry(0.09, 0.13, L + 0.3, 5);
    leg.translate(0, (L + 0.3) / 2 - 0.05, 0);
    parts.push(tagged(leg, sp.belly, i + 1, (L + 0.25) * sp.size).translate(side * 0.38, 0, z));
  }
  if (sp.glow) {
    for (let i = 0; i < 3; i++) parts.push(tagged(new THREE.IcosahedronGeometry(0.1, 0), sp.accent, 30).translate(0, bodyY + 0.5, -0.3 + i * 0.35));
  }
  const g = mergeGeometries(parts);
  g.scale(sp.size, sp.size, sp.size);
  g.computeBoundingSphere();
  return g;
}

function buildFlyer(sp) {
  const parts = [];
  parts.push(tagged(blob(0.3, 0.7, 0.6, 2.0), sp.body, 0));
  parts.push(tagged(blob(0.18, 1, 1, 1.2), sp.body, 0).translate(0, 0.05, -0.62));
  const beak = new THREE.ConeGeometry(0.06, 0.3, 4);
  beak.rotateX(-Math.PI / 2);
  parts.push(tagged(beak, sp.belly, 0).translate(0, 0.02, -0.9));
  for (const s of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.25);
    shape.lineTo(1.6, 0.05);
    shape.lineTo(1.4, 0.3);
    shape.lineTo(0, 0.35);
    const wing = new THREE.ShapeGeometry(shape);
    wing.rotateX(-Math.PI / 2);
    if (s < 0) wing.scale(-1, 1, 1);
    parts.push(tagged(wing, sp.belly, 10, s).translate(s * 0.15, 0.05, 0));
  }
  const tail = new THREE.ConeGeometry(0.2, 0.6, 3);
  tail.rotateX(Math.PI / 2);
  tail.scale(1, 0.2, 1);
  parts.push(tagged(tail, sp.body, 0).translate(0, 0, 0.75));
  if (sp.glow) parts.push(tagged(new THREE.IcosahedronGeometry(0.08, 0), sp.accent, 30).translate(0, 0.05, 0.9));
  const g = mergeGeometries(parts);
  g.scale(sp.size, sp.size, sp.size);
  g.computeBoundingSphere();
  return g;
}

function buildFloater(sp) {
  const parts = [];
  const dome = new THREE.SphereGeometry(0.7, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, 0.8, 1);
  parts.push(tagged(dome, sp.body, 0));
  const under = new THREE.CircleGeometry(0.7, 14);
  under.rotateX(Math.PI / 2);
  parts.push(tagged(under, sp.accent, 30));
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const len = 1.2 + (i % 3) * 0.4;
    const t = new THREE.CylinderGeometry(0.03, 0.06, len, 4, 4);
    t.translate(0, -len / 2, 0);
    parts.push(tagged(t, sp.belly, 20, a).translate(Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45));
  }
  parts.push(tagged(new THREE.IcosahedronGeometry(0.22, 1), sp.accent, 30).translate(0, 0.25, 0));
  const g = mergeGeometries(parts);
  g.scale(sp.size, sp.size, sp.size);
  g.computeBoundingSphere();
  return g;
}

export function faunaMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, flatShading: true });
  patchStandard(m, {
    key: 'fauna',
    vertexPars: /* glsl */ `
      attribute float aPart;
      attribute float aExtra;
      attribute vec2 aAnim;
      varying float vGlowF;
    `,
    vertexBegin: /* glsl */ `
      vGlowF = aPart > 29.5 ? 1.0 : 0.0;
      {
        float walk = aAnim.x;
        float ph = aAnim.y;
        if (aPart > 0.5 && aPart < 9.5) {
          // swing legs around the hip, alternate sides and rows
          float hip = aExtra;
          float legPh = mod(aPart, 2.0) * 3.14159 + floor((aPart - 1.0) / 2.0) * 1.7;
          float ang = sin(uTime * (4.0 + walk * 5.0) + ph + legPh) * 0.55 * min(1.0, walk * 2.0);
          float yRel = transformed.y - hip;
          float z = transformed.z;
          float c = cos(ang), s = sin(ang);
          transformed.y = hip + yRel * c;
          transformed.z = z + yRel * s;
        } else if (aPart > 9.5 && aPart < 19.5) {
          // walk doubles as flap speed, leviathans flap slowly
          float flap = sin(uTime * (1.2 + walk * 6.0) + ph) * (0.6 + walk * 0.4);
          transformed.y += abs(transformed.x) * flap * 0.8;
        } else if (aPart > 19.5 && aPart < 29.5) {
          float k = clamp(-transformed.y, 0.0, 3.0);
          transformed.x += sin(uTime * 1.6 + ph + aExtra + k * 1.3) * 0.12 * k;
          transformed.z += cos(uTime * 1.3 + ph + aExtra * 1.7 + k) * 0.12 * k;
        }
        if (aPart < 0.5) transformed.y += sin(uTime * (4.0 + walk * 5.0) * 2.0 + ph) * 0.03 * walk;
      }
    `,
    fragmentPars: 'varying float vGlowF;',
    emissive: /* glsl */ `
      {
        vec3 upG = normalize(vWorldPosP - uAmbCenter);
        float nightK = 1.0 - smoothstep(-0.12, 0.18, dot(upG, normalize(uSunPos - uAmbCenter)));
        totalEmissiveRadiance += vColor.rgb * vGlowF * (0.6 + nightK * 2.0);
      }
    `,
  });
  return m;
}

export class Fauna {
  constructor(planet, species) {
    this.planet = planet;
    this.species = species;
    this.group = new THREE.Group();
    planet.group.add(this.group);
    this.material = faunaMaterial();
    this.herds = [];
    for (const sp of species) {
      const geo = sp.kind === 'grazer' ? buildGrazer(sp) : sp.kind === 'flyer' || sp.kind === 'leviathan' ? buildFlyer(sp) : buildFloater(sp);
      sp.radius = geo.boundingSphere.radius;
      const max = sp.group * 2;
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2);
      anim.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aAnim', anim);
      const mesh = new THREE.InstancedMesh(geo, this.material, max);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      sp.mesh = mesh;
      sp.anim = anim;
      // two groups per species so there's usually something in view
      const groups = sp.kind === 'leviathan' ? 1 : 2;
      for (let h = 0; h < groups; h++) this.herds.push({ sp, members: [], center: null, idx: h });
    }
    this.rng = new RNG(planet.def.seed ^ 0xfa);
  }

  groundAt(dir) {
    return this.planet.floorRadius(dir);
  }

  // place a group somewhere around the player, preferably not right in view
  spawnHerd(herd, local) {
    const up = _v.copy(local).normalize();
    const t1 = new THREE.Vector3(0, 1, 0).cross(up);
    if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0);
    t1.normalize();
    const t2 = up.clone().cross(t1);
    const sp = herd.sp;
    const big = sp.kind === 'leviathan';
    for (let attempt = 0; attempt < 8; attempt++) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = big ? this.rng.range(180, 320) : this.rng.range(70, 170);
      const c = local.clone().addScaledVector(t1, Math.cos(a) * d).addScaledVector(t2, Math.sin(a) * d);
      const dir = c.clone().normalize();
      const h = this.planet.heightAt(dir);
      if (sp.kind === 'grazer' && this.planet.seaLevel !== null && h < 1) continue;
      herd.center = dir;
      herd.members = [];
      for (let i = 0; i < sp.group; i++) {
        const off = new THREE.Vector3(this.rng.range(-1, 1), 0, this.rng.range(-1, 1)).multiplyScalar(sp.kind === 'flyer' ? 30 : 14);
        const p = c.clone().addScaledVector(t1, off.x).addScaledVector(t2, off.z);
        // start at ground level, not at the player's altitude
        const pd = p.clone().normalize();
        p.copy(pd).multiplyScalar(this.groundAt(pd));
        const m = {
          pos: p,
          vel: new THREE.Vector3(),
          target: null,
          idle: this.rng.range(0, 3),
          phase: this.rng.range(0, Math.PI * 2),
          walk: 0,
          heading: t1.clone(),
          alt: big ? this.rng.range(95, 160) : sp.kind === 'flyer' ? this.rng.range(22, 55) : sp.kind === 'floater' ? this.rng.range(4, 14) : 0,
          orbitR: big ? this.rng.range(160, 320) : this.rng.range(18, 45),
          orbitW: (big ? this.rng.range(0.025, 0.05) : this.rng.range(0.15, 0.35)) * (this.rng.chance(0.5) ? 1 : -1),
          orbitA: this.rng.range(0, Math.PI * 2),
        };
        herd.members.push(m);
      }
      return;
    }
  }

  update(dt, local, time, player) {
    // distance along the surface, so flying high doesn't respawn herds every frame
    const pdir = _v2.copy(local).normalize();
    for (const herd of this.herds) {
      const far = herd.sp.kind === 'leviathan' ? 1100 : 480;
      if (!herd.center || herd.center.angleTo(pdir) * this.planet.radius > far) this.spawnHerd(herd, local);
    }
    for (const sp of this.species) sp.count = 0;
    for (const herd of this.herds) {
      const sp = herd.sp;
      for (const m of herd.members) {
        if (sp.kind === 'grazer') this.stepGrazer(m, herd, dt, player);
        else if (sp.kind === 'flyer' || sp.kind === 'leviathan') this.stepFlyer(m, herd, dt, time);
        else this.stepFloater(m, herd, dt, time);
        this.writeInstance(sp, m);
      }
    }
    for (const sp of this.species) {
      sp.mesh.count = sp.count;
      sp.mesh.instanceMatrix.needsUpdate = true;
      sp.anim.needsUpdate = true;
    }
  }

  stepGrazer(m, herd, dt, player) {
    const sp = herd.sp;
    const up = _v.copy(m.pos).normalize();
    let speed = sp.speed;
    // flee from a player who gets close
    const toPlayer = _v2.subVectors(player, m.pos);
    const pd = toPlayer.length();
    if (pd < 11) {
      m.target = m.pos.clone().addScaledVector(toPlayer.projectOnPlane(up).normalize(), -20);
      m.fleeing = 2.5;
    }
    if (m.fleeing > 0) {
      m.fleeing -= dt;
      speed *= 2.6;
    }
    if (!m.target) {
      m.idle -= dt;
      if (m.idle <= 0) {
        const c = herd.center.clone().multiplyScalar(this.planet.radius);
        const t1 = new THREE.Vector3(1, 0, 0).projectOnPlane(up).normalize();
        const t2 = up.clone().cross(t1);
        const a = this.rng.range(0, Math.PI * 2);
        const r = this.rng.range(2, 22);
        m.target = c.addScaledVector(t1, Math.cos(a) * r).addScaledVector(t2, Math.sin(a) * r);
      }
    }
    let moving = 0;
    if (m.target) {
      const d = m.target.clone().sub(m.pos).projectOnPlane(up);
      const dist = d.length();
      if (dist < 1) {
        m.target = null;
        m.idle = this.rng.range(2, 7);
      } else {
        d.normalize();
        m.heading.lerp(d, Math.min(1, dt * 3)).projectOnPlane(up).normalize();
        m.pos.addScaledVector(m.heading, speed * dt);
        moving = speed / sp.speed;
      }
    }
    m.walk += (Math.min(1, moving * 0.6) - m.walk) * Math.min(1, dt * 5);
    const dir = m.pos.clone().normalize();
    const floor = this.groundAt(dir);
    if (this.planet.seaLevel !== null && this.planet.heightAt(dir) < 0.5) {
      // don't wander into the sea
      m.target = null;
      m.pos.addScaledVector(m.heading, -speed * dt * 2);
    }
    m.pos.copy(dir).multiplyScalar(floor);
    m.up = dir;
  }

  stepFlyer(m, herd, dt, time) {
    m.orbitA += m.orbitW * dt;
    const c = herd.center;
    const t1 = new THREE.Vector3(1, 0, 0).projectOnPlane(c).normalize();
    const t2 = c.clone().cross(t1);
    const R = this.planet.radius;
    const base = c.clone().multiplyScalar(R);
    const p = base.addScaledVector(t1, Math.cos(m.orbitA) * m.orbitR).addScaledVector(t2, Math.sin(m.orbitA) * m.orbitR);
    const dir = p.clone().normalize();
    const floor = this.groundAt(dir);
    const target = dir.clone().multiplyScalar(floor + m.alt + Math.sin(time * 0.7 + m.phase) * 3);
    const vel = target.clone().sub(m.pos);
    if (vel.lengthSq() > 1e-6) m.heading.copy(vel).normalize();
    m.pos.lerp(target, Math.min(1, dt * 2));
    m.up = dir;
    m.walk = herd.sp.kind === 'leviathan' ? 0.08 + 0.05 * Math.sin(time * 0.2 + m.phase) : 0.5 + 0.5 * Math.sin(time * 0.5 + m.phase);
  }

  stepFloater(m, herd, dt, time) {
    m.orbitA += m.orbitW * dt * 0.2;
    const c = herd.center;
    const t1 = new THREE.Vector3(1, 0, 0).projectOnPlane(c).normalize();
    const t2 = c.clone().cross(t1);
    const R = this.planet.radius;
    const p = c.clone().multiplyScalar(R).addScaledVector(t1, Math.cos(m.orbitA) * m.orbitR * 0.5).addScaledVector(t2, Math.sin(m.orbitA) * m.orbitR * 0.5);
    const dir = p.clone().normalize();
    const floor = this.groundAt(dir);
    const target = dir.clone().multiplyScalar(floor + m.alt + Math.sin(time * 0.6 + m.phase) * 1.2);
    m.pos.lerp(target, Math.min(1, dt * 0.8));
    m.heading.set(1, 0, 0).projectOnPlane(dir).normalize();
    m.up = dir;
    m.walk = 0.3;
  }

  writeInstance(sp, m) {
    const i = sp.count++;
    const up = m.up || _v.copy(m.pos).normalize();
    const fwd = m.heading.clone().projectOnPlane(up).normalize();
    if (fwd.lengthSq() < 0.5) fwd.set(1, 0, 0).projectOnPlane(up).normalize();
    const right = new THREE.Vector3().crossVectors(up, fwd);
    // model faces -Z
    _m.makeBasis(right.negate(), up, fwd.clone().negate());
    _q.setFromRotationMatrix(_m);
    _s.setScalar(1);
    _m.compose(m.pos, _q, _s);
    sp.mesh.setMatrixAt(i, _m);
    sp.anim.setXY(i, m.walk, m.phase);
    m.index = i;
  }

  // creature hit by a local ray, for the analysis visor
  raycast(origin, dir, range) {
    let best = null;
    for (const herd of this.herds) {
      const sp = herd.sp;
      for (const m of herd.members) {
        const up = m.up || _v.copy(m.pos).normalize();
        const c = _v2.copy(m.pos).addScaledVector(up, sp.kind === 'grazer' ? sp.size * (sp.legLen + 0.4) : 0).sub(origin);
        const r = sp.radius * 0.8;
        const b = c.dot(dir);
        const reach = sp.kind === 'leviathan' ? 600 : range;
        if (b < 0 || b > reach + r) continue;
        const c2 = c.lengthSq() - b * b;
        if (c2 > r * r) continue;
        const t = b - Math.sqrt(r * r - c2);
        if (!best || t < best.t) best = { t, species: sp, member: m };
      }
    }
    return best;
  }

  dispose() {
    for (const sp of this.species) {
      sp.mesh.geometry.dispose();
      sp.mesh.dispose();
    }
    this.material.dispose();
    this.planet.group.remove(this.group);
  }
}
