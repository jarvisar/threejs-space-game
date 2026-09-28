import * as THREE from 'three';
import { TerrainGenerator, faceDir } from '../gen/terrain.js';
import { CHUNK_N } from './chunkBuilder.js';
import { createTerrainMaterial } from '../render/materials.js';
import { Body } from './body.js';
import { CloudPuffs } from './clouds.js';
import { smoothstep } from '../core/math.js';
import { RNG } from '../core/rng.js';

const _v = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();

// Shared by rocky planets and gas giants. Scattering coefficients are picked
// so the zenith optical depth of the strongest channel is about 0.4 * density,
// whatever the atmosphere thickness is.
export function fillAtmoCommon(body, s) {
  const a = body.def.atmosphere;
  s.center.copy(body.group.position);
  s.radius = body.radius;
  if (a) {
    s.atmoRadius = body.radius + a.height;
    const scaleR = a.height * 0.22;
    const scaleM = a.height * 0.08;
    const m = Math.max(a.sky[0], a.sky[1], a.sky[2]);
    const k = (0.45 * a.density) / scaleR;
    // squaring the tint pushes the channel ratios toward Earth-like contrast
    s.betaR.set(Math.pow(a.sky[0] / m, 2) * k, Math.pow(a.sky[1] / m, 2) * k, Math.pow(a.sky[2] / m, 2) * k);
    s.betaM = (0.018 * a.mie * a.density) / scaleM;
    s.scaleR = scaleR;
    s.scaleM = scaleM;
    s.mieG = a.mieG;
  } else {
    s.atmoRadius = body.radius + (body.maxH || 0) + 20;
    s.betaR.set(0, 0, 0);
    s.betaM = 0;
    s.scaleR = 0;
    s.scaleM = 1;
  }
  s.sunDir.copy(body.position).multiplyScalar(-1).normalize();
  s.rot.copy(body.rotUniform.value);
  s.ocean = 0;
  s.cloudCov = 0;
  s.camAlt = body.camDist - body.radius;
  s.solidR = body.radius * 0.995;
}

// Some worlds get auroras. Rolled from their own seed so the rest of the
// planet's generation doesn't shift.
const AURORA_CHANCE = { frozen: 0.9, exotic: 0.8, radioactive: 0.7, ocean: 0.6, lush: 0.5, toxic: 0.4, desert: 0.3, barren: 0.3, volcanic: 0.25 };
const AURORA_COLORS = [
  ['#3dff9a', '#c34dff'],
  ['#4dffc3', '#4d7bff'],
  ['#8cff4d', '#ff4da6'],
  ['#4de1ff', '#b84dff'],
  ['#ffd04d', '#ff4d6a'],
];

function auroraFor(def) {
  if (!def.atmosphere) return null;
  const rng = new RNG((def.seed ^ 0xa4a4) >>> 0);
  if (!rng.chance(AURORA_CHANCE[def.type] || 0)) return null;
  const pair = def.type === 'radioactive' ? AURORA_COLORS[2] : def.type === 'exotic' ? rng.pick([AURORA_COLORS[3], AURORA_COLORS[4]]) : rng.pick(AURORA_COLORS.slice(0, 4));
  return { k: rng.range(1.6, 2.8), lat: rng.range(0.55, 0.75), c1: new THREE.Color(pair[0]), c2: new THREE.Color(pair[1]) };
}

// Surface normal from three height samples around a local direction
export function surfaceNormal(planet, dir, eps = 1.5) {
  const t1 = _t1.set(0, 1, 0).cross(dir);
  if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0).cross(dir);
  t1.normalize();
  const t2 = _t2.copy(dir).cross(t1).normalize();
  const R = planet.radius;
  const a = eps / R;
  const d0 = dir.clone();
  const d1 = dir.clone().addScaledVector(t1, a).normalize();
  const d2 = dir.clone().addScaledVector(t2, a).normalize();
  const p0 = d0.multiplyScalar(R + planet.heightAt(dir));
  const p1 = d1.multiplyScalar(R + planet.heightAt(d1));
  const p2 = d2.multiplyScalar(R + planet.heightAt(d2));
  const n = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0)).normalize();
  if (n.dot(dir) < 0) n.negate();
  return n;
}

