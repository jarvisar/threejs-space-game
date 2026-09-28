import { RNG, hashCombine } from '../core/rng.js';
import { STAR_CLASSES, CORE_INDEX } from './galaxy.js';
import { PLANET_TYPES, GAS_PALETTES, buildPalette, buildTerrain, buildLandforms, roll } from './planetTypes.js';
import { planetName, makeName } from './names.js';

// Some systems have a comet, the start system always does. Own RNG so
// systems without one generate exactly as before.
// It sits in the inner system, well above the plane of the planets, so from
// the planets its tail is seen from the side instead of end on. That also
// puts it near the sun in their skies, best at dusk and dawn.
function cometDef(systemSeed, isStart, starRadius) {
  const rng = new RNG((systemSeed ^ 0xc0e7) >>> 0);
  if (!isStart && !rng.chance(0.35)) return null;
  const a = rng.range(0, Math.PI * 2);
  const d = rng.range(30000, 50000) + starRadius * 3;
  const incl = rng.range(1.0, 1.3) * (rng.chance(0.5) ? 1 : -1);
  return {
    seed: rng.seed(),
    position: [Math.cos(a) * Math.cos(incl) * d, Math.sin(incl) * d, Math.sin(a) * Math.cos(incl) * d],
    radius: rng.range(140, 260),
    tail: rng.range(60000, 95000),
    dust: rng.pick(['#fff1d6', '#ffe7c2', '#f4f0ff']),
    ion: rng.pick(['#7fc8ff', '#8fa8ff', '#7fffe6']),
  };
}

// Star system layout, in meters with the star at the origin. Planets don't
// orbit. Keeping them static makes landing and on-foot physics much simpler.

const ZONE_WEIGHTS = {
  hot: [['volcanic', 3], ['desert', 3], ['radioactive', 2], ['toxic', 1], ['barren', 2], ['exotic', 0.25]],
  temperate: [['lush', 4], ['ocean', 1.6], ['toxic', 1.6], ['desert', 1.2], ['radioactive', 0.8], ['exotic', 0.35]],
  cold: [['frozen', 4], ['barren', 2], ['toxic', 0.8], ['radioactive', 0.8], ['dead', 1], ['exotic', 0.25]],
};

// Per resonance: spire host first, then the worlds the next drive needs
// (Frost wants cryonite, Azure wants uranite and cobalt, Chorus wants pyrocite,
// vitriol and verdite, the Harmonic Lens wants aetherium).
const RESONANT_TYPES = [
  ['lush', 'frozen'],
  ['ocean', 'radioactive', 'barren'],
  ['lush', 'volcanic', 'toxic'],
  ['exotic', 'exotic'],
];

const MOON_TYPES = [['dead', 4], ['barren', 3], ['frozen', 2], ['volcanic', 1], ['radioactive', 1], ['lush', 0.5], ['exotic', 0.3]];

function zoneFor(index, count, cls, rng) {
  let t = count <= 1 ? 0.5 : index / (count - 1);
  const shift = { M: -0.25, K: -0.1, G: 0, F: 0.1, A: 0.18, B: 0.28, O: 0.35, X: 0.1 }[cls] || 0;
  t = t - shift + rng.range(-0.15, 0.15);
  if (t < 0.3) return 'hot';
  if (t < 0.68) return 'temperate';
  return 'cold';
}

function hazardFor(type, rng) {
  const [kind, a, b] = type.hazard;
  return { type: kind, level: rng.range(a, b) };
}

export function makeRockyPlanet(seed, typeId, radius, opts = {}) {
  const rng = new RNG(seed);
  const type = PLANET_TYPES[typeId];
  const palette = buildPalette(rng, type);
  const terrain = buildTerrain(rng, type, radius, seed);

  const hasAtmo = opts.forceAtmo ?? rng.chance(type.atmo);
  let ocean = null;
  const wantsOcean = opts.forceOcean ?? rng.chance(type.ocean);
  if (wantsOcean && (hasAtmo || type.oceanMode === 'ice')) {
    ocean = { shallow: palette.oceanShallow, deep: palette.oceanDeep, mode: type.oceanMode || 'water' };
    terrain.hasOcean = true;
  } else {
    // no ocean means low ground is dry basin, keep it shallow
    terrain.oceanDepth *= 0.35;
    terrain.contBias += 0.15;
  }

  const maxH = terrain.contAmp + terrain.mountAmp + terrain.hillAmp + terrain.pillarAmp;
  // after maxH so atmosphere and cloud heights stay what they were
  buildLandforms(terrain, typeId);
  let atmosphere = null;
  if (hasAtmo) {
    const thick = type.thickness * rng.range(0.85, 1.15);
    atmosphere = {
      height: radius * 0.15 + maxH * 0.5,
      sky: palette.sky,
      density: thick,
      mie: rng.range(0.6, 1.4) * (typeId === 'desert' || typeId === 'barren' ? 2.2 : 1),
      mieG: rng.range(0.72, 0.84),
    };
  }

  let clouds = null;
  if (hasAtmo) {
    const cov = roll(rng, type.clouds);
    if (cov > 0.05) {
      clouds = {
        coverage: cov,
        altitude: Math.max(atmosphere.height * rng.range(0.45, 0.58), maxH * 1.1),
        color: palette.cloud,
        scale: rng.range(3.5, 7),
        speed: rng.range(0.004, 0.012),
        seed: rng.range(0, 100),
      };
    }
  }

  const hazard = hazardFor(type, rng);
  const floraDensity = roll(rng, type.flora);
  const faunaDensity = roll(rng, type.fauna);

  let rings = null;
  if (!opts.isMoon && rng.chance(0.12)) {
    rings = {
      inner: radius * rng.range(1.5, 1.9),
      outer: radius * rng.range(2.4, 3.4),
      color: palette.sand,
      color2: palette.high,
      opacity: rng.range(0.5, 0.85),
      tilt: [rng.range(-0.5, 0.5), rng.range(0, Math.PI * 2)],
      seed: rng.range(0, 100),
    };
  }

  return {
    kind: 'rocky',
    seed,
    type: typeId,
    typeLabel: type.label,
    radius,
    terrain,
    palette,
    atmosphere,
    ocean,
    clouds,
    rings,
    hazard,
    weather: hasAtmo ? type.weather : null,
    floraDensity,
    faunaDensity: hasAtmo ? faunaDensity : 0,
    resource: type.resource,
    maxHeight: maxH,
  };
}

