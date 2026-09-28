import { RNG, hashCombine } from '../core/rng.js';
import { speciesName } from './names.js';

// Species definitions per planet. This is data only (seeded), geometry is
// built separately by world/floraGeometry.js. Placement fields are read by the
// scatter worker, so keep them plain numbers.

const KINDS_BY_TYPE = {
  lush: [['tree', 3], ['tree', 2], ['shrub', 3], ['grass', 4], ['flower', 2], ['rock', 2], ['boulder', 1], ['mushroom', 0.6], ['crystal', 1]],
  ocean: [['palm', 3], ['shrub', 3], ['grass', 4], ['flower', 2], ['rock', 2], ['boulder', 1], ['crystal', 1]],
  desert: [['cactus', 3], ['deadtree', 1.5], ['dryshrub', 3], ['rock', 3], ['boulder', 2], ['crystal', 1], ['pod', 0.7]],
  frozen: [['icetree', 2], ['frostshrub', 2.5], ['grass', 1], ['rock', 3], ['boulder', 2], ['crystal', 2], ['iceshard', 2]],
  volcanic: [['deadtree', 2], ['vent', 1.5], ['rock', 3], ['boulder', 2], ['crystal', 1.5], ['obsidian', 2]],
  toxic: [['mushroom', 4], ['bigmushroom', 2], ['pod', 2.5], ['tendril', 2], ['grass', 2], ['rock', 2], ['crystal', 1]],
  radioactive: [['crystal', 3], ['twisttree', 2], ['pod', 2], ['dryshrub', 2], ['rock', 3], ['boulder', 1.5]],
  barren: [['rock', 4], ['boulder', 3], ['dryshrub', 1.5], ['crystal', 1.5]],
  dead: [['rock', 4], ['boulder', 3], ['crystal', 1]],
  exotic: [['spiraltree', 2.5], ['bulbtree', 2], ['crystal', 2], ['floater', 2], ['spire', 1.5], ['grass', 2], ['flower', 2], ['rock', 2]],
};

// base placement per kind: density per m^2, scale range, render distance
const KIND = {
  tree: { density: 0.0022, scale: [0.8, 1.6], maxDist: 650, res: 'carbon', amount: [14, 22], mine: 1.6, collider: 0.45, colH: 6, plant: true, cluster: 0.45 },
  palm: { density: 0.0018, scale: [0.8, 1.4], maxDist: 650, res: 'carbon', amount: [12, 18], mine: 1.5, collider: 0.35, colH: 6, plant: true, cluster: 0.4, maxH: 40 },
  icetree: { density: 0.0012, scale: [0.8, 1.5], maxDist: 650, res: 'carbon', amount: [10, 16], mine: 1.6, collider: 0.4, colH: 5, plant: true, cluster: 0.4 },
  deadtree: { density: 0.0008, scale: [0.7, 1.4], maxDist: 600, res: 'carbon', amount: [8, 14], mine: 1.2, collider: 0.35, colH: 4, plant: true, cluster: 0.3 },
  twisttree: { density: 0.0012, scale: [0.8, 1.5], maxDist: 650, res: 'carbon', amount: [10, 16], mine: 1.4, collider: 0.4, colH: 5, plant: true, cluster: 0.35 },
  spiraltree: { density: 0.0014, scale: [0.8, 1.6], maxDist: 650, res: 'carbon', amount: [12, 18], mine: 1.6, collider: 0.4, colH: 6, plant: true, cluster: 0.4 },
  bulbtree: { density: 0.0011, scale: [0.8, 1.5], maxDist: 650, res: 'lumen', amount: [10, 16], mine: 1.6, collider: 0.4, colH: 6, plant: true, cluster: 0.35, glow: 1 },
  shrub: { density: 0.012, scale: [0.6, 1.4], maxDist: 260, res: 'carbon', amount: [4, 8], mine: 0.5, plant: true, cluster: 0.3 },
  dryshrub: { density: 0.006, scale: [0.6, 1.3], maxDist: 240, res: 'carbon', amount: [3, 6], mine: 0.45, plant: true, cluster: 0.2 },
  frostshrub: { density: 0.006, scale: [0.6, 1.3], maxDist: 240, res: 'carbon', amount: [3, 6], mine: 0.45, plant: true, cluster: 0.25 },
  grass: { density: 0.26, scale: [0.6, 1.3], maxDist: 70, res: 'carbon', amount: [1, 2], mine: 0.15, plant: true, cluster: 0.25 },
  flower: { density: 0.006, scale: [0.7, 1.3], maxDist: 160, res: 'lumen', amount: [3, 6], mine: 0.35, plant: true, cluster: 0.5, glow: 1 },
  mushroom: { density: 0.01, scale: [0.6, 1.6], maxDist: 220, res: 'carbon', amount: [3, 6], mine: 0.4, plant: true, cluster: 0.45, glow: 0.8 },
  bigmushroom: { density: 0.0012, scale: [0.8, 1.6], maxDist: 650, res: 'carbon', amount: [12, 20], mine: 1.5, collider: 0.5, colH: 5, plant: true, cluster: 0.4, glow: 1 },
  pod: { density: 0.004, scale: [0.7, 1.4], maxDist: 200, res: 'lumen', amount: [3, 6], mine: 0.35, plant: true, cluster: 0.45, glow: 1 },
  tendril: { density: 0.006, scale: [0.7, 1.5], maxDist: 220, res: 'carbon', amount: [3, 6], mine: 0.45, plant: true, cluster: 0.4, glow: 0.5 },
  cactus: { density: 0.0022, scale: [0.7, 1.5], maxDist: 450, res: 'carbon', amount: [6, 12], mine: 0.8, collider: 0.4, colH: 3, plant: true, cluster: 0.3 },
  vent: { density: 0.0012, scale: [0.8, 1.6], maxDist: 450, res: 'pyrocite', amount: [3, 6], mine: 0.9, plant: false, cluster: 0.4, glow: 1 },
  rock: { density: 0.006, scale: [0.5, 1.5], maxDist: 300, res: 'ferrite', amount: [5, 9], mine: 0.6, plant: false, cluster: 0.25 },
  boulder: { density: 0.0007, scale: [1.0, 2.6], maxDist: 800, res: 'ferrite', amount: [18, 30], mine: 1.8, collider: 1.4, colH: 3, plant: false, cluster: 0.2 },
  obsidian: { density: 0.0025, scale: [0.6, 1.6], maxDist: 500, res: 'ferrite', amount: [8, 14], mine: 1.0, collider: 0.6, colH: 2, plant: false, cluster: 0.35 },
  crystal: { density: 0.0018, scale: [0.6, 1.4], maxDist: 450, res: 'hydrogel', amount: [8, 14], mine: 0.9, plant: false, cluster: 0.55, glow: 1 },
  iceshard: { density: 0.0022, scale: [0.7, 1.8], maxDist: 450, res: 'cryonite', amount: [3, 6], mine: 0.9, collider: 0.5, colH: 2, plant: false, cluster: 0.4, glow: 0.4 },
  floater: { density: 0.0006, scale: [1.0, 3.0], maxDist: 900, res: 'ferrite', amount: [10, 18], mine: 1.4, plant: false, cluster: 0.4, lift: 14 },
  spire: { density: 0.0004, scale: [0.8, 1.8], maxDist: 900, res: 'ferrite', amount: [18, 30], mine: 2.0, collider: 1.2, colH: 12, plant: false, cluster: 0.3 },
};

