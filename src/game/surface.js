import * as THREE from 'three';
import { Planet } from '../world/planet.js';
import { Scatter } from '../world/scatter.js';
import { PoiManager } from '../world/pois.js';
import { Fauna, faunaSpecies } from '../world/fauna.js';
import { planetSpecies } from '../gen/flora.js';
import { RESOURCES } from './resources.js';

const _v = new THREE.Vector3();

// Owns everything that only exists near a planet's surface: flora/rock
// scatter, points of interest, mining and the analysis visor.
export class Surface {
  constructor(game) {
    this.game = game;
    this.planet = null;
    this.scatter = null;
    this.pois = null;
    this.mining = null;
    this.scan = null;
  }

  get active() {
    return !!this.scatter;
  }

  release() {
    if (this.scatter) this.scatter.dispose();
    if (this.pois) this.pois.dispose();
    if (this.fauna) this.fauna.dispose();
    // otherwise the planet keeps its storm haze when seen from orbit
    if (this.planet) this.planet.stormK = 0;
    this.scatter = null;
    this.pois = null;
    this.fauna = null;
    this.planet = null;
    this.mining = null;
  }

  update(dt, body, local, time) {
    const planet = body instanceof Planet ? body : null;
    if (planet !== this.planet) this.release();
    if (!planet) return;
    const r = local.length();
    const alt = r - planet.radius - planet.heightAt(_v.copy(local).divideScalar(r));
    if (!this.scatter && alt < 1200) {
      this.planet = planet;
      const species = planetSpecies(planet.def);
      planet.species = species;
      const state = this.game.state;
      planet.minedSet = state.mined.filter((m) => m.startsWith(planet.def.id + '|')).map((m) => m.slice(planet.def.id.length + 1));
      this.scatter = new Scatter(planet, this.game.pool, species);
      this.pois = new PoiManager(this.game, planet);
      const fauna = faunaSpecies(planet.def);
      planet.faunaSpecies = fauna;
      this.fauna = fauna.length ? new Fauna(planet, fauna) : null;
    } else if (this.scatter && alt > 2200) {
      this.release();
      return;
    }
    if (!this.scatter) return;
    const ship = this.game.ship;
    this.scatter.setClearing(ship.frame === planet && ship.state !== 'flying' ? ship.pos : null, 8);
    this.scatter.update(local, time);
    this.pois.update(local, time);
    if (this.fauna) this.fauna.update(Math.min(dt, 0.05), local, time, local);
  }

  colliders(local) {
    if (!this.scatter) return null;
    const out = this.scatter.collidersNear(local, 6, []);
    if (this.pois) this.pois.collidersNear(local, 12, out);
    return out;
  }

  // what the player is looking at, in planet-local space
  pick(origin, dir, range) {
    let best = null;
    if (this.scatter) {
      const h = this.scatter.raycast(origin, dir, range);
      if (h) best = { kind: 'flora', t: h.t, hit: h };
    }
    if (this.pois) {
      const p = this.pois.raycast(origin, dir, range);
      if (p && (!best || p.t < best.t)) best = { kind: 'poi', t: p.t, hit: p };
    }
    if (this.fauna) {
      // creatures are easier to catch in the visor, give them extra range,
      // but not through a hillside
      const f = this.fauna.raycast(origin, dir, range * 4);
      if (f && (!best || f.t < best.t) && !this.terrainBlocks(origin, dir, f.t)) best = { kind: 'fauna', t: f.t, hit: f };
    }
    return best;
  }

  // coarse march along a local ray, step grows with distance
  terrainBlocks(origin, dir, dist) {
    const p = this.planet;
    const q = new THREE.Vector3();
    for (let t = 1; t < dist - 2; t += Math.max(0.5, t * 0.04)) {
      q.copy(origin).addScaledVector(dir, t);
      const r = q.length();
      if (r < p.floorRadius(_v.copy(q).divideScalar(r))) return true;
    }
    return false;
  }

  describe(target) {
    if (!target) return null;
    if (target.kind === 'poi') return this.pois.describe(target.hit.poi);
    if (target.kind === 'fauna') {
      const sp = target.hit.species;
      return { name: this.game.state.species[sp.id] ? sp.name : 'Unknown creature', sub: 'Hold Right Mouse to analyze' };
    }
    const sp = target.hit.species;
    const res = RESOURCES[sp.res];
    const known = sp.plant && this.game.state.species[sp.id];
    const name = sp.plant ? (known ? sp.name : 'Unknown flora') : sp.label;
    return { name, sub: res ? `${res.name}` : '' };
  }

  // hold-to-mine. Returns { done, progress } for the current target
  mine(target, dt, power) {
    if (!target) {
      this.mining = null;
      return null;
    }
    if (target.kind === 'poi') return this.pois.mine(target.hit.poi, dt, power);
    if (target.kind === 'fauna') return null;
    const h = target.hit;
    const sp = h.species;
    if (this.game.isFull(sp.res)) {
      this.mining = null;
      return null;
    }
    if (!this.mining || this.mining.id !== h.id) this.mining = { id: h.id, progress: 0 };
    this.mining.progress += (dt * power) / (sp.mine * Math.max(0.6, Math.sqrt(h.scale)));
    if (this.mining.progress >= 1) {
      this.scatter.remove(h.id);
      const st = this.game.state;
      st.mined.push(`${this.planet.def.id}|${h.id}`);
      if (st.mined.length > 5000) st.mined.splice(0, st.mined.length - 5000);
      const [a, b] = sp.amount;
      const n = Math.max(1, Math.round((a + Math.random() * (b - a)) * Math.min(2, h.scale)));
      this.game.gain(sp.res, n);
      // plants also drop a little carbon if their main yield is something else
      if (sp.plant && sp.res !== 'carbon') this.game.gain('carbon', Math.max(1, Math.round(n * 0.3)));
      this.game.effects.burst(this.planet, h.center, RESOURCES[sp.res] ? RESOURCES[sp.res].color : '#ffffff', 1 + h.scale);
      this.mining = null;
      return { done: true, progress: 1 };
    }
    return { done: false, progress: this.mining.progress };
  }

  // analysis visor: hold on a plant to catalogue the species
  analyze(target, dt) {
    const ok = target && ((target.kind === 'flora' && target.hit.species.plant) || target.kind === 'fauna');
    if (!ok) {
      this.scan = null;
      return null;
    }
    const sp = target.hit.species;
    if (this.game.state.species[sp.id]) return { known: true, species: sp };
    if (!this.scan || this.scan.id !== sp.id) this.scan = { id: sp.id, progress: 0 };
    this.scan.progress += dt / (sp.fauna ? 1.6 : 1.1);
    if (this.scan.progress >= 1) {
      this.scan = null;
      this.game.discoverSpecies(sp, this.planet);
      return { known: true, species: sp, fresh: true };
    }
    return { known: false, species: sp, progress: this.scan.progress };
  }

  // terrain hit along a local ray, or null
  terrainRay(origin, dir, range) {
    const p = this.planet;
    if (!p) return null;
    const step = 0.4;
    const q = new THREE.Vector3();
    for (let t = 0.3; t < range; t += step) {
      q.copy(origin).addScaledVector(dir, t);
      const r = q.length();
      if (r < p.floorRadius(_v.copy(q).divideScalar(r))) return { t, point: q.clone() };
    }
    return null;
  }

  dispose() {
    this.release();
  }
}