function makeGasGiant(seed, radius) {
  const rng = new RNG(seed);
  const bands = rng.pick(GAS_PALETTES);
  const hasRings = rng.chance(0.65);
  return {
    kind: 'gas',
    seed,
    type: 'gas',
    typeLabel: 'Gas Giant',
    radius,
    bands,
    turbulence: rng.range(0.4, 1.2),
    bandScale: rng.range(6, 14),
    storm: rng.chance(0.6) ? { lat: rng.range(-0.5, 0.5), lon: rng.range(0, Math.PI * 2), size: rng.range(0.08, 0.18) } : null,
    atmosphere: {
      height: radius * 0.08,
      sky: [rng.range(0.4, 1), rng.range(0.4, 1), rng.range(0.6, 1)],
      density: 0.24,
      mie: 0.4,
      mieG: 0.7,
    },
    rings: hasRings
      ? {
          inner: radius * rng.range(1.25, 1.5),
          outer: radius * rng.range(2.0, 2.8),
          color: bands[2],
          color2: bands[1],
          opacity: rng.range(0.55, 0.9),
          tilt: [rng.range(-0.45, 0.45), rng.range(0, Math.PI * 2)],
          seed: rng.range(0, 100),
        }
      : null,
    hazard: { type: 'none', level: 0 },
    floraDensity: 0,
    faunaDensity: 0,
  };
}