// spiral search for a dry spot with some height near dir. Falls back to the
// highest point it sampled so mostly-ocean worlds still get the best island.
export function findLand(body, dir, minH = 4) {
  let best = dir;
  let bestH = body.heightAt(dir);
  if (bestH > minH) return dir;
  const t1 = new THREE.Vector3(0, 1, 0).cross(dir);
  if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0);
  t1.normalize();
  const t2 = dir.clone().cross(t1);
  for (let i = 1; i < 1600; i++) {
    const a = i * 2.399;
    const r = 0.012 * Math.sqrt(i);
    const d = dir.clone().addScaledVector(t1, Math.cos(a) * r).addScaledVector(t2, Math.sin(a) * r).normalize();
    const h = body.heightAt(d);
    if (h > minH) return d;
    if (h > bestH) {
      best = d;
      bestH = h;
    }
  }
  return best;
}

class Node {
  constructor(planet, face, level, x, y) {
    this.face = face;
    this.level = level;
    this.x = x;
    this.y = y;
    this.children = null;
    this.mesh = null;
    this.job = null;
    this.ready = false;
    this.hiddenAt = 0;
    const size = 2 / (1 << level);
    const d = faceDir(face, -1 + (x + 0.5) * size, -1 + (y + 0.5) * size, [0, 0, 0]);
    this.dir = new THREE.Vector3(d[0], d[1], d[2]);
    this.center = this.dir.clone().multiplyScalar(planet.radius);
    this.size = (planet.radius * Math.PI) / 2 / (1 << level);
    this.angle = (this.size * 0.75) / planet.radius;
    this.minH = planet.minH;
    this.maxH = planet.maxH;
  }
}

export class Planet extends Body {
  constructor(def, pool, index) {
    super();
    this.initBody(def);
    this.index = index;
    this.pool = pool;
    this.gen = new TerrainGenerator(def.terrain);
    this.maxH = this.gen.maxHeight();
    this.minH = this.gen.minHeight();
    this.atmoRadius = def.atmosphere ? def.radius + def.atmosphere.height : def.radius + this.maxH;
    this.seaLevel = def.ocean ? def.radius : null;

    // finest level where vertex spacing drops to about 2 m. The terrain is flat
    // shaded, so this is also the facet size underfoot.
    const spacingTarget = 2.0;
    this.maxLevel = Math.max(4, Math.ceil(Math.log2((this.radius * Math.PI) / (2 * (CHUNK_N - 1) * spacingTarget))));
    this.finestLod = ((this.radius * Math.PI) / 2 / (1 << this.maxLevel) / (CHUNK_N - 1)) * 1.6;

    this.uniforms = {
      center: { value: new THREE.Vector3() },
      radius: { value: def.radius },
      rot: this.rotUniform,
      sky: { value: new THREE.Color() },
      ground: { value: new THREE.Color() },
      scanPos: { value: new THREE.Vector3() },
      scanRadius: { value: 0 },
    };
    this.computeAmbient();
    this.aurora = auroraFor(def);
    this.material = createTerrainMaterial(def, this.uniforms);
    this.roots = [];
    for (let f = 0; f < 6; f++) this.roots.push(new Node(this, f, 0, 0, 0));
    this.lodFactor = 2.2;
    this.chunkCount = 0;
    this.time = 0;
    this.focus = false;

    pool.broadcast({ type: 'planet', id: def.id, terrain: def.terrain });
  }

  computeAmbient() {
    const def = this.def;
    if (def.atmosphere) {
      const s = def.atmosphere.sky;
      const m = Math.max(s[0], s[1], s[2]);
      // sky ambient is roughly the Rayleigh tint, brighter for denser air
      const k = 0.42 * Math.min(1.3, def.atmosphere.density);
      this.uniforms.sky.value.setRGB((s[0] / m) * k + 0.07, (s[1] / m) * k + 0.07, (s[2] / m) * k + 0.07);
      const g = new THREE.Color(def.palette.low);
      this.uniforms.ground.value.copy(g).multiplyScalar(0.25).add(new THREE.Color(0.06, 0.05, 0.04));
    } else {
      // airless: starlight and light bounced off the ground, enough that
      // shadows keep their shape instead of going black
      this.uniforms.sky.value.setRGB(0.13, 0.14, 0.18);
      this.uniforms.ground.value.copy(new THREE.Color(def.palette.low)).multiplyScalar(0.3).add(new THREE.Color(0.04, 0.04, 0.05));
    }
  }

