import { RNG, hashCombine } from '../core/rng.js';
import { systemName } from './names.js';

// Galaxy coordinates are in light years with the core at the origin.

export const STAR_CLASSES = {
  M: { label: 'Red Dwarf', color: '#ff8f5a', light: '#ffb088', tier: 1, weight: 0.3, radius: 3800, intensity: 0.92 },
  K: { label: 'Orange Star', color: '#ffb877', light: '#ffd2a8', tier: 1, weight: 0.26, radius: 4600, intensity: 0.96 },
  G: { label: 'Yellow Star', color: '#ffe9b8', light: '#fff1d8', tier: 1, weight: 0.22, radius: 5400, intensity: 1.0 },
  F: { label: 'White Star', color: '#f6f4ff', light: '#f6f6ff', tier: 2, weight: 0.1, radius: 6200, intensity: 1.04 },
  A: { label: 'Blue-White Star', color: '#d2e2ff', light: '#e2ecff', tier: 2, weight: 0.06, radius: 7200, intensity: 1.08 },
  B: { label: 'Blue Giant', color: '#9dbcff', light: '#c8dcff', tier: 3, weight: 0.035, radius: 9500, intensity: 1.12 },
  O: { label: 'Blue Supergiant', color: '#7f9dff', light: '#b8cbff', tier: 3, weight: 0.012, radius: 12000, intensity: 1.16 },
  X: { label: 'Anomalous Star', color: '#c07bff', light: '#e2c4ff', tier: 4, weight: 0.013, radius: 6800, intensity: 1.05 },
};

export const CLASS_KEYS = Object.keys(STAR_CLASSES);

export const GALAXY_RADIUS = 1050;

// system index of the galactic core, reached by the Core Jump. It isn't in the star list.
export const CORE_INDEX = -2;

export class Galaxy {
  constructor(seed, count = 24000) {
    this.seed = seed >>> 0;
    this.count = count;
    this.positions = new Float32Array(count * 3);
    this.classes = new Uint8Array(count);
    this.generate();
    this.buildGrid();
    this.story = this.findStoryPath();
  }

  generate() {
    const rng = new RNG(this.seed);
    const arms = 4;
    const pitch = (13 * Math.PI) / 180;
    const armOffset = rng.range(0, Math.PI * 2);
    this.armOffset = armOffset;
    this.arms = arms;
    this.pitch = pitch;
    const classWeights = CLASS_KEYS.map((k) => [CLASS_KEYS.indexOf(k), STAR_CLASSES[k].weight]);
    for (let i = 0; i < this.count; i++) {
      let x, y, z;
      const kind = rng.next();
      if (kind < 0.12) {
        // bulge
        const r = Math.abs(rng.gauss()) * 110 + 20;
        const th = rng.range(0, Math.PI * 2);
        const ph = Math.acos(rng.range(-1, 1));
        x = r * Math.sin(ph) * Math.cos(th);
        z = r * Math.sin(ph) * Math.sin(th);
        y = r * Math.cos(ph) * 0.55;
      } else {
        let r = -Math.log(1 - rng.next() * 0.96) * 330 + 60;
        r = Math.min(r, GALAXY_RADIUS);
        let th;
        if (kind < 0.8) {
          const arm = rng.int(0, arms - 1);
          const spread = 0.18 + 0.25 * (1 - r / GALAXY_RADIUS);
          th = armOffset + (arm * Math.PI * 2) / arms + Math.log(r / 60) / Math.tan(pitch) + rng.gauss() * spread;
        } else {
          th = rng.range(0, Math.PI * 2);
        }
        x = r * Math.cos(th);
        z = r * Math.sin(th);
        y = rng.gauss() * (14 + 40 * Math.exp(-r / 250));
      }
      this.positions[i * 3] = x;
      this.positions[i * 3 + 1] = y;
      this.positions[i * 3 + 2] = z;
      this.classes[i] = rng.weighted(classWeights);
    }
  }