export function generateSystem(galaxy, starIndex, story) {
  const info = galaxy.info(starIndex);
  const seed = info.seed;
  const rng = new RNG(seed);
  const cls = info.cls;
  const star = STAR_CLASSES[cls];
  const isStart = story && story.start === starIndex;
  const resonance = story ? story.resonances.indexOf(starIndex) : -1;

  const sys = {
    index: starIndex,
    seed,
    name: info.name,
    cls,
    star: {
      radius: star.radius * rng.range(0.9, 1.15),
      color: star.color,
      light: star.light,
      intensity: star.intensity,
    },
    planets: [],
    asteroidFields: [],
    isStart,
    resonance,
  };

  // resonant systems always carry what the next drive upgrade needs, and the
  // first planet (the spire host) is one worth looking at
  const forced = resonance >= 0 ? RESONANT_TYPES[Math.min(resonance, RESONANT_TYPES.length - 1)] : null;
  let count = rng.int(2, 5);
  if (isStart) count = 4;
  if (forced) count = Math.max(count, forced.length + 1);
  let dist = rng.range(60000, 85000) + sys.star.radius * 4;
  const baseAngle = rng.range(0, Math.PI * 2);
  let gasCount = 0;

  for (let i = 0; i < count; i++) {
    const pseed = hashCombine(seed, 1000 + i);
    const prng = new RNG(pseed);
    const zone = zoneFor(i, count, cls, prng);
    let def;
    const wantGas = !isStart && !(forced && i < forced.length) && zone !== 'hot' && gasCount < 1 && prng.chance(0.28);
    if (isStart && i === 3) {
      def = makeGasGiant(pseed, prng.range(22000, 28000));
      def.rings = def.rings || { inner: def.radius * 1.35, outer: def.radius * 2.4, color: def.bands[2], color2: def.bands[1], opacity: 0.8, tilt: [0.3, 1.2], seed: 5 };
      gasCount++;
    } else if (wantGas) {
      def = makeGasGiant(pseed, prng.range(18000, 32000));
      gasCount++;
    } else {
      let typeId;
      if (isStart && i === 0) typeId = 'lush';
      else if (isStart && i === 1) typeId = 'desert';
      else if (isStart && i === 2) typeId = 'frozen';
      else if (forced && i < forced.length) typeId = forced[i];
      else {
        const weights = ZONE_WEIGHTS[zone].map(([t, w]) => [t, cls === 'X' && t === 'exotic' ? w * 10 : w]);
        typeId = prng.weighted(weights);
      }
      const radius = typeId === 'dead' || typeId === 'barren' ? prng.range(3600, 5200) : prng.range(4400, 7000);
      let opts = {};
      if (isStart && i === 0) opts = { forceAtmo: true, forceOcean: true };
      else if (forced && i === 0) opts = { forceAtmo: true };
      def = makeRockyPlanet(pseed, typeId, radius, opts);
    }
    def.name = planetName(pseed, sys.name, i);
    def.id = `${starIndex}:${i}`;

    // spread planets around the star so they're visible from each other
    const angle = baseAngle + i * rng.range(1.1, 2.2);
    const incl = rng.range(-0.08, 0.08);
    def.position = [Math.cos(angle) * dist, Math.sin(incl) * dist, Math.sin(angle) * dist];
    def.orbit = dist;
    sys.planets.push(def);
    const parentIndex = sys.planets.length - 1;

    // moons
    let moonCount = def.kind === 'gas' ? prng.int(1, 3) : prng.chance(0.4) ? 1 : 0;
    if (isStart && i === 0) moonCount = 1;
    if (isStart && i === 3) moonCount = 2;
    for (let m = 0; m < moonCount; m++) {
      const mseed = hashCombine(pseed, 50 + m);
      const mrng = new RNG(mseed);
      const mtype = isStart && i === 3 && m === 0 ? 'lush' : mrng.weighted(MOON_TYPES);
      const mr = mrng.range(2200, 3200);
      const moon = makeRockyPlanet(mseed, mtype, mr, { isMoon: true });
      moon.name = makeName(mseed, 2, 3);
      moon.id = `${starIndex}:${i}m${m}`;
      moon.isMoon = true;
      moon.parent = parentIndex;
      const parentR = def.radius + (def.atmosphere ? def.atmosphere.height : 0);
      const md = parentR * mrng.range(2.4, 3.6) + mr * 3 + 5000;
      const ma = mrng.range(0, Math.PI * 2);
      const mi = mrng.range(-0.3, 0.3);
      moon.position = [
        def.position[0] + Math.cos(ma) * md,
        def.position[1] + Math.sin(mi) * md,
        def.position[2] + Math.sin(ma) * md,
      ];
      moon.orbit = md;
      sys.planets.push(moon);
    }

    dist += rng.range(45000, 90000) + (def.kind === 'gas' ? def.radius * 3 : 0);
  }

  // the first planet of a resonant system hosts the Chorus spire
  if (forced) {
    const host = sys.planets[0];
    host.spire = { index: resonance, dir: randomDir(rng) };
  }

  sys.comet = cometDef(seed, isStart, sys.star.radius);
  if (sys.comet) sys.comet.name = `Comet ${makeName(sys.comet.seed, 2, 2)}`;

  const fieldCount = rng.chance(0.6) ? rng.int(1, 2) : 0;
  for (let f = 0; f < fieldCount; f++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(70000, dist * 0.8);
    sys.asteroidFields.push({
      seed: hashCombine(seed, 7000 + f),
      position: [Math.cos(a) * d, rng.range(-3000, 3000), Math.sin(a) * d],
      radius: rng.range(2200, 3600),
      count: rng.int(420, 620),
    });
  }

  return sys;
}

// The destination of the Core Jump. Not part of the star list.
export function generateCoreSystem(galaxy) {
  const seed = hashCombine(galaxy.seed, 0xc0de);
  const rng = new RNG(seed);
  const sys = {
    index: CORE_INDEX,
    seed,
    name: 'The Heart',
    cls: 'X',
    starLabel: 'Galactic Core',
    star: { radius: 38000, color: '#fff1cc', light: '#fff4e0', intensity: 1.2 },
    planets: [],
    asteroidFields: [],
    isStart: false,
    isCore: true,
    resonance: -1,
  };
  const names = ['Coda', 'Refrain', 'Cadence', 'Unison'];
  for (let i = 0; i < 4; i++) {
    const pseed = hashCombine(seed, 100 + i);
    const def = i === 2 ? makeGasGiant(pseed, 42000) : makeRockyPlanet(pseed, 'exotic', rng.range(4800, 6400), { forceAtmo: true });
    def.name = names[i];
    def.id = `core:${i}`;
    const d = 220000 + i * 110000;
    const a = 0.6 + i * 1.7;
    def.position = [Math.cos(a) * d, rng.range(-8000, 8000), Math.sin(a) * d];
    def.orbit = d;
    sys.planets.push(def);
  }
  return sys;
}

function randomDir(rng) {
  const z = rng.range(-0.8, 0.8);
  const t = rng.range(0, Math.PI * 2);
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(t), z, r * Math.sin(t)];
}