export function planetSpecies(def) {
  if (def.kind !== 'rocky') return [];
  const rng = new RNG(hashCombine(def.seed, 777));
  const table = KINDS_BY_TYPE[def.type] || KINDS_BY_TYPE.barren;
  const density = def.floraDensity;
  const species = [];
  const used = new Map();
  // every planet with any flora gets rocks and a hydrogel crystal, the rest is rolled
  const picks = [];
  for (const [kind, w] of table) {
    if (rng.next() < Math.min(1, w / 3 + 0.25)) picks.push(kind);
  }
  if (!picks.includes('rock')) picks.push('rock');
  if (!picks.includes('crystal') && def.type !== 'volcanic') picks.push('crystal');

  let i = 0;
  for (const kind of picks) {
    const base = KIND[kind];
    const n = (used.get(kind) || 0) + 1;
    used.set(kind, n);
    const seed = hashCombine(def.seed, 1000 + i * 31);
    const srng = new RNG(seed);
    const plant = base.plant;
    let d = base.density * (plant ? 0.25 + density * 1.1 : 0.6 + density * 0.4) * srng.range(0.6, 1.4);
    if (def.type === 'dead' && plant) continue;
    // rare resource crystals use the planet's resource color, hydrogel is blue
    let res = base.res;
    if (kind === 'crystal' && srng.chance(0.45) && def.resource) res = def.resource;
    if (kind === 'crystal' && res === 'hydrogel' && ['frozen', 'ocean', 'barren', 'dead'].includes(def.type)) d *= 1.5;
    const sp = {
      id: `${def.id}:${kind}:${n}`,
      index: i,
      kind,
      name: plant ? speciesName(seed) : null,
      seed: seed % 1000003,
      plant,
      res,
      amount: base.amount,
      mine: base.mine,
      glow: base.glow ? base.glow * (plant ? (srng.chance(0.75) ? 1 : 0.3) : 1) : 0,
      collider: base.collider || 0,
      colH: base.colH || 0,
      maxDist: base.maxDist,
      // placement, read by the worker
      density: d,
      minH: def.ocean ? 0.7 : -1e9,
      maxH: base.maxH || 1e9,
      maxSlope: plant ? srng.range(0.18, 0.3) : srng.range(0.3, 0.55),
      minSlope: 0,
      moistMin: plant ? srng.range(0.0, 0.45) : 0,
      moistMax: plant ? srng.range(0.65, 1.0) : 1,
      cluster: base.cluster * srng.range(0.7, 1.3),
      clusterScale: srng.range(30, 90),
      scaleMin: base.scale[0],
      scaleMax: base.scale[1],
      align: plant ? srng.range(0.0, 0.25) : srng.range(0.6, 1.0),
      sink: plant ? 0.05 : srng.range(0.15, 0.35),
      slopeSink: plant ? 0.2 : 0.4,
      lift: base.lift || 0,
      moistScale: plant ? 1 : 0,
      palette: def.palette,
      style: srng.int(0, 3),
    };
    if (kind === 'palm') {
      sp.maxH = 30;
      sp.moistMin = 0;
    }
    if (kind === 'crystal' && res !== 'hydrogel') sp.density *= 0.6;
    species.push(sp);
    i++;
  }
  return species;
}

// fields the worker needs, the rest stays on the main thread
export function placementFields(sp) {
  const keys = ['id', 'seed', 'density', 'minH', 'maxH', 'maxSlope', 'minSlope', 'moistMin', 'moistMax', 'cluster', 'clusterScale', 'scaleMin', 'scaleMax', 'align', 'sink', 'slopeSink', 'lift', 'moistScale'];
  const out = {};
  for (const k of keys) out[k] = sp[k];
  return out;
}