  // uniform grid for neighbor queries
  buildGrid() {
    this.cell = 40;
    this.grid = new Map();
    for (let i = 0; i < this.count; i++) {
      const k = this.key(this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2]);
      let arr = this.grid.get(k);
      if (!arr) this.grid.set(k, (arr = []));
      arr.push(i);
    }
  }

  key(x, y, z) {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`;
  }

  starsWithin(x, y, z, radius) {
    const out = [];
    const c = this.cell;
    const r2 = radius * radius;
    const x0 = Math.floor((x - radius) / c), x1 = Math.floor((x + radius) / c);
    const y0 = Math.floor((y - radius) / c), y1 = Math.floor((y + radius) / c);
    const z0 = Math.floor((z - radius) / c), z1 = Math.floor((z + radius) / c);
    for (let gx = x0; gx <= x1; gx++)
      for (let gy = y0; gy <= y1; gy++)
        for (let gz = z0; gz <= z1; gz++) {
          const arr = this.grid.get(`${gx},${gy},${gz}`);
          if (!arr) continue;
          for (const i of arr) {
            const dx = this.positions[i * 3] - x, dy = this.positions[i * 3 + 1] - y, dz = this.positions[i * 3 + 2] - z;
            if (dx * dx + dy * dy + dz * dz <= r2) out.push(i);
          }
        }
    return out;
  }

  pos(i) {
    if (i < 0) return [0, 0, 0];
    return [this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2]];
  }

  dist(a, b) {
    const pa = this.pos(a), pb = this.pos(b);
    return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
  }

  distToCore(i) {
    const p = this.pos(i);
    return Math.hypot(p[0], p[1], p[2]);
  }

  classOf(i) {
    if (i < 0) return 'X';
    return CLASS_KEYS[this.classes[i]];
  }

  starSeed(i) {
    return hashCombine(this.seed, i + 1);
  }

  name(i) {
    return systemName(this.starSeed(i));
  }

  info(i) {
    if (i === CORE_INDEX) return { index: i, cls: 'X', ...STAR_CLASSES.X, label: 'Galactic Core', name: 'The Heart', seed: hashCombine(this.seed, 0xc0de) };
    const cls = this.classOf(i);
    return { index: i, cls, ...STAR_CLASSES[cls], name: this.name(i), seed: this.starSeed(i) };
  }

  // Picks the start star and the chain of resonant systems toward the core.
  // Each hop needs the next drive tier, so the chain doubles as progression.
  findStoryPath() {
    const pick = (from, minD, maxD, classes, closerThan) => {
      const p = this.pos(from);
      const cands = this.starsWithin(p[0], p[1], p[2], maxD).filter((i) => {
        if (i === from) return false;
        const d = this.dist(from, i);
        if (d < minD) return false;
        if (!classes.includes(this.classOf(i))) return false;
        return this.distToCore(i) < closerThan;
      });
      if (cands.length === 0) return -1;
      // prefer candidates that make the most progress toward the core
      cands.sort((a, b) => this.distToCore(a) - this.distToCore(b));
      const rng = new RNG(this.seed ^ from);
      return cands[Math.min(cands.length - 1, Math.floor(rng.next() * Math.min(6, cands.length)))];
    };

    const hops = [
      { min: 28, max: 55, classes: ['G', 'K', 'M'] },
      { min: 60, max: 110, classes: ['F', 'A'] },
      { min: 100, max: 185, classes: ['B', 'O'] },
      { min: 150, max: 300, classes: ['X'] },
    ];
    const buildChain = (start) => {
      const chain = [];
      let prev = start;
      for (const h of hops) {
        let next = pick(prev, h.min, h.max, h.classes, this.distToCore(prev) - 5);
        if (next < 0) next = pick(prev, h.min * 0.5, h.max * 1.4, h.classes, this.distToCore(prev) + 40);
        if (next < 0) break;
        chain.push(next);
        prev = next;
      }
      return chain;
    };

    // yellow or orange stars near the rim, closest to 800 ly first. A few
    // seeds have no usable chain from the best one, so keep trying.
    const starts = [];
    for (let i = 0; i < this.count; i++) {
      const c = this.classOf(i);
      if (c !== 'G' && c !== 'K') continue;
      if (Math.abs(this.positions[i * 3 + 1]) >= 30) continue;
      starts.push([Math.abs(this.distToCore(i) - 800), i]);
    }
    starts.sort((a, b) => a[0] - b[0]);
    let best = { start: starts.length ? starts[0][1] : 0, resonances: [] };
    for (const [, s] of starts.slice(0, 80)) {
      const chain = buildChain(s);
      if (chain.length === hops.length) return { start: s, resonances: chain };
      if (chain.length > best.resonances.length) best = { start: s, resonances: chain };
    }
    return best;
  }
}