  // Surface height in meters at a planet-local direction, matching the finest mesh.
  heightAt(dir) {
    return this.gen.height(dir.x, dir.y, dir.z, this.finestLod);
  }

  // Ground radius including oceans (liquid counts as a floor for the player)
  floorRadius(dir) {
    const h = this.heightAt(dir);
    if (this.seaLevel !== null && h < 0) return this.radius;
    return this.radius + h;
  }

  // expects updateRotation() to have run this frame
  update(camWorld, now) {
    this.time = now;
    this.toLocal(camWorld, this.camLocal);
    const D = this.camLocal.length();
    const rmin = this.radius + this.minH;
    this.camDist = D;
    this.horizon = D > rmin ? Math.acos(rmin / D) : 0;
    this.horizonMax = Math.acos(rmin / (this.radius + this.maxH));
    this.camDir = _v.copy(this.camLocal).normalize().clone();
    for (const r of this.roots) this.updateNode(r);
    // puffs only exist near the planet, from further out the atmosphere pass
    // draws the same pattern
    if (this.def.clouds) {
      if (!this.clouds && D < this.radius * 10) this.clouds = new CloudPuffs(this);
      if (this.clouds) this.clouds.update(now, this.stormK || 0);
    }
  }

  isBeyondHorizon(node) {
    if (this.camDist < this.radius + this.maxH * 2) {
      // close to the ground the cone test gets too aggressive near cliffs
      const phi = Math.acos(Math.max(-1, Math.min(1, node.dir.dot(this.camDir))));
      return phi - node.angle > this.horizon + this.horizonMax + 0.05;
    }
    const phi = Math.acos(Math.max(-1, Math.min(1, node.dir.dot(this.camDir))));
    return phi - node.angle > this.horizon + this.horizonMax;
  }

  shouldSplit(node) {
    if (node.level >= this.maxLevel) return false;
    const d = _v.subVectors(this.camLocal, node.center).length() - node.size * 0.5;
    return d < node.size * this.lodFactor;
  }

  updateNode(node) {
    const hidden = this.isBeyondHorizon(node);
    if (!hidden && this.shouldSplit(node)) {
      if (!node.children) {
        const l = node.level + 1;
        node.children = [
          new Node(this, node.face, l, node.x * 2, node.y * 2),
          new Node(this, node.face, l, node.x * 2 + 1, node.y * 2),
          new Node(this, node.face, l, node.x * 2, node.y * 2 + 1),
          new Node(this, node.face, l, node.x * 2 + 1, node.y * 2 + 1),
        ];
      }
      let allReady = true;
      for (const c of node.children) {
        if (!c.ready) {
          allReady = false;
          this.request(c);
        }
      }
      node.childrenIdleSince = 0;
      if (allReady) {
        this.setVisible(node, false);
        for (const c of node.children) this.updateNode(c);
        return;
      }
      for (const c of node.children) this.hideSubtree(c);
      this.show(node);
      return;
    }

    if (hidden) this.setVisible(node, false);
    else this.show(node);
    if (node.children) {
      for (const c of node.children) this.hideSubtree(c);
      // keep unused children around briefly in case the camera turns back
      if (!node.childrenIdleSince) node.childrenIdleSince = this.time;
      if (this.time - node.childrenIdleSince > 4) {
        for (const c of node.children) this.disposeSubtree(c);
        node.children = null;
        node.childrenIdleSince = 0;
      }
    }
  }

  show(node) {
    if (node.ready) this.setVisible(node, true);
    else this.request(node);
  }

  setVisible(node, v) {
    if (node.mesh) node.mesh.visible = v;
  }

  hideSubtree(node) {
    if (node.mesh) node.mesh.visible = false;
    if (node.children) for (const c of node.children) this.hideSubtree(c);
  }

  disposeSubtree(node) {
    if (node.children) for (const c of node.children) this.disposeSubtree(c);
    node.children = null;
    if (node.job) {
      this.pool.cancel(node.job);
      node.job = null;
    }
    if (node.mesh) {
      this.group.remove(node.mesh);
      node.mesh.geometry.dispose();
      node.mesh = null;
      this.chunkCount--;
    }
    node.ready = false;
    node.disposed = true;
  }

  request(node) {
    if (node.job || node.ready) return;
    const planet = this;
    node.job = this.pool.request(
      { type: 'chunk', planetId: this.def.id, face: node.face, level: node.level, x: node.x, y: node.y, N: CHUNK_N },
      () => {
        // same rough "meters away" scale the scatter jobs use
        const d = _v.subVectors(planet.camLocal, node.center).length();
        const behind = planet.isBeyondHorizon(node) ? 8 : 1;
        return (d / (node.size + 1)) * 60 * behind + (planet.focus ? 0 : 1e6);
      },
      (res) => {
        node.job = null;
        if (node.disposed) return;
        this.buildMesh(node, res);
      }
    );
  }

  buildMesh(node, res) {
    const geo = new THREE.BufferGeometry();
    // each chunk has its own triangulation, see buildChunkIndex
    geo.setIndex(new THREE.BufferAttribute(res.index, 1));
    geo.setAttribute('position', new THREE.BufferAttribute(res.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(res.normals, 3));
    geo.setAttribute('aData', new THREE.BufferAttribute(res.data, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), res.radius);
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(res.center[0], res.center[1], res.center[2]);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.visible = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    node.center.set(res.center[0], res.center[1], res.center[2]);
    node.minH = res.minH;
    node.maxH = res.maxH;
    node.mesh = mesh;
    node.ready = true;
    this.group.add(mesh);
    this.chunkCount++;
  }

  // world-space placement for the floating origin
  updateRender(origin) {
    super.updateRender(origin);
    this.uniforms.center.value.copy(this.group.position);
  }

  get hasAtmoPass() {
    return !!(this.def.atmosphere || this.def.ocean);
  }

  fillAtmoSlot(s) {
    fillAtmoCommon(this, s);
    const def = this.def;
    s.camAlt = this.camDist - this.radius;
    s.solidR = this.radius * 0.995;
    const o = def.ocean;
    s.ocean = o ? { water: 1, lava: 2, ice: 3, acid: 4 }[o.mode] || 1 : 0;
    if (o) {
      s.oceanShallow.set(o.shallow);
      s.oceanDeep.set(o.deep);
    }
    // storms thicken the haze and close up the cloud layer. Kept moderate, at
    // 5x the haze blotted out the sun and the ground went black.
    const storm = this.stormK || 0;
    if (storm > 0) s.betaM *= 1 + storm * 1.6;
    const c = def.clouds;
    if (c) {
      s.cloudCov = Math.min(0.95, c.coverage + storm * 0.35);
      s.cloudAlt = c.altitude;
      s.cloudColor.set(c.color);
      s.cloudScale = c.scale;
      s.cloudSeed = c.seed;
      s.cloudSpeed = c.speed;
      s.cloudFar = smoothstep(5.5, 8.5, this.camDist / this.radius);
    } else {
      s.cloudCov = 0;
    }
    s.ambient.copy(this.uniforms.sky.value);
    const au = this.aurora;
    s.auroraK = au ? au.k : 0;
    if (au) {
      s.auroraLat = au.lat;
      s.auroraC1.copy(au.c1);
      s.auroraC2.copy(au.c2);
    }
  }

  dispose() {
    for (const r of this.roots) this.disposeSubtree(r);
    if (this.clouds) this.clouds.dispose();
    this.material.dispose();
    if (this.rings) {
      this.rings.geometry.dispose();
      this.rings.material.dispose();
    }
    this.pool.broadcast({ type: 'drop', id: this.def.id });
  }
}
