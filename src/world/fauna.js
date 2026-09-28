import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG, hashCombine } from '../core/rng.js';
import { speciesName } from '../gen/names.js';
import { patchStandard, env } from '../render/materials.js';

// Procedural creatures: grazers that wander in herds, flocks of flyers,
// drifting floaters and the odd sky leviathan. Only a few dozen exist at once,
// all near the player, so behaviour runs on the CPU and the animation (legs,
// wings, heads, tentacles) is done in the vertex shader from per-vertex rig
// data. Each species picks a body plan from seeded traits.

const TAU = Math.PI * 2;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _d = new THREE.Vector3();

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
    const sp = {
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
    };
    sp.look = faunaLook(sp, def);
    out.push(sp);
  }
  // the occasional sky leviathan, a huge slow flyer circling far overhead
  if (['lush', 'ocean', 'exotic'].includes(def.type) && rng.chance(0.45)) {
    const seed = hashCombine(def.seed, 5999);
    const r = new RNG(seed);
    const pal = def.palette;
    const sp = {
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
    };
    sp.look = faunaLook(sp, def);
    out.push(sp);
  }
  return out;
}

// Visual traits. They come from their own RNG so the catalogued fields above
// stay exactly what they were before body plans existed.
function faunaLook(sp, def) {
  const pal = def.palette;
  const v = new RNG(hashCombine(sp.seed, 77));
  const look = {
    plan: '',
    pattern: v.pick(['plain', 'stripes', 'spots', 'saddle', 'dapple', 'bands']),
    patCol: v.pick([pal.leaf[v.int(0, 2)], pal.high, pal.veg2 || pal.sand, null]),
    stripes: v.range(2.2, 3.8),
    stripeOff: v.range(0, TAU),
    glowPattern: sp.glow && v.chance(0.6),
    eyeStyle: v.chance(0.6) ? 'dot' : 'white',
    eyes: v.pick([2, 2, 2, 2, 1, 4]),
    eyeSize: v.range(0.85, 1.3),
    glowEyes: sp.glow && v.chance(0.35),
    lids: v.chance(0.2),
    ears: v.pick(['none', 'long', 'round', 'fin', 'antennae']),
    crest: v.chance(0.35),
    blush: v.chance(0.45),
    leaf: pal.leaf[v.int(0, 2)],
    seed: v.seed(),
    // pattern in a neighbouring hue of the body instead of a palette color
    analog: v.chance(0.5) ? v.pick([-1, 1]) * v.range(0.05, 0.12) : 0,
    ground: groundColors(def),
    swatches: [...pal.leaf, pal.veg, pal.veg2, pal.sand, pal.high, pal.mid, pal.low, pal.peak, pal.trunk, pal.oceanShallow, pal.glow].filter(Boolean),
  };
  if (sp.kind === 'grazer') {
    look.plan = sp.legs === 6
      ? v.pick(['beetle', 'beetle', 'armored', 'puff'])
      : v.weighted([['browser', sp.neck > 0.55 ? 3 : 1], ['hopper', 2], ['puff', 2], ['armored', 1.5], ['strider', sp.legLen > 1.0 ? 2 : 0.4]]);
    look.gait = v.pick(['walk', 'trot']);
    look.armor = v.pick(['bands', 'plates', 'spikes']);
    look.horn = v.pick(['spike', 'curl', 'knob']);
    look.tail = v.pick(['tuft', 'plain', 'pom', 'fan']);
  } else if (sp.kind === 'flyer') {
    look.plan = v.weighted([['bird', 3], ['bat', 2], ['manta', 1.5], ['dragonfly', 1.5]]);
  } else if (sp.kind === 'floater') {
    look.plan = v.weighted([['jelly', 3], ['balloon', 2], ['siphon', 1.5], ['comb', 1.5]]);
  } else {
    look.plan = v.weighted([['whale', 3], ['manta', 2], ['serpent', 2]]);
    look.garden = v.chance(0.5);
  }
  return look;
}

// ---------------------------------------------------------------- geometry

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const _X = V(1, 0, 0);
const ZERO = V(0, 0, 0);

function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// hue, saturation and lightness shifts done in sRGB so they look like it
function tone(c, dh = 0, ds = 0, dl = 0) {
  const hsl = c.getHSL({}, THREE.SRGBColorSpace);
  const cl = (x) => Math.min(1, Math.max(0, x));
  return new THREE.Color().setHSL((hsl.h + dh + 1) % 1, cl(hsl.s + ds), cl(hsl.l + dl), THREE.SRGBColorSpace);
}

function withLight(c, sat, l) {
  const hsl = c.getHSL({}, THREE.SRGBColorSpace);
  return new THREE.Color().setHSL(hsl.h, hsl.s * sat, l, THREE.SRGBColorSpace);
}

// Palette picks can be muddy terrain tones. Keep the hue and lift them into
// the soft pastel range the rest of the art uses. Greys stay grey.
function pastel(c, l0, l1, s0, s1 = 0.85) {
  const hsl = c.getHSL({}, THREE.SRGBColorSpace);
  const s = hsl.s < 0.06 ? hsl.s : Math.min(s1, Math.max(s0, hsl.s));
  return new THREE.Color().setHSL(hsl.h, s, Math.min(l1, Math.max(l0, hsl.l)), THREE.SRGBColorSpace);
}

function differ(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

// OKLab from linear rgb, distances in it roughly match how different two
// colors look. Lightness counts a bit extra, it's what separates a shape
// from the ground at a distance.
function lab(c) {
  const l = Math.cbrt(0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b);
  const m = Math.cbrt(0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b);
  const s = Math.cbrt(0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function labDist(p, q) {
  return Math.hypot((p[0] - q[0]) * 1.4, p[1] - q[1], p[2] - q[2]);
}

// Palette colors the terrain mostly shows, weighted by how much ground they
// cover (see createTerrainMaterial). Based on the palette, not the shader.
const VEG = { lush: 1, ocean: 1, toxic: 0.8, exotic: 0.8, radioactive: 0.45, desert: 0.2, frozen: 0.3, volcanic: 0.25, barren: 0.12 };

function groundColors(def) {
  const p = def.palette;
  const veg = VEG[def.type] ?? 0.5;
  const out = [[p.low, 1], [p.mid, 1], [p.high, 0.8], [p.cliff, 0.5]];
  if (veg > 0.15) out.push([p.veg, veg], [p.veg2, veg]);
  if (def.ocean) out.push([p.sand, 0.7]);
  if (def.type === 'frozen') out.push([p.peak, 0.9]);
  return out.filter((g) => g[0]);
}

// How much a color stands out against the ground, the worst case over the
// ground colors. Colors that only cover a little ground count less. Being
// lighter than the ground counts for less than being darker, the ground faces
// the sun and renders brighter than its palette color while a creature's
// sides don't.
function standout(p, ground) {
  let m = Infinity;
  for (const [g, w] of ground) {
    const dl = p[0] - g[0];
    const d = Math.hypot(dl * (dl > 0 ? 0.7 : 1.15), p[1] - g[1], p[2] - g[2]);
    m = Math.min(m, d + (1 - w) * 0.08);
  }
  return m;
}

// Keeps a creature color if it stands out enough from the ground. Otherwise
// picks from cands ([color, cost]) the one that passes and stays closest to
// ref, so it changes as little as it has to. avoid lists other colors of the
// creature it has to stay apart from.
function fitColor(c, need, ground, cands, rng, avoid = [], ref = c) {
  const ok = (p) => standout(p, ground) >= need && avoid.every(([q, d]) => labDist(p, q) >= d);
  const p0 = lab(c);
  if (ok(p0)) return c;
  const pr = lab(ref);
  let best = null;
  let bestS = Infinity;
  // if nothing passes, the one that stands out most
  let fallback = c;
  let most = standout(p0, ground);
  for (const [x, cost] of cands) {
    const p = lab(x);
    const s = standout(p, ground);
    if (s > most) {
      most = s;
      fallback = x;
    }
    if (!ok(p)) continue;
    // Some margin over the minimum is worth a bigger change. A little seeded
    // noise so species on one planet don't all land on the same swatch.
    const score = labDist(p, pr) - Math.min(s, need + 0.1) * 0.6 + cost + rng.range(0, 0.05);
    if (score < bestS) {
      bestS = score;
      best = x;
    }
  }
  return best || fallback;
}

// palette swatches plus hue and lightness shifts of c, all graded pastel
function shifts(c, grade, swatches, swatchCost, shiftCost) {
  const out = swatches.map((h) => [grade(new THREE.Color(h)), swatchCost]);
  for (const dh of [0, 0.08, -0.08, 0.16, -0.16, 0.25, -0.25, 0.33, -0.33, 0.5]) {
    for (const dl of [0, 0.14, -0.14]) if (dh || dl) out.push([grade(tone(c, dh, 0, dl)), shiftCost]);
  }
  return out;
}

// Collects primitives for one species. Every vertex gets a color plus the rig
// data the vertex shader animates with:
//   aPart    part id (see faunaRig)
//   aPivot   xyz joint the part turns around, w phase offset
//   aPivot2  xyz second joint (knee, elbow), w side or amplitude
//   aRig     x weight of the second joint, y position along the limb,
//            z glow (+2 when glossy), w travelling wave along the body
// Options for add(): color is a color or a painter (x, y, z, t, out) that can
// return a glow amount, w/glow/t can be numbers or functions of (x, y, z, t).
class Parts {
  constructor() {
    this.list = [];
  }

  add(geo, o = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'tt') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    const pos = g.attributes.position.array;
    const tt = g.attributes.tt ? g.attributes.tt.array : null;
    const col = new Float32Array(n * 3);
    const piv = new Float32Array(n * 4);
    const piv2 = new Float32Array(n * 4);
    const rig = new Float32Array(n * 4);
    const p1 = o.pivot || ZERO;
    const p2 = o.pivot2 || ZERO;
    const paint = typeof o.color === 'function' ? o.color : null;
    if (!paint) _c.set(o.color ?? 0xffffff);
    const val = (f, x, y, z, t) => (typeof f === 'function' ? f(x, y, z, t) : f || 0);
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const t = tt ? tt[i] : val(o.t, x, y, z, 0);
      let glow = paint ? paint(x, y, z, t, _c) || 0 : 0;
      if (o.glow !== undefined) glow = val(o.glow, x, y, z, t);
      col[i * 3] = _c.r;
      col[i * 3 + 1] = _c.g;
      col[i * 3 + 2] = _c.b;
      piv[i * 4] = p1.x;
      piv[i * 4 + 1] = p1.y;
      piv[i * 4 + 2] = p1.z;
      piv[i * 4 + 3] = o.phase || 0;
      piv2[i * 4] = p2.x;
      piv2[i * 4 + 1] = p2.y;
      piv2[i * 4 + 2] = p2.z;
      piv2[i * 4 + 3] = o.side || 0;
      rig[i * 4] = val(o.w, x, y, z, t);
      rig[i * 4 + 1] = t;
      rig[i * 4 + 2] = Math.min(1, glow) + (o.gloss ? 2 : 0);
    }
    if (tt) g.deleteAttribute('tt');
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(o.part || 0), 1));
    g.setAttribute('aPivot', new THREE.BufferAttribute(piv, 4));
    g.setAttribute('aPivot2', new THREE.BufferAttribute(piv2, 4));
    g.setAttribute('aRig', new THREE.BufferAttribute(rig, 4));
    this.list.push(g);
    return g;
  }

  // spine(x, y, z) sets the body wave on every vertex, positive is up and
  // down, negative side to side
  build(spine) {
    const g = mergeGeometries(this.list);
    this.list = [];
    if (spine) {
      const pos = g.attributes.position.array;
      const rig = g.attributes.aRig.array;
      for (let i = 0; i < g.attributes.position.count; i++) rig[i * 4 + 3] = spine(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    }
    g.computeBoundingSphere();
    return g;
  }
}

function ell(rx, ry, rz, detail = 2) {
  return new THREE.IcosahedronGeometry(1, detail).scale(rx, ry, rz);
}

// lat-long ellipsoid with its poles on z, the rings line up with bands across the body
function pod(rx, ry, rz, radial = 16, rings = 12) {
  return new THREE.SphereGeometry(1, radial, rings).rotateX(Math.PI / 2).scale(rx, ry, rz);
}

function at(g, p) {
  return g.translate(p.x, p.y, p.z);
}

// turns the geometry's +y toward dir
function along(g, dir) {
  return g.applyQuaternion(_q.setFromUnitVectors(UP, _d.copy(dir).normalize()));
}

// open tapered cylinder from a to b, the ends are hidden in joints
function limb(a, b, r0, r1, radial = 6) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, radial, 1, true);
  g.translate(0, len / 2, 0);
  along(g, d);
  return at(g, a);
}

// tube through points, radius r0..r1 or r0(t). Stores t along the length.
function tube(pts, r0, r1 = r0, radial = 6, segs = 10) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  const p = g.attributes.position;
  const ring = radial + 1;
  const centers = [];
  for (let i = 0; i <= segs; i++) centers.push(curve.getPointAt(i / segs));
  const tt = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const k = Math.floor(i / ring);
    const t = k / segs;
    const r = typeof r0 === 'function' ? r0(t) : r0 + (r1 - r0) * t;
    _v.fromBufferAttribute(p, i).sub(centers[k]).multiplyScalar(r).add(centers[k]);
    p.setXYZ(i, _v.x, _v.y, _v.z);
    tt[i] = t;
  }
  g.setAttribute('tt', new THREE.BufferAttribute(tt, 1));
  // Tapering changes the surface slope, especially at horns and necks.
  g.computeVertexNormals();
  return g;
}

// A closed fin with a raised leading surface and a thin trailing edge.
// Five points across the chord keep highlights broad at a distance.
function blade(len, width, segs, s = 1, sweep = 0, chord = 4) {
  const pos = [];
  const tt = [];
  const idx = [];
  const row = chord + 1;
  const layer = (segs + 1) * row;
  const quad = (a, b, c, d, reverse = false) => {
    if (reverse) idx.push(a, c, b, b, c, d);
    else idx.push(a, b, c, b, d, c);
  };
  for (let face = 0; face < 2; face++) {
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const w = Math.max(len * 0.0003, width(t));
      const z = sweep * t * t;
      for (let j = 0; j <= chord; j++) {
        const c = j / chord * 2 - 1;
        const arch = Math.max(0, 1 - c * c);
        const camber = len * 0.035 * Math.sin(t * Math.PI) * arch;
        const thick = len * 0.018 * (1 - t * 0.9) * (0.15 + 0.85 * arch);
        pos.push(s * t * len, camber + (face ? -thick : thick), z + w * c);
        tt.push(t);
        if (i < segs && j < chord) {
          const a = face * layer + i * row + j;
          quad(a, a + 1, a + row, a + row + 1, (s < 0) !== (face === 1));
        }
      }
    }
  }
  for (let i = 0; i < segs; i++) {
    const a = i * row;
    quad(a, a + row, a + layer, a + row + layer, s < 0);
    const b = a + chord;
    quad(b, b + layer, b + row, b + row + layer, s < 0);
  }
  for (let j = 0; j < chord; j++) {
    quad(j, j + layer, j + 1, j + layer + 1, s < 0);
    const a = segs * row + j;
    quad(a, a + 1, a + layer, a + layer + 1, s < 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('tt', new THREE.Float32BufferAttribute(tt, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function feather(len, width, segs = 7) {
  return blade(len, (t) => width * Math.pow(Math.sin(Math.PI * t), 0.65) * (1 - t * 0.28), segs, 1, len * 0.06, 2).rotateY(-Math.PI / 2);
}

// A stretched panel between two wing fingers, with the trailing edge
// pulled inward and the center billowing below the bones.
function membrane(root, a, b, sag, segs = 5) {
  const pos = [root.x, root.y, root.z];
  const idx = [];
  const tt = [0];
  const reverse = (a.x - root.x) * (b.z - root.z) - (a.z - root.z) * (b.x - root.x) < 0;
  const triangle = (i, j, k) => { if (reverse) idx.push(i, k, j); else idx.push(i, j, k); };
  for (let j = 0; j < segs; j++) triangle(0, j + 2, j + 1);
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    for (let j = 0; j <= segs; j++) {
      const u = j / segs;
      const edge = a.clone().lerp(b, u);
      edge.lerp(root, Math.sin(u * Math.PI) * 0.22);
      const p = root.clone().lerp(edge, t);
      p.y -= Math.sin(u * Math.PI) * Math.sin(t * Math.PI) * sag;
      pos.push(p.x, p.y, p.z);
      tt.push(t);
      if (i < segs && j < segs) {
        const k = 1 + (i - 1) * (segs + 1) + j;
        triangle(k, k + 1, k + segs + 1);
        triangle(k + 1, k + segs + 2, k + segs + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('tt', new THREE.Float32BufferAttribute(tt, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ribbon through points, for oral arms and streamers. twist in turns.
function ribbon(pts, width, segs, twist = 0) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [];
  const tt = [];
  const idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const c = curve.getPointAt(t);
    const a = t * twist * TAU;
    const d = frames.normals[i].clone().multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
    const w = width(t);
    pos.push(c.x - d.x * w, c.y - d.y * w, c.z - d.z * w, c.x + d.x * w, c.y + d.y * w, c.z + d.z * w);
    tt.push(t, t);
    if (i < segs) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('tt', new THREE.Float32BufferAttribute(tt, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- coloring

// Render-time colors. The stored body and belly stay as they are, only what
// gets drawn is adjusted so creatures don't vanish into their own ground.
// taken holds the body colors of species already built on this planet, so
// two species don't get pushed to the same color.
function colorsFor(sp, taken = []) {
  const L = sp.look;
  const rng = new RNG(hashCombine(sp.seed, 78));
  const ground = L.ground.map(([h, w]) => [lab(new THREE.Color(h)), w]);
  const acc = new THREE.Color(sp.accent);
  const gBase = (c) => pastel(c, 0.58, 0.76, 0.45, 0.62);
  const gBelly = (c) => pastel(c, 0.62, 0.86, 0.3, 0.6);
  const gPat = (c) => pastel(c, 0.5, 0.76, 0.35, 0.55);
  const body = gBase(new THREE.Color(sp.body));
  const base = fitColor(body, 0.19, ground, shifts(body, gBase, L.swatches, 0, 0.05), rng, [[lab(acc), 0.06], ...taken.map((t) => [lab(t), 0.1])]);
  taken.push(base);
  // a belly that has to change goes toward a lighter, softer body color
  let belly = gBelly(new THREE.Color(sp.belly));
  const soft = gBelly(tone(base, 0.03, -0.08, 0.2));
  if (differ(base, belly) < 0.2) belly = soft;
  const bellyCands = [0, 0.05, -0.05, 0.12, -0.12].flatMap((dh) => [0.12, 0.2, 0.28].map((dl) => [gBelly(tone(base, dh, -0.1, dl)), 0])).concat(shifts(belly, gBelly, L.swatches, 0.04, 0.06));
  belly = fitColor(belly, 0.11, ground, bellyCands, rng, [[lab(base), 0.07]], soft);
  // and a pattern toward a neighbouring hue of the body
  let pat = L.analog ? tone(base, L.analog, 0.08, L.analog > 0 ? 0.12 : -0.15) : L.patCol ? gPat(new THREE.Color(L.patCol)) : tone(base, 0, 0.05, -0.16);
  if (differ(pat, base) < 0.2) pat = tone(base, 0.05, 0.08, -0.2);
  pat = gPat(pat);
  const patCands = [0.06, -0.06, 0.12, -0.12, 0.2, -0.2].flatMap((dh) => [0.14, -0.14].map((dl) => [gPat(tone(base, dh, 0.05, dl)), 0])).concat(shifts(pat, gPat, L.swatches, 0.03, 0.05));
  pat = fitColor(pat, 0.11, ground, patCands, rng, [[lab(base), 0.07]]);
  const C = {
    base,
    belly,
    pat,
    acc,
    dark: withLight(base, 0.5, 0.24),
    pale: tone(belly, 0, -0.05, 0.12),
    pupil: withLight(base, 0.4, 0.08),
    white: new THREE.Color(0xf6f8ff),
    blush: new THREE.Color('#ff8fae').lerp(acc, 0.2),
  };
  // Pattern on the back, belly color underneath. cy and ry are the part's
  // center height and vertical radius so the belly line follows each part,
  // zc and zr place stripes along its length.
  C.skin = (cy, ry, zc = 0, zr = 1, top = base) => (x, y, z, t, out) => {
    const bel = smooth(cy + ry * 0.05, cy - ry * 0.7, y);
    const back = smooth(cy - ry * 0.3, cy + ry * 0.4, y);
    const u = (z - zc) / zr;
    let m = 0;
    if (L.pattern === 'stripes') m = smooth(0.25, 0.65, Math.cos(u * L.stripes * Math.PI + L.stripeOff)) * back;
    else if (L.pattern === 'saddle') m = smooth(cy + ry * 0.1, cy + ry * 0.55, y) * smooth(-0.95, -0.4, u) * smooth(0.95, 0.4, u);
    else if (L.pattern === 'bands') m = smooth(0.3, 0.6, Math.cos(u * 1.7 * Math.PI + L.stripeOff)) * (1 - bel);
    // only the thinner patterns glow, a glowing saddle is just a lamp
    const glow = L.glowPattern && L.pattern === 'stripes';
    out.copy(top).lerp(glow ? acc : pat, m).lerp(belly, bel);
    return glow ? m * 0.7 : 0;
  };
  // legs darken toward the feet
  C.sock = (y0, y1) => (x, y, z, t, out) => {
    out.copy(base).lerp(C.dark, smooth(y0, y1, y) * 0.7);
  };
  return C;
}

// Raised spots on an ellipsoid's upper half, tilted around x like the part.
// Dapple is the same as small soft freckles. Painted into vertex colors it
// smudged across the big low poly triangles.
function spots(P, C, L, v, c, rx, ry, rz, n, size, rig, tilt = 0) {
  const dapple = L.pattern === 'dapple';
  const col = dapple ? C.base.clone().lerp(C.pat, 0.75) : L.glowPattern ? C.acc : C.pat;
  const glow = !dapple && L.glowPattern ? 1 : 0;
  if (dapple) {
    n = Math.round(n * 1.8);
    size *= 0.55;
  }
  for (let i = 0; i < n; i++) {
    const phi = v.range(0.15, 1.35);
    const th = v.range(0, TAU);
    const d = V(Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th));
    if (Math.abs(d.z) > 0.8) continue;
    const nrm = V(d.x / rx, d.y / ry, d.z / rz).normalize().applyAxisAngle(_X, tilt);
    const s = size * v.range(0.7, 1.2);
    const p = V(d.x * rx, d.y * ry, d.z * rz).applyAxisAngle(_X, tilt).add(c).addScaledVector(nrm, s * 0.08);
    P.add(at(along(ell(s, s * 0.28, s, n > 7 ? 0 : 1), nrm), p), { ...rig, color: col, glow });
  }
}

// Big friendly eye looking along dir. Dot eyes are all pupil.
function eye(P, C, L, c, dir, r, rig) {
  const pupil = L.glowEyes ? C.acc : C.pupil;
  const glow = L.glowEyes ? 0.9 : 0;
  if (L.eyeStyle === 'dot') {
    P.add(at(ell(r, r, r, 1), c), { ...rig, color: pupil, glow, gloss: true });
  } else {
    P.add(at(ell(r, r, r, 1), c), { ...rig, color: C.white, glow: 0, gloss: true });
    P.add(at(ell(r * 0.64, r * 0.64, r * 0.64, 1), c.clone().addScaledVector(dir, r * 0.48)), { ...rig, color: pupil, glow, gloss: true });
  }
  const hd = dir.clone().add(V(dir.x * 0.4, 0.75, 0)).normalize();
  P.add(at(ell(r * 0.26, r * 0.26, r * 0.26, 0), c.clone().addScaledVector(hd, r * (L.eyeStyle === 'dot' ? 0.9 : 0.98))), { ...rig, color: C.white, glow: 0.3 });
  if (L.lids) {
    const lid = new THREE.SphereGeometry(r * 1.1, 10, 4, 0, TAU, 0, Math.PI * 0.32);
    P.add(at(along(lid, V(0, 1, 0).addScaledVector(dir, 0.55)), c), { ...rig, color: C.base, glow: 0 });
  }
}

function addEyes(P, C, L, hc, r, rig, o = {}) {
  const size = r * 0.3 * L.eyeSize * (o.scale || 1);
  const sp = o.spread ?? 0.55;
  const up = o.up ?? 0.28;
  const list = L.eyes === 1 ? [[0, up + 0.05, 1.5]] : L.eyes === 4 ? [[-sp * 0.8, up + 0.18, 0.85], [sp * 0.8, up + 0.18, 0.85], [-sp * 1.15, up - 0.22, 0.62], [sp * 1.15, up - 0.22, 0.62]] : [[-sp, up, 1], [sp, up, 1]];
  for (const [x, y, k] of list) {
    const dir = V(x, y, -0.8).normalize();
    const er = size * k;
    eye(P, C, L, hc.clone().addScaledVector(dir, r * 0.96 - er * 0.45), dir, er, rig);
  }
}

// ears, horns, crest and cheeks on a round head
function headDeco(P, C, sp, hc, r, rig) {
  const L = sp.look;
  const up = (y0, y1) => (x, y) => smooth(y0, y1, y);
  if (L.ears === 'long' || L.ears === 'round') {
    const long = L.ears === 'long';
    for (const s of [-1, 1]) {
      const ear = long ? ell(r * 0.26, r * 0.9, r * 0.12, 1).translate(0, r * 0.85, 0) : ell(r * 0.42, r * 0.42, r * 0.1, 1).translate(0, r * 0.35, 0);
      const inner = long ? ell(r * 0.15, r * 0.66, r * 0.06, 1).translate(0, r * 0.82, -r * 0.08) : ell(r * 0.26, r * 0.26, r * 0.05, 1).translate(0, r * 0.35, -r * 0.07);
      for (const [g, col] of [[ear, C.skin(hc.y, r)], [inner, C.blush]]) {
        g.rotateX(long ? 0.3 : 0.1).rotateZ(-s * (long ? 0.5 : 0.7)).translate(hc.x + s * r * 0.45, hc.y + r * 0.5, hc.z + r * 0.1);
        P.add(g, { ...rig, w: 1, color: col, t: up(hc.y + r * 0.6, hc.y + r * 2.2) });
      }
    }
  } else if (L.ears === 'fin') {
    for (const s of [-1, 1]) {
      const g = new THREE.ShapeGeometry(new THREE.Shape([[0, 0], [-0.35, 0.75], [-0.05, 0.62], [0.15, 0.95], [0.3, 0.55], [0.4, 0]].map(([x, y]) => new THREE.Vector2(x * r, y * r))));
      g.rotateY(Math.PI / 2).rotateZ(-s * 0.6).translate(hc.x + s * r * 0.6, hc.y + r * 0.3, hc.z + r * 0.2);
      P.add(g, { ...rig, w: 1, color: (x, y, z, t, out) => { out.copy(C.pat).lerp(C.acc, smooth(hc.y + r * 0.5, hc.y + r * 1.3, y)); return L.glowPattern ? smooth(hc.y + r * 0.8, hc.y + r * 1.4, y) : 0; }, t: up(hc.y + r * 0.4, hc.y + r * 1.6) });
    }
  } else if (L.ears === 'antennae') {
    for (const s of [-1, 1]) {
      const a = V(hc.x + s * r * 0.3, hc.y + r * 0.75, hc.z);
      const b = V(hc.x + s * r * 0.55, hc.y + r * 1.7, hc.z - r * 0.25);
      const c = V(hc.x + s * r * 0.95, hc.y + r * 2.2, hc.z - r * 0.1);
      P.add(tube([a, b, c], r * 0.07, r * 0.04, 4, 6), { ...rig, w: 1, color: C.dark });
      P.add(at(ell(r * 0.16, r * 0.16, r * 0.16, 1), c), { ...rig, w: 1, t: 1, color: sp.glow ? C.acc : C.pat, glow: sp.glow ? 1 : 0 });
    }
  }
  if (sp.horns) {
    for (const s of [-1, 1]) {
      if (L.horn === 'spike') {
        const pts = [V(s * 0.4, 0.6, -0.1), V(s * 0.58, 0.98, -0.12), V(s * 0.66, 1.35, 0.02), V(s * 0.62, 1.57, 0.2)].map((p) => p.multiplyScalar(r).add(hc));
        P.add(tube(pts, (t) => r * 0.14 * (1 - t) ** 0.8 + r * 0.004, 0, 7, 9), { ...rig, w: 1, color: (x, y, z, t, out) => { out.copy(C.pale).lerp(C.pat, t * t * 0.4); } });
      } else if (L.horn === 'curl') {
        const pts = [V(s * 0.45, 0.55, 0), V(s * 0.95, 0.95, 0.35), V(s * 1.15, 0.55, 0.85), V(s * 0.95, 0.15, 0.7)].map((p) => p.multiplyScalar(r).add(hc));
        P.add(tube(pts, r * 0.14, r * 0.04, 6, 10), { ...rig, w: 1, color: (x, y, z, t, out) => { out.copy(C.pale).lerp(C.dark, t * 0.5); } });
      } else {
        const a = V(hc.x + s * r * 0.3, hc.y + r * 0.7, hc.z);
        const b = V(hc.x + s * r * 0.42, hc.y + r * 1.35, hc.z + r * 0.05);
        P.add(limb(a, b, r * 0.09, r * 0.07, 5), { ...rig, w: 1, color: C.skin(hc.y, r) });
        P.add(at(ell(r * 0.14, r * 0.14, r * 0.14, 1), b), { ...rig, w: 1, color: C.pat });
      }
    }
  }
  if (L.crest) {
    for (let i = 0; i < 3; i++) {
      const h = r * (0.55 - i * 0.12);
      const g = feather(h, r * 0.14, 5).rotateX(-1.0 + i * 0.13);
      P.add(at(g, V(hc.x, hc.y + r * (0.82 - i * 0.12), hc.z + r * (0.05 + i * 0.3))), { ...rig, w: 1, color: C.acc, glow: L.glowPattern ? 0.8 : 0 });
    }
  }
  if (L.blush) {
    for (const s of [-1, 1]) {
      const d = V(s * 0.72, -0.18, -0.68).normalize();
      P.add(at(along(ell(r * 0.2, r * 0.05, r * 0.14, 1), d), hc.clone().addScaledVector(d, r * 0.93)), { ...rig, w: 1, color: C.blush });
    }
  }
}

function addHead(P, C, sp, hc, r, rig, o = {}) {
  const skull = pod(r, r * 0.92, r * 1.05, 16, 12);
  const p = skull.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const front = smooth(-r * 0.25, -r * 0.9, z);
    const muzzle = o.snout === false ? 0 : front * smooth(r * 0.16, -r * 0.4, y);
    p.setXYZ(i, x * (1 + muzzle * 0.16), y - muzzle * r * 0.04, z - muzzle * r * 0.3);
  }
  skull.computeVertexNormals();
  const skin = C.skin(hc.y, r, hc.z, r * 1.2);
  P.add(at(skull, hc), {
    ...rig, w: 1,
    color: (x, y, z, t, out) => {
      const gl = skin(x, y, z, t, out);
      if (o.snout !== false) out.lerp(C.pale, smooth(hc.z - r * 0.65, hc.z - r * 1.05, z) * smooth(hc.y + r * 0.1, hc.y - r * 0.22, y));
      return gl;
    },
  });
  if (o.snout !== false) {
    for (const s of [-1, 1]) {
      const nose = V(hc.x + s * r * 0.22, hc.y - r * 0.27, hc.z - r * 1.18);
      P.add(at(ell(r * 0.065, r * 0.045, r * 0.035, 1).rotateZ(s * 0.2), nose), { ...rig, w: 1, color: C.pupil });
    }
  }
  addEyes(P, C, sp.look, hc, r, { ...rig, w: 1 }, o);
  headDeco(P, C, sp, hc, r, rig);
}

function addTail(P, C, sp, base, len, r0, rig, droop = 0.6) {
  const L = sp.look;
  const pts = [base, V(base.x, base.y + len * 0.05, base.z + len * 0.35), V(base.x, base.y - len * droop * 0.4, base.z + len * 0.72), V(base.x, base.y - len * droop, base.z + len * 0.9)];
  const tip = pts[3];
  const r = { part: 6, pivot: base, side: 1, ...rig };
  if (L.tail === 'pom') {
    P.add(at(ell(r0 * 2.2, r0 * 2, r0 * 2.2, 1), V(base.x, base.y, base.z + r0)), { ...r, t: 0.3, color: C.pale });
    return;
  }
  P.add(tube(pts, r0, r0 * 0.35, 6, 8), { ...r, color: C.skin(base.y, r0 * 3, base.z, len) });
  if (L.tail === 'tuft') P.add(at(ell(r0 * 1.5, r0 * 1.5, r0 * 2.2, 1), tip), { ...r, t: 1, color: C.pat, glow: L.glowPattern ? 1 : 0 });
  else if (L.tail === 'fan') {
    const g = new THREE.ShapeGeometry(new THREE.Shape([[0, 0], [-0.5, 1], [0, 0.8], [0.5, 1]].map(([x, y]) => new THREE.Vector2(x * r0 * 3, y * r0 * 4))));
    g.rotateX(Math.PI / 2 + 0.6).translate(tip.x, tip.y, tip.z - r0);
    P.add(g, { ...r, t: 1, color: C.acc, glow: L.glowPattern ? 0.8 : 0 });
  }
}

// how far the head has to pitch down (radians) to reach the ground
function grazeAngle(piv, hc, r) {
  const d = hc.clone().sub(piv);
  for (let a = 0; a < 1.7; a += 0.05) {
    if (piv.y + d.y * Math.cos(a) + d.z * Math.sin(a) - r < 0.08) return a;
  }
  return 1.7;
}

// Leg phase offsets. Trot moves diagonal pairs together (and turns into the
// tripod gait with three rows), walk steps each row a quarter cycle apart.
function gaitPhase(gait, s, row) {
  const side = s < 0 ? 0 : Math.PI;
  return gait === 'walk' ? side + row * Math.PI * 0.5 : side + row * Math.PI;
}

// hip, knee, foot and hoof per leg. Rows are z positions, front first.
function legSet(P, C, o) {
  o.zs.forEach((z, row) => {
    for (const s of [-1, 1]) {
      const hip = V(s * o.hipX, o.hipY, z);
      const knee = V(s * (o.kneeX ?? o.hipX), o.kneeY, z + (o.kneeZ || 0));
      const foot = V(s * (o.footX ?? o.hipX), o.r * 0.6, z + (o.footZ || 0));
      const rig = { part: 1, pivot: hip, pivot2: knee, phase: gaitPhase(o.gait, s, row), side: 1 };
      const sock = C.sock(o.hipY * 0.6, 0);
      const bend = hip.distanceTo(knee) / (hip.distanceTo(knee) + knee.distanceTo(foot));
      const muscle = (t) => o.r * (t < bend
        ? 1.14 + Math.sin(t / bend * Math.PI) * 0.12 - t / bend * 0.35
        : 0.79 - smooth(bend, 1, t) * 0.2);
      const leg = tube([hip, hip.clone().lerp(knee, 0.35), knee, foot], muscle, 0, 8, 10);
      P.add(leg, { ...rig, color: sock, w: (x, y, z, t) => smooth(bend - 0.13, bend + 0.15, t) });
      for (const toe of [-1, 1]) {
        P.add(at(ell(o.r * 0.52, o.r * 0.68, o.r * 1.24, o.hoof ?? 1), V(foot.x + toe * o.r * 0.48, foot.y, foot.z - o.r * 0.26)), { ...rig, color: C.dark, w: 1 });
      }
    }
  });
}

// ---------------------------------------------------------------- grazers
// Origin at the feet. Each returns the hip height and the stride at full
// swing (unit scale) so the gait can match the ground speed.

const GRAZERS = {
  // long legs and a long neck that bends down to graze
  browser(sp, P, C) {
    const L = sp.legLen;
    const H = 0.45 + L * 0.7;
    const bc = V(0, H + 0.2, 0.05);
    const [rx, ry, rz] = [0.42, 0.38, 0.72];
    const body = { pivot: bc };
    P.add(at(pod(rx, ry, rz), bc), { ...body, color: C.skin(bc.y, ry, bc.z, rz) });
    if (sp.look.pattern === 'spots' || sp.look.pattern === 'dapple') spots(P, C, sp.look, new RNG(sp.look.seed), bc, rx, ry, rz, 9, 0.12, body);
    legSet(P, C, { hipY: H + 0.1, hipX: 0.25, zs: [-0.42, 0.48], kneeY: H * 0.5, kneeZ: -0.03, r: 0.1, gait: sp.look.gait });
    const nb = V(0, bc.y + 0.12, bc.z - 0.5);
    const reach = 0.25 + sp.neck * 0.45;
    const rise = 0.3 + sp.neck * 0.95;
    const hr = 0.29;
    const hc = V(0, nb.y + rise, nb.z - reach);
    const head = { part: 5, pivot: nb, pivot2: V(grazeAngle(nb, hc, hr), 0.07, 0) };
    const neck = tube([V(0, nb.y - 0.12, nb.z + 0.16), V(0, nb.y + rise * 0.5, nb.z - reach * 0.3), V(0, hc.y - 0.08, hc.z + 0.1)], (t) => 0.21 - t * 0.09, 0, 8, 8);
    // throat and chest in the belly color
    const throat = (x, y, z, t, out) => {
      const cz = nb.z + 0.16 + (hc.z + 0.1 - nb.z - 0.16) * t;
      out.copy(C.base).lerp(C.belly, smooth(-0.04, -0.14, z - cz) * 0.9);
    };
    P.add(neck, { ...head, color: throat, w: (x, y, z, t) => Math.pow(t, 1.3) });
    addHead(P, C, sp, hc, hr, head);
    addTail(P, C, sp, V(0, bc.y + 0.1, bc.z + rz * 0.9), 0.35 + sp.tail * 0.45, 0.07, {});
    return { hip: H + 0.1, stride: 2 * (H + 0.1) * Math.sin(0.5) };
  },

  // six splayed legs and a glossy split shell
  beetle(sp, P, C) {
    const L = sp.legLen;
    const v = new RNG(sp.look.seed);
    const H = 0.22 + L * 0.18;
    const bc = V(0, H + 0.2, 0.05);
    const body = { pivot: bc };
    P.add(at(pod(0.42, 0.24, 0.62, 14, 10), V(bc.x, bc.y - 0.03, bc.z)), { ...body, color: C.belly });
    const shell = C.skin(bc.y + 0.12, 0.3, bc.z, 0.74);
    for (const s of [-1, 1]) {
      const g = new THREE.SphereGeometry(1, 10, 7, s < 0 ? -Math.PI / 2 : Math.PI / 2, Math.PI, 0, Math.PI / 2);
      P.add(at(g.scale(0.5, 0.44, 0.76), V(bc.x + s * 0.012, bc.y, bc.z)), { ...body, color: shell, gloss: true });
    }
    const seam = [];
    for (let i = 0; i <= 12; i++) {
      const z = -0.7 + i / 12 * 1.4;
      seam.push(V(0, bc.y + 0.44 * Math.sqrt(1 - (z / 0.76) ** 2) + 0.004, bc.z + z));
    }
    P.add(tube(seam, 0.008, 0.008, 4, 12), { ...body, color: C.dark, gloss: true });
    for (const s of [-1, 1]) {
      for (let row = 0; row < 3; row++) {
        const a = 0.42 + row * 0.31;
        const rib = [];
        for (let k = 0; k <= 8; k++) {
          const z = -0.57 + k / 8 * 1.13;
          const cross = Math.sqrt(1 - (z / 0.76) ** 2);
          rib.push(V(s * (0.5 * Math.sin(a) * cross + 0.012), bc.y + 0.44 * Math.cos(a) * cross + 0.006, bc.z + z));
        }
        P.add(tube(rib, 0.007, 0.004, 4, 8), { ...body, color: C.base.clone().lerp(C.pale, 0.35), gloss: true });
      }
    }
    if (sp.look.pattern === 'spots' || sp.look.pattern === 'dapple') spots(P, C, sp.look, v, V(bc.x, bc.y, bc.z), 0.5, 0.44, 0.76, 10, 0.1, body);
    const hr = 0.24;
    const hc = V(0, H + 0.2, bc.z - 0.72);
    const head = { part: 5, pivot: V(0, H + 0.2, bc.z - 0.55), pivot2: V(0.45, 0.05, 0) };
    P.add(at(ell(hr, hr * 0.88, hr, 2), hc), { ...head, w: 1, color: C.skin(hc.y, hr) });
    addEyes(P, C, sp.look, hc, hr, { ...head, w: 1 }, { scale: 1.15, spread: 0.62, up: 0.2 });
    for (const s of [-1, 1]) {
      const pts = [V(s * 0.08, hr * 0.7, -0.08), V(s * 0.22, hr * 1.9, -0.25), V(s * 0.36, hr * 2.4, -0.1)].map((p) => p.add(hc));
      P.add(tube(pts, 0.018, 0.012, 4, 6), { ...head, w: 1, color: C.dark });
      P.add(at(ell(0.045, 0.045, 0.045, 1), pts[2]), { ...head, w: 1, t: 1, color: sp.glow ? C.acc : C.pat, glow: sp.glow ? 1 : 0 });
      if (!sp.horns) {
        const m = [V(s * 0.1, -0.08, -0.16), V(s * 0.13, -0.1, -0.28), V(s * 0.03, -0.1, -0.36)].map((p) => p.add(hc));
        P.add(tube(m, 0.03, 0.008, 4, 5), { ...head, w: 1, color: C.dark, gloss: true });
      }
    }
    if (sp.horns) {
      const pts = [V(0, 0.05, -0.16), V(0, 0.18, -0.34), V(0, 0.45, -0.32)].map((p) => p.add(hc));
      P.add(tube(pts, 0.07, 0.012, 6, 8), { ...head, w: 1, color: C.pale, gloss: true });
    }
    const zs = [bc.z - 0.36, bc.z + 0.02, bc.z + 0.38];
    const reach = 0.3 + L * 0.15;
    const leg = tone(C.pat, 0, -0.1, -0.2);
    zs.forEach((z, row) => {
      for (const s of [-1, 1]) {
        const fan = (row - 1) * 0.16;
        const hip = V(s * 0.3, H + 0.08, z);
        const knee = V(s * (0.44 + L * 0.1), H + 0.22 + L * 0.06, z + fan);
        const foot = V(s * (0.3 + reach), 0.03, z + fan * 1.8);
        const rig = { part: 2, pivot: hip, side: s, phase: gaitPhase('trot', s, row) };
        P.add(limb(hip, knee, 0.075, 0.06, 6), { ...rig, color: leg, gloss: true });
        P.add(at(ell(0.065, 0.065, 0.065, 0), knee), { ...rig, color: leg, gloss: true });
        P.add(limb(knee, foot, 0.06, 0.035, 6), { ...rig, color: leg, gloss: true });
        P.add(at(ell(0.045, 0.035, 0.055, 0), foot), { ...rig, color: C.dark });
      }
    });
    return { hip: H + 0.08, stride: 2 * reach * Math.sin(0.42) };
  },

  // two big feet, hops everywhere
  hopper(sp, P, C) {
    const L = sp.legLen;
    const H = 0.28 + L * 0.36;
    const bc = V(0, H + 0.36, 0.02);
    const body = { pivot: bc };
    // round tummy patch on the front
    const tummy = (x, y, z, t, out) => {
      const g = C.skin(bc.y, 0.48, bc.z, 0.4)(x, y, z, t, out);
      out.lerp(C.belly, smooth(bc.z - 0.1, bc.z - 0.34, z) * smooth(bc.y + 0.42, bc.y + 0.1, y));
      return g;
    };
    P.add(at(ell(0.4, 0.48, 0.4, 2).rotateX(0.2), bc), { ...body, color: tummy });
    if (sp.look.pattern === 'spots' || sp.look.pattern === 'dapple') spots(P, C, sp.look, new RNG(sp.look.seed), bc, 0.4, 0.48, 0.4, 8, 0.1, body, 0.2);
    for (const s of [-1, 1]) {
      const hip = V(s * 0.24, H + 0.1, bc.z + 0.08);
      const knee = V(s * 0.3, H * 0.52, bc.z - 0.14);
      const ankle = V(s * 0.3, 0.08, bc.z + 0.14);
      const rig = { part: 3, pivot: hip, pivot2: knee, side: -1 };
      P.add(at(ell(0.17, 0.3, 0.22, 2).rotateX(-0.45), V(s * 0.29, H - 0.02, bc.z - 0.02)), { ...rig, w: 0, color: C.skin(H, 0.3) });
      P.add(at(ell(0.075, 0.075, 0.075, 1), knee), { ...rig, w: 0.5, color: C.base });
      P.add(limb(knee, ankle, 0.075, 0.06, 6), { ...rig, w: 1, color: C.sock(H * 0.5, 0) });
      P.add(at(ell(0.11, 0.065, 0.26, 2), V(s * 0.3, 0.065, bc.z - 0.04)), { ...rig, w: 1, color: C.pale });
      const sh = V(s * 0.21, bc.y + 0.02, bc.z - 0.3);
      const paw = V(s * 0.22, bc.y - 0.2, bc.z - 0.42);
      P.add(limb(sh, paw, 0.05, 0.04, 5), { ...body, color: C.base });
      P.add(at(ell(0.055, 0.05, 0.055, 1), paw), { ...body, color: C.pale });
    }
    const hr = 0.34;
    const hc = V(0, bc.y + 0.52, bc.z - 0.1);
    const head = { part: 5, pivot: V(0, bc.y + 0.28, bc.z - 0.04), pivot2: V(0.5, 0.1, 0) };
    const look = sp.look.ears === 'none' || sp.look.ears === 'fin' ? { ...sp.look, ears: 'long' } : sp.look;
    addHead(P, C, { ...sp, look }, hc, hr, head, { snout: false, spread: 0.5, scale: 1.15 });
    P.add(at(ell(hr * 0.2, hr * 0.14, hr * 0.14, 1), V(0, hc.y - hr * 0.25, hc.z - hr * 0.98)), { ...head, w: 1, color: C.pupil, gloss: true });
    if (sp.look.tail === 'pom' || sp.look.tail === 'fan') {
      P.add(at(ell(0.15, 0.15, 0.15, 1), V(0, bc.y - 0.2, bc.z + 0.4)), { part: 6, pivot: V(0, bc.y - 0.2, bc.z + 0.3), side: 1, t: 0.4, color: C.pale });
    } else {
      const tb = V(0, H + 0.2, bc.z + 0.3);
      const pts = [tb, V(0, H - 0.05, bc.z + 0.55), V(0, 0.2, bc.z + 0.85), V(0, 0.08, bc.z + 1.05)];
      P.add(tube(pts, 0.13, 0.04, 7, 8), { part: 6, pivot: tb, side: 0.5, color: C.skin(tb.y, 0.4, tb.z, 0.8) });
    }
    return { hip: H + 0.1, stride: (H + 0.1) * 2.4, hop: true };
  },

  // round fluffy thing on stubby legs, a smooth face peeking out of the fluff
  puff(sp, P, C) {
    const L = sp.legLen;
    const v = new RNG(sp.look.seed);
    const H = 0.07 + L * 0.08;
    const R = 0.56;
    const bc = V(0, H + R * 0.82, 0.04);
    const body = { pivot: bc };
    const paint = C.skin(bc.y, R, bc.z, R);
    P.add(at(ell(R * 0.9, R * 0.8, R * 0.95, 1), bc), { ...body, color: paint });
    // overlapping puffs like the clouds, fibonacci spread over the upper body
    const n = 16;
    for (let i = 0; i < n; i++) {
      const y = 1 - ((i + 0.5) / n) * 1.55;
      const rad = Math.sqrt(1 - y * y);
      const a = i * 2.399 + v.range(-0.25, 0.25);
      const d = V(Math.cos(a) * rad, y, Math.sin(a) * rad);
      if (d.z < -0.62 && Math.abs(d.y) < 0.55) continue;
      const tr = R * v.range(0.38, 0.5);
      P.add(at(ell(tr, tr * 0.92, tr, 1), V(bc.x + d.x * R * 0.66, bc.y + d.y * R * 0.6, bc.z + d.z * R * 0.66)), { ...body, color: paint });
    }
    const zs = sp.legs === 6 ? [-0.26, 0, 0.26] : [-0.2, 0.22];
    legSet(P, C, { hipY: H + 0.14, hipX: 0.26, zs, kneeY: H * 0.55, r: 0.11, gait: 'trot', hoof: 0 });
    const face = { part: 5, pivot: bc, pivot2: V(0.35, 0.06, 0), w: 1 };
    const fc = V(0, bc.y - 0.02, bc.z - R * 0.78);
    const fr = 0.3;
    P.add(at(ell(fr * 1.05, fr * 0.92, fr * 0.62, 2), fc), { ...face, color: C.pale });
    addEyes(P, C, sp.look, fc.clone().add(V(0, 0, fr * 0.2)), fr * 0.8, face, { scale: 1.25, spread: 0.45, up: 0.18 });
    P.add(at(ell(0.035, 0.025, 0.025, 0), V(0, fc.y - fr * 0.18, fc.z - fr * 0.6)), { ...face, color: C.pupil });
    if (sp.look.blush) {
      for (const s of [-1, 1]) {
        const d = V(s * 0.62, -0.3, -0.72).normalize();
        P.add(at(along(ell(0.055, 0.012, 0.038, 1), V(d.x / 1.05, d.y / 0.92, d.z / 0.62)), V(fc.x + d.x * fr * 1.02, fc.y + d.y * fr * 0.9, fc.z + d.z * fr * 0.6)), { ...face, color: C.blush });
      }
    }
    if (sp.glow || sp.look.ears === 'antennae') {
      // glowing lure on a bendy stalk
      const pts = [V(0, bc.y + R * 0.8, bc.z - 0.1), V(0, bc.y + R * 1.45, bc.z - 0.2), V(0, bc.y + R * 1.5, bc.z - 0.52)];
      P.add(tube(pts, 0.035, 0.022, 5, 8), { ...face, color: C.base });
      P.add(at(ell(0.08, 0.08, 0.08, 1), pts[2]), { ...face, t: 1, color: C.acc, glow: 1 });
    } else {
      for (const s of [-1, 1]) {
        const ear = ell(0.1, 0.05, 0.2, 1).rotateX(-0.3).rotateZ(s * 0.9);
        P.add(at(ear, V(fc.x + s * fr * 1.05, fc.y + fr * 0.4, fc.z + 0.08)), { ...face, color: C.pale, t: 0.6 });
      }
    }
    P.add(at(ell(0.13, 0.13, 0.13, 1), V(0, bc.y - 0.02, bc.z + R * 0.92)), { part: 6, pivot: V(0, bc.y, bc.z + R * 0.8), side: 1, t: 0.5, color: C.pale });
    return { hip: H + 0.14, stride: 2 * (H + 0.14) * Math.sin(0.5) };
  },

  // low and heavy, armor bands, back plates or spikes
  armored(sp, P, C) {
    const L = sp.legLen;
    const v = new RNG(sp.look.seed);
    const H = 0.25 + L * 0.3;
    const bc = V(0, H + 0.32, 0.05);
    const [rx, ry, rz] = [0.5, 0.36, 0.82];
    const body = { pivot: bc };
    P.add(at(pod(rx, ry, rz), bc), { ...body, color: C.skin(bc.y, ry, bc.z, rz) });
    const armor = sp.look.armor;
    if ((sp.look.pattern === 'spots' || sp.look.pattern === 'dapple') && armor !== 'bands') spots(P, C, sp.look, new RNG(sp.look.seed), bc, rx, ry, rz, 9, 0.11, body);
    if (armor === 'bands') {
      const n = 5;
      for (let k = 0; k < n; k++) {
        // a slice of a slightly bigger shell, top half only
        const t0 = 0.55 + (k / n) * 2.0;
        const span = 2.0 / n + 0.035;
        const g = new THREE.SphereGeometry(1, 14, 4, Math.PI - 0.4, Math.PI + 0.8, t0, span);
        g.rotateX(Math.PI / 2).scale(rx * 1.1, ry * 1.18, rz * 1.06);
        const bp = g.attributes.position;
        for (let i = 0; i < bp.count; i++) {
          const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
          const u = Math.min(1, Math.max(0, (Math.acos(Math.min(1, Math.max(-1, z / (rz * 1.06)))) - t0) / span));
          const bevel = 1 + Math.sin(u * Math.PI) * 0.065;
          bp.setXYZ(i, x * bevel, y * bevel, z);
        }
        g.computeVertexNormals();
        P.add(at(g, bc), {
          ...body, gloss: true,
          color: (x, y, z, t, out) => {
            const u = (Math.acos(Math.min(1, Math.max(-1, (z - bc.z) / (rz * 1.06)))) - t0) / span;
            out.copy(k % 2 ? C.pat : C.base).lerp(C.pale, smooth(0.76, 1, u) * 0.5);
          },
        });
      }
    } else if (armor === 'plates') {
      const n = 5 + v.int(0, 2);
      for (let k = 0; k < n; k++) {
        const u = (k + 0.5) / n;
        const z = bc.z - rz * 0.62 + u * rz * 1.3;
        const h = 0.12 + Math.sin(Math.PI * u) * 0.2;
        const top = bc.y + ry * Math.sqrt(Math.max(0, 1 - ((z - bc.z) / rz) ** 2)) * 0.95;
        const g = ell(0.03, h, h * 0.8, 1).rotateX(0.25);
        const y0 = top + h * 0.45;
        P.add(at(g, V((k % 2 ? 1 : -1) * 0.05, y0, z)), { ...body, color: (x, y, z, t, out) => { out.copy(C.pat).lerp(C.acc, smooth(y0 - h * 0.2, y0 + h, y)); return sp.glow ? smooth(y0, y0 + h, y) : 0; } });
      }
    } else {
      for (let k = 0; k < 5; k++) {
        const z = bc.z - rz * 0.55 + k * rz * 0.28;
        const f = Math.sqrt(Math.max(0, 1 - ((z - bc.z) / rz) ** 2));
        for (const s of [-1, 0, 1]) {
          const d = s === 0 ? V(0, 1, 0.15) : V(s, 0.7, 0.1);
          const len = s === 0 ? 0.2 : 0.26;
          const base = V(bc.x + s * rx * f * 0.8, bc.y + ry * f * (s === 0 ? 0.95 : 0.55), z);
          const g = new THREE.ConeGeometry(0.06, len, 5).translate(0, len / 2, 0);
          P.add(at(along(g, d), base), { ...body, color: (x, y, zz, t, out) => { out.copy(C.pale).lerp(C.acc, smooth(0, len, _v.set(x, y, zz).sub(base).length())); } });
        }
      }
    }
    const hr = 0.24;
    const hc = V(0, H + 0.24, bc.z - rz - 0.12);
    const head = { part: 5, pivot: V(0, H + 0.3, bc.z - rz + 0.1), pivot2: V(0.4, 0.05, 0) };
    P.add(at(ell(hr, hr * 0.85, hr * 1.1, 2), hc), { ...head, w: 1, color: C.skin(hc.y, hr) });
    const beak = new THREE.ConeGeometry(hr * 0.5, hr * 0.8, 6).rotateX(-Math.PI / 2 - 0.3);
    P.add(at(beak, V(0, hc.y - hr * 0.2, hc.z - hr * 1.05)), { ...head, w: 1, color: C.pale, gloss: true });
    addEyes(P, C, sp.look, hc, hr, { ...head, w: 1 }, { scale: 0.85, spread: 0.65, up: 0.3 });
    if (sp.horns) {
      // frill behind the head and two horns
      const fr = new THREE.CircleGeometry(hr * 1.6, 12, 0, Math.PI).rotateX(-0.35);
      P.add(at(fr, V(0, hc.y + hr * 0.2, hc.z + hr * 0.7)), { ...head, w: 1, color: (x, y, z, t, out) => { const k = smooth(hr * 0.5, hr * 1.6, _v.set(x, y, z).sub(hc).length()); out.copy(C.pat).lerp(C.acc, k); return sp.glow ? k : 0; } });
      for (const s of [-1, 1]) {
        const g = new THREE.ConeGeometry(hr * 0.12, hr * 1.1, 6).translate(0, hr * 0.55, 0);
        P.add(at(along(g, V(s * 0.3, 0.6, -1)), V(hc.x + s * hr * 0.4, hc.y + hr * 0.5, hc.z - hr * 0.2)), { ...head, w: 1, color: C.pale });
      }
    } else {
      headDeco(P, C, { ...sp, look: { ...sp.look, ears: 'none', crest: false } }, hc, hr, { ...head, w: 1 });
    }
    const zs = sp.legs === 6 ? [bc.z - 0.5, bc.z, bc.z + 0.5] : [bc.z - 0.48, bc.z + 0.5];
    legSet(P, C, { hipY: H + 0.12, hipX: 0.34, zs, kneeY: H * 0.5, r: 0.13, gait: sp.look.gait });
    const tb = V(0, bc.y, bc.z + rz * 0.85);
    const len = 0.45 + sp.tail * 0.45;
    const tail = { part: 6, pivot: tb, side: 0.6 };
    const pts = [tb, V(0, tb.y - 0.05, tb.z + len * 0.4), V(0, tb.y - 0.15, tb.z + len * 0.8), V(0, tb.y - 0.18, tb.z + len)];
    P.add(tube(pts, 0.15, 0.06, 7, 8), { ...tail, color: C.skin(tb.y, 0.2, tb.z, len) });
    P.add(at(ell(0.16, 0.14, 0.18, 1), pts[3]), { ...tail, t: 1, color: C.pat, gloss: true });
    return { hip: H + 0.12, stride: 2 * (H + 0.12) * Math.sin(0.5) };
  },

  // small body on tall legs, eyes on stalks and a trunk for grazing
  strider(sp, P, C) {
    const L = sp.legLen;
    const H = 0.9 + L * 0.8;
    const bc = V(0, H + 0.12, 0);
    const body = { pivot: bc };
    P.add(at(ell(0.36, 0.3, 0.44, 2), bc), { ...body, color: C.skin(bc.y, 0.3, bc.z, 0.44) });
    if (sp.look.pattern === 'spots' || sp.look.pattern === 'dapple') spots(P, C, sp.look, new RNG(sp.look.seed), bc, 0.36, 0.3, 0.44, 7, 0.09, body);
    [-0.16, 0.16].forEach((z, row) => {
      for (const s of [-1, 1]) {
        const hip = V(s * 0.2, H + 0.05, z);
        const knee = V(s * 0.6, H * 0.78 + 0.2, z * 2.4);
        const foot = V(s * 0.55, 0.05, z * 3.2);
        const rig = { part: 1, pivot: hip, pivot2: knee, phase: gaitPhase('walk', s, row), side: 0.6 };
        P.add(limb(hip, knee, 0.06, 0.05, 6), { ...rig, color: C.base, w: 0 });
        P.add(at(ell(0.065, 0.065, 0.065, 1), knee), { ...rig, color: C.pat, w: 0.5 });
        P.add(limb(knee, foot, 0.05, 0.025, 6), { ...rig, color: C.sock(H, 0), w: 1 });
        P.add(at(ell(0.05, 0.04, 0.05, 0), foot), { ...rig, color: C.dark, w: 1 });
      }
    });
    const head = { part: 5, pivot: V(0, bc.y + 0.1, bc.z - 0.3), pivot2: V(0.55, 0.05, 0), w: 1 };
    const er = 0.11 * sp.look.eyeSize;
    for (const s of sp.look.eyes === 1 ? [0] : [-1, 1]) {
      const pts = [V(s * 0.08, bc.y + 0.2, -0.26), V(s * 0.14, bc.y + 0.5, -0.34), V(s * 0.22, bc.y + 0.72, -0.3)];
      P.add(tube(pts, 0.04, 0.028, 5, 6), { ...head, w: 1, color: C.base });
      const ec = pts[2].clone().add(V(0, er * 0.7, 0));
      eye(P, C, sp.look, ec, V(s * 0.3, 0.1, -1).normalize(), er * (s === 0 ? 1.4 : 1), { ...head, t: 1 });
    }
    const trunk = [V(0, bc.y - 0.05, bc.z - 0.38), V(0, bc.y - 0.4, bc.z - 0.52), V(0, bc.y - 0.75, bc.z - 0.45), V(0, bc.y - 0.95, bc.z - 0.3)];
    P.add(tube(trunk, 0.075, 0.03, 6, 8), { ...head, color: C.skin(bc.y - 0.5, 0.5) });
    return { hip: H + 0.05, stride: 2 * (H + 0.05) * Math.sin(0.5) };
  },
};

function buildGrazer(sp, taken) {
  const C = colorsFor(sp, taken);
  const P = new Parts();
  const info = GRAZERS[sp.look.plan](sp, P, C);
  sp.anim = { hip: info.hip, stride: info.stride, hop: !!info.hop };
  return P.build();
}

// ---------------------------------------------------------------- flyers
// Centered on the body, wings out along x.

function birdWing(P, C, sp, s) {
  const L = sp.look;
  const root = V(s * 0.13, 0.05, -0.05);
  const elbow = V(s * 0.55, 0.06, 0);
  const rig = { part: 10, pivot: root, pivot2: elbow, side: s, w: (x) => smooth(0.45, 0.62, Math.abs(x)) };
  const paint = (x, y, z, t, out) => {
    const k = smooth(0.15, 1.25, Math.abs(x) + Math.max(0, z) * 0.6);
    out.copy(C.base).lerp(C.pat, k);
    const tip = smooth(0.95, 1.3, Math.abs(x));
    out.lerp(L.glowPattern ? C.acc : C.belly, tip * 0.6);
    return L.glowPattern ? tip : 0;
  };
  P.add(blade(0.74, (t) => 0.17 * Math.sin(Math.PI * (0.14 + t * 0.72)), 8, s, 0.08).translate(s * 0.08, 0.05, -0.04), { ...rig, color: paint });
  // Overlapping vanes leave small gaps only at the finger tips.
  const n = 8;
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    const ang = -0.18 + k * 1.48;
    const len = 0.38 + Math.sin(Math.PI * (0.16 + k * 0.72)) * 0.19;
    const d = V(s * Math.cos(ang), 0, Math.sin(ang));
    const a = V(s * (0.62 + 0.1 * (1 - k)), 0.052 - k * 0.002, -0.025 + k * 0.085);
    const g = feather(len, 0.065).rotateY(Math.atan2(d.x, d.z));
    P.add(at(g, a), { ...rig, color: paint });
  }
  for (let i = 0; i < 6; i++) {
    const x = 0.16 + i * 0.084;
    const g = feather(0.29 + i * 0.012, 0.061, 6).rotateY(s * 0.24);
    P.add(at(g, V(s * x, 0.047, 0.005)), { ...rig, color: paint });
  }
  for (let i = 0; i < 5; i++) {
    const x = 0.2 + i * 0.1;
    const g = feather(0.18, 0.065, 5).rotateY(s * 0.48);
    P.add(at(g, V(s * x, 0.075, -0.045)), { ...rig, color: C.base.clone().lerp(C.belly, 0.24) });
  }
}

function batWing(P, C, sp, s) {
  const L = sp.look;
  const shoulder = V(s * 0.12, 0.05, -0.08);
  const wrist = V(s * 0.6, 0.08, -0.06);
  const rig = { part: 10, pivot: shoulder, pivot2: wrist, side: s, w: (x) => smooth(0.5, 0.66, Math.abs(x)) };
  const tips = [V(s * 1.24, 0.08, 0.02), V(s * 1.08, 0.025, 0.43), V(s * 0.7, 0.015, 0.59), V(s * 0.13, -0.04, 0.28)];
  const bone = tone(C.base, 0, -0.1, -0.12);
  P.add(limb(shoulder, wrist, 0.03, 0.022, 5), { ...rig, color: bone });
  P.add(at(ell(0.032, 0.032, 0.032, 1), wrist), { ...rig, color: bone });
  for (const tp of tips) {
    const mid = wrist.clone().lerp(tp, 0.55).add(V(0, 0.018, -0.015));
    P.add(tube([wrist, mid, tp], 0.014, 0.005, 5, 5), { ...rig, color: bone });
  }
  const skin = tone(C.base, 0.02, 0.05, 0.1);
  const paint = (x, y, z, t, out) => {
    const k = smooth(0.2, 1.1, Math.abs(x));
    out.copy(skin).lerp(C.pat, k * 0.6);
    const rim = smooth(0.1, 0.45, z) * k;
    if (L.glowPattern) out.lerp(C.acc, rim);
    return L.glowPattern ? rim : 0;
  };
  for (let i = 0; i < tips.length - 1; i++) {
    P.add(membrane(wrist, tips[i], tips[i + 1], 0.045), { ...rig, color: paint });
    const mid = tips[i].clone().lerp(tips[i + 1], 0.5).lerp(wrist, 0.22);
    P.add(tube([tips[i], mid, tips[i + 1]], 0.008, 0.008, 4, 8), { ...rig, color: C.pat, glow: L.glowPattern ? 0.35 : 0 });
  }
  P.add(membrane(shoulder, wrist, tips[3], 0.025, 4), { ...rig, color: paint });
  const thumb = [wrist, wrist.clone().add(V(s * 0.04, 0.05, -0.08)), wrist.clone().add(V(s * 0.085, 0.035, -0.1))];
  P.add(tube(thumb, 0.018, 0.002, 5, 5), { ...rig, color: C.pale });
}

const FLYERS = {
  bird(sp, P, C) {
    const L = sp.look;
    const body = { pivot: ZERO };
    P.add(pod(0.2, 0.19, 0.42, 12, 10), { ...body, color: C.skin(0, 0.19, 0, 0.42) });
    const hc = V(0, 0.07, -0.42);
    P.add(at(ell(0.16, 0.15, 0.17, 2), hc), { ...body, color: C.skin(hc.y, 0.15) });
    const beak = new THREE.ConeGeometry(0.05, 0.2, 6).rotateX(-Math.PI / 2);
    P.add(at(beak, V(0, 0.04, -0.64)), { ...body, color: tone(C.acc, 0, -0.2, -0.05), gloss: true });
    addEyes(P, C, { ...L, eyes: 2, lids: false }, hc, 0.16, body, { scale: 0.85, spread: 0.7, up: 0.2 });
    if (L.crest) {
      for (let i = 0; i < 3; i++) {
        const g = ell(0.025, 0.008, 0.13 - i * 0.02, 0).rotateX(-0.7 + i * 0.25);
        P.add(at(g, V(0, hc.y + 0.14, hc.z + 0.06 + i * 0.03)), { ...body, color: C.acc, glow: L.glowPattern ? 0.8 : 0 });
      }
    }
    for (const s of [-1, 1]) birdWing(P, C, sp, s);
    const tail = { part: 6, pivot: V(0, 0.02, 0.35), side: 0.3, t: (x, y, z) => smooth(0.35, 0.75, z) };
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 0.2;
      const g = feather(0.34 + Math.abs(i - 2) * 0.035, 0.057, 6).rotateY(a);
      P.add(at(g, V(Math.sin(a) * 0.06, 0.02, 0.31)), { ...tail, color: (x, y, z, t, out) => { out.copy(C.pat).lerp(C.dark, smooth(0.45, 0.6, z) * 0.5); } });
    }
    return { hz: 3.2 / Math.sqrt(sp.size), glides: true };
  },

  bat(sp, P, C) {
    const L = sp.look;
    const body = { pivot: ZERO };
    P.add(ell(0.17, 0.17, 0.3, 2), { ...body, color: C.skin(0, 0.17, 0, 0.3) });
    const hc = V(0, 0.05, -0.33);
    const hr = 0.15;
    P.add(at(ell(hr, hr * 0.93, hr * 0.95, 2), hc), { ...body, color: C.skin(hc.y, hr) });
    P.add(at(ell(0.06, 0.045, 0.05, 1), V(0, hc.y - 0.03, hc.z - hr * 0.95)), { ...body, color: C.pale });
    addEyes(P, C, { ...L, eyes: L.eyes === 1 ? 1 : 2 }, hc, hr, body, { scale: 1.2, spread: 0.5, up: 0.25 });
    for (const s of [-1, 1]) {
      const ear = new THREE.ConeGeometry(0.07, 0.24, 5).scale(1, 1, 0.45).translate(0, 0.12, 0).rotateZ(-s * 0.35);
      P.add(at(ear, V(hc.x + s * 0.08, hc.y + 0.1, hc.z + 0.02)), { ...body, color: (x, y, z, t, out) => { out.copy(C.base).lerp(C.blush, smooth(hc.y + 0.1, hc.y + 0.3, y) * 0.6); } });
      batWing(P, C, sp, s);
      P.add(at(ell(0.02, 0.02, 0.05, 0), V(s * 0.06, -0.12, 0.2)), { ...body, color: C.dark });
    }
    return { hz: 3.8 / Math.sqrt(sp.size), glides: true };
  },

  manta(sp, P, C) {
    rayBody(P, C, sp, { span: 0.95, len: 0.55, thick: 0.13, radial: 28, rings: 12, sweep: 0.25, amp: 1 });
    return { hz: 1.1, glides: false };
  },

  dragonfly(sp, P, C) {
    const L = sp.look;
    const body = { pivot: ZERO };
    P.add(at(ell(0.11, 0.11, 0.17, 1), V(0, 0, -0.1)), { ...body, color: C.skin(0, 0.11), gloss: true });
    for (const s of [-1, 1]) {
      const ec = V(s * 0.075, 0.03, -0.3);
      P.add(at(ell(0.085, 0.08, 0.085, 1), ec), { ...body, color: C.acc, gloss: true, glow: L.glowEyes ? 0.7 : 0 });
      P.add(at(ell(0.02, 0.02, 0.02, 0), ec.clone().add(V(s * 0.04, 0.05, -0.04))), { ...body, color: C.white, glow: 0.3 });
    }
    const pts = [V(0, 0, 0.02), V(0, -0.01, 0.4), V(0, 0.01, 0.8), V(0, 0.04, 1.02)];
    const rings = (x, y, z, t, out) => {
      const band = smooth(0.2, 0.6, Math.cos(t * 26));
      out.copy(C.base).lerp(C.pat, band);
      out.lerp(C.acc, smooth(0.85, 1, t));
      return L.glowPattern ? band * 0.8 : 0;
    };
    P.add(tube(pts, (t) => 0.055 * (1 - t * 0.45) * (0.9 + 0.1 * Math.cos(t * 26)), 0, 6, 20), { part: 6, pivot: pts[0], side: 0.15, color: rings, gloss: true });
    const wing = tone(C.pale, 0, -0.1, 0.1).lerp(C.acc, 0.2);
    [[-0.17, 0.12, 0, 0.12], [-0.04, -0.1, 1.9, 0.14]].forEach(([z, ang, phase, wide]) => {
      for (const s of [-1, 1]) {
        const root = V(s * 0.05, 0.06, z);
        const g = blade(0.72, (t) => wide * Math.sqrt(Math.max(0, Math.sin(Math.PI * (0.06 + t * 0.94)))), 10, s, 0.05);
        g.rotateY(s * ang).translate(root.x, root.y, root.z);
        P.add(g, { part: 10, pivot: root, pivot2: root, side: s * 0.45, phase, color: (x, y, zz, t, out) => { out.copy(wing).lerp(C.dark, smooth(0.78, 0.84, t) * smooth(0.95, 0.9, t)); return L.glowPattern ? smooth(0.8, 1, t) * 0.6 : 0; } });
      }
    });
    return { hz: 7, glides: false };
  },
};

// A ray: flattened sphere with swept pointed wings. The whole body is one
// fin wave (part 11). Shared by the manta flyer and the leviathan.
function rayBody(P, C, sp, o) {
  const L = sp.look;
  const g = new THREE.SphereGeometry(1, o.radial, o.rings);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x0 = p.getX(i), y0 = p.getY(i), z0 = p.getZ(i);
    const ax = Math.abs(x0);
    const chord = 1 - Math.pow(ax, 1.4) * 0.82;
    const th = o.thick * (1 - Math.pow(ax, 1.1) * 0.9) * (1 + smooth(0.2, -0.6, z0) * 0.3) + o.thick * 0.06;
    p.setXYZ(i, x0 * o.span, y0 * th, z0 * o.len * chord + o.sweep * ax * ax);
  }
  g.computeVertexNormals();
  const rig = { part: 11, pivot: ZERO, side: o.amp };
  const span = o.span;
  P.add(g, {
    ...rig,
    color: (x, y, z, t, out) => {
      const top = y > 0;
      const ax = Math.abs(x) / span;
      out.copy(top ? C.base : C.pale);
      if (top) out.lerp(C.pat, smooth(0.2, 0.9, ax) * 0.8);
      else out.lerp(C.base, smooth(0.35, 0.9, ax) * 0.7);
      const rim = smooth(0.55, 0.95, ax) * (1 - smooth(0.004 * span, 0.03 * span, Math.abs(y)));
      if (L.glowPattern || sp.kind === 'leviathan') {
        out.lerp(C.acc, rim);
        return rim;
      }
      return 0;
    },
  });
  const v = new RNG(L.seed);
  const n = sp.kind === 'leviathan' ? 22 : 8;
  for (let i = 0; i < n; i++) {
    const s = i % 2 ? 1 : -1;
    const x = v.range(0.12, 0.6) * span;
    const z = v.range(-0.5, 0.45) * o.len + o.sweep * (x / span) ** 2;
    const ax = x / span;
    const y = o.thick * (1 - Math.pow(ax, 1.1) * 0.9) * 0.92;
    const r = span * v.range(0.018, 0.035);
    P.add(at(ell(r, r * 0.3, r, 1), V(s * x, y, z)), { ...rig, color: C.acc, glow: 1 });
  }
  const hz = -o.len * 0.92;
  for (const s of [-1, 1]) {
    // cephalic fins curl forward from the head
    const pts = [V(s * 0.11, 0, hz + 0.08), V(s * 0.15, -0.02, hz - 0.08), V(s * 0.09, -0.05, hz - 0.15)].map((q) => q.multiplyScalar(span / 0.95));
    P.add(tube(pts, 0.035 * span, 0.012 * span, 5, 6), { ...rig, color: C.base });
    const ec = V(s * 0.17 * span, 0.02 * span, hz + 0.1 * span);
    eye(P, C, { ...L, lids: false }, ec, V(s, 0.2, -0.6).normalize(), 0.035 * span, rig);
    for (let k = 0; k < 3; k++) {
      const z = -o.len * 0.26 + k * o.len * 0.14;
      const gill = [V(s * span * 0.11, -o.thick * 0.94, z), V(s * span * 0.19, -o.thick * 0.9, z + o.len * 0.025), V(s * span * 0.25, -o.thick * 0.82, z + o.len * 0.075)];
      P.add(tube(gill, span * 0.005, span * 0.003, 4, 4), { ...rig, color: C.base.clone().lerp(C.dark, 0.45) });
    }
  }
  const tail = [V(0, 0, o.len * 0.6), V(0, 0.02, o.len * 1.3), V(0, 0.05, o.len * 2.1), V(0, 0.02, o.len * 2.8)];
  P.add(tube(tail, 0.03 * span, 0.004 * span, 4, 12), { part: 24, pivot: tail[0], side: 0.3 * span, color: (x, y, z, t, out) => { out.copy(C.base).lerp(C.acc, smooth(0.8, 1, t)); return smooth(0.8, 1, t); } });
}

function buildFlyer(sp, taken) {
  const C = colorsFor(sp, taken);
  const P = new Parts();
  const info = FLYERS[sp.look.plan](sp, P, C);
  sp.anim = { hz: info.hz, glides: info.glides };
  return P.build();
}

// ---------------------------------------------------------------- floaters
// Centered on the bell, tentacles hang below.

function tentacles(P, C, sp, v, n, ring, y, len, r0, color, glowTip) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + v.range(-0.1, 0.1);
    const root = V(Math.cos(a) * ring, y, Math.sin(a) * ring);
    const l = len * v.range(0.7, 1.15);
    const pts = [root, V(root.x * 1.05, y - l * 0.35, root.z * 1.05), V(root.x * 0.9, y - l * 0.7, root.z * 0.9), V(root.x * 0.8, y - l, root.z * 0.8)];
    P.add(tube(pts, r0, r0 * 0.25, 3, 10), { part: 20, pivot: root, phase: a * 2.3, side: 1, color: (x, yy, z, t, out) => { out.copy(color).lerp(C.acc, t * 0.5); return glowTip ? smooth(0.6, 1, t) * 0.7 : 0; } });
  }
}

const FLOATERS = {
  jelly(sp, P, C) {
    const L = sp.look;
    const v = new RNG(L.seed);
    const R = 0.72;
    const Hb = 0.58;
    const prof = [];
    for (let i = 0; i <= 9; i++) {
      const a = (i / 9) * Math.PI * 0.5;
      prof.push(new THREE.Vector2(Math.max(0.001, R * Math.pow(Math.sin(a), 0.85)), Hb * Math.cos(a) - 0.06 * (i / 9) ** 3));
    }
    prof.push(new THREE.Vector2(R * 0.92, -0.08), new THREE.Vector2(R * 0.6, 0.06), new THREE.Vector2(0.001, 0.14));
    const bell = new THREE.LatheGeometry(prof.reverse(), 22);
    const lobes = 8;
    const p = bell.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + 0.07 * Math.cos(Math.atan2(z, x) * lobes) * smooth(0.25, -0.05, y);
      p.setXYZ(i, x * k, y, z * k);
    }
    bell.computeVertexNormals();
    const bellRig = { part: 21, pivot: V(0, Hb, 0), w: (x, y) => smooth(Hb, -0.1, y) };
    P.add(bell, {
      ...bellRig,
      color: (x, y, z, t, out) => {
        const r = Math.hypot(x, z) / R;
        const a = Math.atan2(z, x);
        out.copy(C.base).lerp(C.pale, smooth(0.2, -0.08, y) * 0.8);
        // radial canals and a clover of glowing gonads near the top
        const canal = smooth(0.9, 0.98, Math.cos(a * lobes)) * smooth(0.15, 0.5, r) * 0.6;
        const clover = smooth(0.2, 0.7, Math.cos(a * 2) ** 2) * smooth(0.12, 0.22, r) * smooth(0.5, 0.35, r) * smooth(0.1, 0.3, y);
        out.lerp(C.pat, canal).lerp(C.acc, clover);
        return clover + canal * 0.5 * (sp.glow ? 1 : 0) + smooth(0.02, -0.08, y) * 0.5;
      },
    });
    for (let j = 0; j < lobes; j++) {
      const a = j / lobes * TAU;
      const pts = [];
      for (let k = 1; k <= 9; k++) {
        const t = k / 9;
        const y = Hb * Math.cos(t * Math.PI * 0.5) - 0.06 * t ** 3;
        const r = R * Math.pow(Math.sin(t * Math.PI * 0.5), 0.85) * (1 + 0.07 * smooth(0.25, -0.05, y)) + 0.004;
        pts.push(V(Math.cos(a) * r, y + 0.004, Math.sin(a) * r));
      }
      P.add(tube(pts, 0.008, 0.012, 4, 8), { ...bellRig, color: C.pale.clone().lerp(C.acc, 0.28), glow: sp.glow ? 0.25 : 0 });
    }
    const frill = new THREE.CylinderGeometry(R * 0.98, R * 1.12, 0.16, 64, 3, true).translate(0, -0.14, 0);
    const fp = frill.attributes.position;
    for (let i = 0; i < fp.count; i++) {
      const x = fp.getX(i), y = fp.getY(i), z = fp.getZ(i);
      const a = Math.atan2(z, x);
      const skirt = smooth(-0.06, -0.22, y);
      const pleat = 1 + Math.cos(a * 16) * skirt * 0.035;
      fp.setXYZ(i, x * pleat, y + Math.sin(a * 16) * 0.038 * skirt, z * pleat);
    }
    frill.computeVertexNormals();
    P.add(frill, { part: 22, pivot: V(0, Hb, 0), w: 1, t: (x, y) => smooth(-0.06, -0.24, y), color: (x, y, z, t, out) => { out.copy(C.pale).lerp(C.acc, 0.35); return 0.45; } });
    // frilly oral arms from the middle
    const arms = 4;
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * TAU + 0.4;
      const root = V(Math.cos(a) * 0.1, 0.02, Math.sin(a) * 0.1);
      const len = v.range(1.0, 1.5);
      const pts = [root, V(Math.cos(a) * 0.22, -len * 0.3, Math.sin(a) * 0.22), V(Math.cos(a + 0.5) * 0.18, -len * 0.65, Math.sin(a + 0.5) * 0.18), V(Math.cos(a + 0.9) * 0.1, -len, Math.sin(a + 0.9) * 0.1)];
      const g = ribbon(pts, (t) => 0.1 * (1 - t * 0.6) * (1 + 0.4 * Math.sin(t * 28)), 24, 1.5);
      P.add(g, { part: 20, pivot: root, phase: a * 1.7, side: 0.8, color: (x, y, z, t, out) => { out.copy(C.pale).lerp(C.acc, 0.3 + t * 0.4); return (sp.glow ? 0.5 : 0.15) * (0.5 + t); } });
    }
    tentacles(P, C, sp, v, 12 + v.int(0, 4), R * 0.92, -0.08, v.range(1.4, 2.3), 0.02, C.pale, sp.glow);
    if (L.eyes === 2 && L.blush) {
      // a happy face on some of them
      addEyes(P, C, { ...L, eyes: 2, eyeStyle: 'dot', lids: false }, V(0, 0.05, 0), R * 1.0, bellRig, { scale: 0.4, spread: 0.3, up: 0.12 });
    }
    return { hz: 0.45 };
  },

  balloon(sp, P, C) {
    const L = sp.look;
    const v = new RNG(L.seed);
    const bc = V(0, 0.32, 0);
    const gores = 6 + v.int(0, 2) * 2;
    // four columns per gore so the stripes follow the mesh instead of zigzagging
    const g = new THREE.SphereGeometry(0.62, gores * 4, 12).scale(1, 1.08, 1);
    const envelope = g.attributes.position;
    for (let i = 0; i < envelope.count; i++) {
      const x = envelope.getX(i), y = envelope.getY(i), z = envelope.getZ(i);
      const a = Math.atan2(z, x);
      const swell = 1 + Math.cos(a * gores) * 0.085 * Math.sqrt(Math.max(0, 1 - (y / 0.67) ** 2));
      envelope.setXYZ(i, x * swell, y, z * swell);
    }
    g.computeVertexNormals();
    P.add(at(g, bc), {
      part: 21,
      pivot: bc,
      w: 0.35,
      color: (x, y, z, t, out) => {
        const a = Math.atan2(z, x);
        const stripe = smooth(-0.3, 0.3, Math.cos(a * gores * 0.5));
        out.copy(C.base).lerp(C.pale, stripe * 0.75).lerp(C.belly, smooth(bc.y - 0.2, bc.y - 0.68, y) * 0.6);
        const crown = smooth(bc.y + 0.52, bc.y + 0.66, y);
        out.lerp(C.acc, crown);
        return crown;
      },
    });
    // fin along the top, scalloped between the rays
    const fin = [[0.42, -0.1]];
    for (let i = 0; i <= 6; i++) {
      const u = i / 6;
      const x = 0.42 - u * 0.9;
      const h = 0.18 + Math.sin(Math.PI * (0.15 + u * 0.75)) * 0.3;
      fin.push([x, h]);
      if (i < 6) fin.push([x - 0.075, h * 0.78]);
    }
    fin.push([-0.5, -0.1]);
    const sail = new THREE.ShapeGeometry(new THREE.Shape(fin.map(([x, y]) => new THREE.Vector2(x, y))));
    sail.rotateY(Math.PI / 2).translate(0, bc.y + 0.62, 0);
    const top = bc.y + 0.55;
    P.add(sail, { part: 22, pivot: bc, w: 0, t: (x, y) => smooth(top, top + 0.5, y), color: (x, y, z, t, out) => { const vein = smooth(0.6, 0.9, Math.cos(z * 30)); out.copy(C.acc).lerp(C.pale, 0.45).lerp(C.pat, vein * 0.4); return (sp.glow ? 0.6 : 0.2) * smooth(top, top + 0.5, y); } });
    // little gondola body with a face and paddle fins
    const gc = V(0, -0.4, 0);
    P.add(limb(V(0, bc.y - 0.62, 0), V(0, gc.y + 0.2, 0), 0.06, 0.07, 6), { pivot: gc, color: C.base });
    P.add(at(ell(0.32, 0.27, 0.33, 2), gc), { pivot: gc, color: C.skin(gc.y, 0.27) });
    addEyes(P, C, { ...L, eyes: L.eyes === 4 ? 2 : L.eyes }, gc, 0.3, { pivot: gc }, { scale: 1.2, spread: 0.5, up: 0.15 });
    if (L.blush) {
      for (const s of [-1, 1]) {
        const d = V(s * 0.65, -0.2, -0.72).normalize();
        P.add(at(along(ell(0.06, 0.014, 0.04, 1), d), gc.clone().addScaledVector(d, 0.3)), { pivot: gc, color: C.blush });
      }
    }
    for (const s of [-1, 1]) {
      const root = V(s * 0.28, gc.y, gc.z + 0.02);
      const fin = blade(0.26, (t) => 0.1 * Math.sin(Math.PI * (0.15 + t * 0.85)), 5, s, 0.05).translate(root.x, root.y, root.z);
      P.add(fin, { part: 10, pivot: root, pivot2: root, side: s * 0.9, color: C.acc, glow: sp.glow ? 0.5 : 0 });
    }
    const n = 3 + v.int(0, 2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const root = V(Math.cos(a) * 0.12, gc.y - 0.2, Math.sin(a) * 0.12);
      const len = v.range(0.5, 0.9);
      const pts = [root, V(root.x * 1.4, root.y - len * 0.5, root.z * 1.4), V(root.x, root.y - len, root.z)];
      P.add(tube(pts, 0.022, 0.01, 4, 8), { part: 20, pivot: root, phase: a * 2, side: 0.7, color: C.base });
      P.add(at(ell(0.04, 0.04, 0.04, 1), pts[2]), { part: 20, pivot: root, phase: a * 2, side: 0.7, t: 1, color: C.acc, glow: 1 });
    }
    return { hz: 0.3 };
  },

  // a float with a chain of little bells hanging from it
  siphon(sp, P, C) {
    const L = sp.look;
    const v = new RNG(L.seed);
    const fc = V(0, 0.32, 0);
    P.add(at(ell(0.26, 0.22, 0.46, 2), fc), { part: 21, pivot: fc, w: 0.25, color: (x, y, z, t, out) => { out.copy(C.acc).lerp(C.pale, 0.5).lerp(C.base, smooth(fc.y + 0.1, fc.y - 0.2, y)); }, gloss: true });
    const crest = new THREE.ShapeGeometry(new THREE.Shape([[-0.35, 0], [-0.2, 0.18], [0.1, 0.24], [0.3, 0.1], [0.36, 0]].map(([x, y]) => new THREE.Vector2(x, y))));
    crest.rotateY(Math.PI / 2).translate(0, fc.y + 0.16, 0);
    P.add(crest, { part: 22, pivot: fc, w: 0, t: (x, y) => smooth(fc.y + 0.16, fc.y + 0.4, y), color: C.pat, glow: sp.glow ? 0.4 : 0 });
    const n = 5 + v.int(0, 3);
    const step = 0.28;
    const total = n * step + 0.9;
    const chain = { part: 20, pivot: V(0, fc.y - 0.15, 0), side: 1.6 };
    const tOf = (x, y) => Math.min(1, Math.max(0, (fc.y - 0.15 - y) / total));
    P.add(limb(V(0, fc.y - 0.1, 0), V(0, fc.y - 0.15 - n * step, 0), 0.025, 0.015, 5), { ...chain, t: tOf, color: C.base });
    for (let k = 0; k < n; k++) {
      const a = k * 2.399;
      const y = fc.y - 0.25 - k * step;
      const r = 0.17 - k * 0.008;
      const cup = new THREE.LatheGeometry([new THREE.Vector2(0.001, r * 1.1), new THREE.Vector2(r * 0.7, r * 0.95), new THREE.Vector2(r, r * 0.3), new THREE.Vector2(r * 0.85, -r * 0.2)], 10);
      cup.rotateZ(Math.PI / 2 - 0.4).rotateY(a).translate(Math.cos(a) * 0.09, y, Math.sin(a) * 0.09);
      P.add(cup, { ...chain, phase: k * 0.8, t: tOf, color: (x, yy, z, t, out) => { const e = smooth(0.5, 1, Math.hypot(x - Math.cos(a) * 0.09, z - Math.sin(a) * 0.09) / (r * 1.2)); out.copy(C.base).lerp(C.acc, e); return e; } });
    }
    for (let i = 0; i < 4; i++) {
      const a = i * 1.7;
      const y0 = fc.y - 0.2 - n * step;
      const root = V(Math.cos(a) * 0.05, y0, Math.sin(a) * 0.05);
      const len = v.range(0.7, 1.1);
      const pts = [root, V(root.x * 3, y0 - len * 0.4, root.z * 3), V(root.x * 2, y0 - len, root.z * 2)];
      P.add(tube(pts, 0.014, 0.006, 3, 10), { ...chain, phase: a, t: tOf, color: C.pale });
      for (let j = 1; j <= 3; j++) {
        const q = new THREE.CatmullRomCurve3(pts).getPointAt(j / 4);
        P.add(at(ell(0.025, 0.025, 0.025, 0), q), { ...chain, phase: a, t: tOf, color: C.acc, glow: 0.8 });
      }
    }
    return { hz: 0.35 };
  },

  // comb jelly with rows of shimmering plates
  comb(sp, P, C) {
    const L = sp.look;
    const v = new RNG(L.seed);
    const bc = V(0, 0, 0);
    const [rx, ry] = [0.46, 0.64];
    const body = new THREE.SphereGeometry(1, 32, 16);
    const bp = body.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
      const a = Math.atan2(z, x);
      const lobe = 1 - 0.065 * (1 - Math.cos(a * 8)) * Math.sqrt(Math.max(0, 1 - y * y));
      bp.setXYZ(i, x * rx * lobe, y * ry, z * rx * lobe);
    }
    body.computeVertexNormals();
    P.add(body, { pivot: bc, gloss: true, color: (x, y, z, t, out) => { out.copy(C.pale).lerp(C.base, smooth(-0.3, 0.6, y) * 0.5); } });
    P.add(at(ell(0.07, 0.07, 0.07, 1), V(0, ry, 0)), { pivot: bc, color: C.acc, glow: 1 });
    const rows = 8;
    const hue = C.acc.getHSL({}, THREE.SRGBColorSpace).h;
    for (let j = 0; j < rows; j++) {
      const th = (j / rows) * TAU;
      for (let k = 0; k < 13; k++) {
        const u = k / 12;
        const phi = 0.32 + u * 2.4;
        const d = V(Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th));
        const nrm = V(d.x / rx, d.y / ry, d.z / rx).normalize();
        const tan = V(Math.cos(phi) * Math.cos(th) * rx, -Math.sin(phi) * ry, Math.cos(phi) * Math.sin(th) * rx).normalize();
        const g = ell(0.07, 0.018, 0.058, 0);
        _m.makeBasis(_v.crossVectors(tan, nrm), nrm, tan);
        g.applyMatrix4(_m);
        const col = new THREE.Color().setHSL((hue + u * 0.55 + j * 0.04) % 1, 0.85, 0.62, THREE.SRGBColorSpace);
        P.add(at(g, V(d.x * rx * 1.02, d.y * ry * 1.02, d.z * rx * 1.02)), { part: 23, pivot: bc, phase: j * 0.7, t: u, color: col, glow: 1 });
      }
    }
    for (const s of [-1, 1]) {
      const root = V(s * rx * 0.7, -0.15, 0);
      const len = v.range(1.3, 1.9);
      const pts = [root, V(s * rx * 1.1, -0.5, 0.05), V(s * rx * 0.9, -0.5 - len * 0.5, 0.1), V(s * rx * 0.6, -0.4 - len, 0)];
      P.add(tube(pts, 0.025, 0.008, 4, 14), { part: 20, pivot: root, phase: s, side: 1.2, color: C.pale });
      const curve = new THREE.CatmullRomCurve3(pts);
      for (let j = 1; j < 9; j++) {
        const q = curve.getPointAt(j / 10);
        const f = [q, q.clone().add(V(s * 0.12, -0.05, 0.04))];
        P.add(limb(f[0], f[1], 0.008, 0.003, 3), { part: 20, pivot: root, phase: s, side: 1.2, t: j / 10, color: C.acc, glow: 0.5 });
      }
    }
    return { hz: 0.2 };
  },
};

function buildFloater(sp, taken) {
  const C = colorsFor(sp, taken);
  const P = new Parts();
  const info = FLOATERS[sp.look.plan](sp, P, C);
  sp.anim = { hz: info.hz };
  return P.build();
}

// ---------------------------------------------------------------- leviathans
// Body along z, about 1.3 units long before scaling. The slow body wave runs
// through every part (aRig.w).

const LEVIATHANS = {
  // sky whale, sometimes with a small garden growing on its back
  whale(sp, P, C) {
    const L = sp.look;
    const v = new RNG(L.seed);
    const len0 = -0.62;
    const len = 1.22;
    const radius = (u) => (u < 0.3 ? 0.18 * Math.sqrt(Math.max(0, 1 - ((0.3 - u) / 0.3) ** 2)) : 0.18 * (1 - Math.pow((u - 0.3) / 0.7, 1.6) * 0.87));
    const prof = [];
    for (let i = 0; i <= 30; i++) prof.push(new THREE.Vector2(Math.max(0.002, radius(i / 30)), len0 + (i / 30) * len));
    const g = new THREE.LatheGeometry(prof, 28).rotateX(Math.PI / 2).scale(1.1, 0.95, 1);
    const rAt = (z) => radius(Math.min(1, Math.max(0, (z - len0) / len)));
    P.add(g, {
      pivot: ZERO,
      color: (x, y, z, t, out) => {
        const r = rAt(z) + 1e-4;
        const ny = y / r;
        out.copy(C.base).lerp(C.pale, smooth(-0.1, -0.6, ny));
        // grooves along the throat and belly, and a long smile
        const a = Math.atan2(y, x);
        const groove = smooth(0.3, 0.8, Math.cos(a * 14)) * smooth(-0.5, -0.8, ny) * smooth(0.25, -0.1, z);
        out.lerp(C.belly, groove * 0.7);
        const mouth = smooth(0.1, 0.02, Math.abs(ny + 0.22 - (z + 0.62) * 0.3)) * smooth(-0.34, -0.42, z);
        out.lerp(C.pupil, mouth * 0.8);
        const line = smooth(0.16, 0.04, Math.abs(ny - 0.12)) * smooth(-0.5, -0.3, z) * smooth(0.45, 0.2, z);
        out.lerp(C.acc, line);
        return line;
      },
    });
    // whale shark spots along the upper flanks
    for (let row = 0; row < 3; row++) {
      for (let k = 0; k < 11; k++) {
        const z = -0.42 + k * 0.075 + (row % 2) * 0.035;
        if (z > 0.35) continue;
        for (const s of [-1, 1]) {
          const a = 0.35 + row * 0.33 + v.range(-0.05, 0.05);
          const r = rAt(z);
          const nrm = V(s * Math.sin(a), Math.cos(a), 0);
          const p = V(s * Math.sin(a) * r * 1.1, Math.cos(a) * r * 0.95, z);
          const sr = 0.016 + v.range(0, 0.01) - row * 0.003;
          P.add(at(along(ell(sr, sr * 0.3, sr, 0), nrm), p), { pivot: ZERO, color: C.acc, glow: 1 });
        }
      }
    }
    for (const s of [-1, 1]) {
      const ez = -0.45;
      const er = rAt(ez);
      eye(P, C, { ...L, eyeStyle: 'dot', lids: false }, V(s * (er * 1.1 * 0.98 + 0.006), -er * 0.2, ez), V(s, 0.1, -0.35).normalize(), 0.02, { pivot: ZERO });
      const root = V(s * 0.15, -0.07, -0.24);
      const fl = blade(0.56, (t) => 0.075 * Math.pow(Math.sin(Math.PI * (0.12 + t * 0.88)), 0.7) * (1 - t * 0.45), 12, s, 0.2);
      fl.rotateZ(s * -0.35).translate(root.x, root.y, root.z);
      P.add(fl, { part: 10, pivot: root, pivot2: V(s * 0.36, -0.14, -0.2), side: s * 0.45, w: (x) => smooth(0.28, 0.45, Math.abs(x)), color: (x, y, z, t, out) => { out.copy(C.base).lerp(C.pale, 0.35).lerp(C.acc, smooth(0.85, 1, t)); return smooth(0.85, 1, t); } });
      const fk = blade(0.24, (t) => 0.055 * (1 - t * t) + 0.004, 6, s, 0.12).rotateY(s * -0.3).translate(0, 0, 0.56);
      P.add(fk, { pivot: ZERO, color: (x, y, z, t, out) => { out.copy(C.base).lerp(C.pat, t); } });
      // streamers from the fluke tips
      const tip = V(s * 0.24, 0, 0.72);
      const pts = [tip, V(s * 0.28, 0.01, 0.95), V(s * 0.26, -0.01, 1.2), V(s * 0.3, 0, 1.45)];
      P.add(ribbon(pts, (t) => 0.018 * (1 - t * 0.7), 20, 0.6), { part: 24, pivot: tip, phase: s, side: 0.5, color: (x, y, z, t, out) => { out.copy(C.acc).lerp(C.pale, 0.3); return 0.7 * (1 - t * 0.5); } });
    }
    const dorsal = blade(0.13, (t) => 0.075 * (1 - t) ** 1.4 + 0.001, 8, 1, 0.095).rotateZ(Math.PI / 2).translate(0, rAt(0.15) * 0.9, 0.15);
    P.add(dorsal, { pivot: ZERO, color: (x, y, z, t, out) => { out.copy(C.pat).lerp(C.acc, smooth(0.7, 1, t)); return 0.4 * smooth(0.7, 1, t); } });
    if (L.garden) {
      const leaf = new THREE.Color(L.leaf);
      for (let k = 0; k < 7; k++) {
        const z = -0.28 + k * 0.075 + v.range(-0.02, 0.02);
        const x = v.range(-0.05, 0.05);
        const y = rAt(z) * 0.93;
        P.add(at(ell(v.range(0.04, 0.07), 0.025, v.range(0.04, 0.06), 1), V(x, y, z)), { pivot: ZERO, color: tone(leaf, v.range(-0.03, 0.03), 0, v.range(-0.08, 0.05)) });
        if (k % 2 === 0) {
          const h = v.range(0.04, 0.08);
          const b = V(x + v.range(-0.02, 0.02), y + 0.015, z);
          P.add(limb(b, V(b.x, b.y + h, b.z), 0.006, 0.004, 4), { pivot: ZERO, color: C.dark });
          P.add(at(ell(0.03, 0.025, 0.03, 1), V(b.x, b.y + h + 0.015, b.z)), { pivot: ZERO, color: tone(leaf, 0.02, 0, 0.08), glow: sp.glow ? 0.25 : 0 });
        }
      }
      // vines trailing from the belly
      for (let k = 0; k < 6; k++) {
        const z = -0.25 + k * 0.08;
        const x = v.range(-0.08, 0.08);
        const root = V(x, -rAt(z) * 0.85, z);
        const l = v.range(0.12, 0.28);
        P.add(tube([root, V(x, root.y - l * 0.5, z + 0.02), V(x, root.y - l, z + 0.06)], 0.005, 0.003, 3, 6), { part: 20, pivot: root, phase: k, side: -0.25, color: leaf });
      }
    }
    return { hz: 0.13, spine: (x, y, z) => 0.075 * smooth(-0.35, 0.75, z) ** 2 };
  },

  manta(sp, P, C) {
    rayBody(P, C, sp, { span: 0.8, len: 0.45, thick: 0.09, radial: 40, rings: 16, sweep: 0.3, amp: 0.8 });
    return { hz: 0.16, spine: (x, y, z) => 0.02 * smooth(0, 1, z) };
  },

  // long sky serpent with a frilled back and paddling fins
  serpent(sp, P, C) {
    const L = sp.look;
    const z0 = -0.95;
    const z1 = 1.35;
    const pts = [];
    for (let i = 0; i <= 8; i++) pts.push(V(0, Math.sin(i * 0.9) * 0.03, z0 + (i / 8) * (z1 - z0)));
    const rad = (t) => 0.085 * (t < 0.08 ? 0.75 + t * 3 : 1 - Math.pow((t - 0.08) / 0.92, 1.4) * 0.88);
    const curve = new THREE.CatmullRomCurve3(pts);
    const cy = [];
    for (let i = 0; i <= 64; i++) cy.push(curve.getPointAt(i / 64).y);
    P.add(tube(pts, rad, 0, 10, 64), {
      pivot: ZERO,
      color: (x, y, z, t, out) => {
        const ny = (y - cy[Math.round(t * 64)]) / rad(t);
        const band = smooth(0.3, 0.7, Math.cos(t * 44 + L.stripeOff));
        out.copy(C.base).lerp(C.pat, band * smooth(-0.2, 0.3, ny)).lerp(C.belly, smooth(-0.1, -0.7, ny));
        const glow = band * smooth(0.5, 0.9, ny) * 0.6;
        out.lerp(C.acc, glow);
        return glow;
      },
    });
    const hc = V(0, 0.01, z0 - 0.08);
    P.add(at(ell(0.1, 0.075, 0.16, 2), hc), { pivot: ZERO, color: C.skin(hc.y, 0.075, hc.z, 0.16) });
    P.add(at(ell(0.07, 0.05, 0.08, 1), V(0, hc.y - 0.02, hc.z - 0.13)), { pivot: ZERO, color: C.pale });
    for (const s of [-1, 1]) {
      eye(P, C, { ...L, eyeStyle: 'white', glowEyes: true, lids: false }, V(s * 0.07, hc.y + 0.03, hc.z - 0.05), V(s, 0.3, -0.6).normalize(), 0.025, { pivot: ZERO });
      const horn = [V(s * 0.05, hc.y + 0.05, hc.z + 0.02), V(s * 0.09, hc.y + 0.1, hc.z + 0.12), V(s * 0.1, hc.y + 0.1, hc.z + 0.25)];
      P.add(tube(horn, 0.018, 0.004, 5, 6), { pivot: ZERO, color: C.pale });
      const w0 = V(s * 0.05, hc.y - 0.03, hc.z - 0.17);
      P.add(tube([w0, V(s * 0.15, hc.y - 0.06, hc.z - 0.1), V(s * 0.22, hc.y - 0.1, hc.z + 0.1), V(s * 0.25, hc.y - 0.12, hc.z + 0.35)], 0.006, 0.002, 3, 12), { part: 24, pivot: w0, phase: s * 2, side: 0.4, color: C.acc, glow: 0.6 });
      // three pairs of paddling fins
      [0.12, 0.35, 0.58].forEach((t, k) => {
        const c = curve.getPointAt(t);
        const root = V(s * rad(t) * 0.8, c.y - rad(t) * 0.3, c.z);
        const fin = blade(0.16 - k * 0.02, (u) => 0.05 * Math.sin(Math.PI * (0.1 + u * 0.9)), 6, s, 0.08).rotateZ(s * -0.2).translate(root.x, root.y, root.z);
        P.add(fin, { part: 10, pivot: root, pivot2: root, phase: -k * 0.9, side: s * 0.6, color: (x, y, z, tt, out) => { out.copy(C.acc).lerp(C.pale, 0.3); return 0.4 * tt; } });
      });
    }
    // frill along the back, scalloped and glowing along the top edge
    const fr = [];
    const ft = [];
    const idx = [];
    const n = 80;
    for (let i = 0; i <= n; i++) {
      const t = 0.04 + (i / n) * 0.9;
      const c = curve.getPointAt(t);
      const h = 0.07 * (0.55 + 0.45 * Math.abs(Math.sin(t * Math.PI * 14))) * (1 - t * 0.5);
      fr.push(0, c.y + rad(t) * 0.8, c.z, 0, c.y + rad(t) * 0.8 + h, c.z + 0.01);
      ft.push(0, 1);
      if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const frill = new THREE.BufferGeometry();
    frill.setAttribute('position', new THREE.Float32BufferAttribute(fr, 3));
    frill.setAttribute('tt', new THREE.Float32BufferAttribute(ft, 1));
    frill.setIndex(idx);
    frill.computeVertexNormals();
    P.add(frill, { pivot: ZERO, color: (x, y, z, t, out) => { out.copy(C.pat).lerp(C.acc, t); return t * 0.9; } });
    const tip = curve.getPointAt(1);
    for (const s of [-1, 1]) {
      const q = [tip, V(s * 0.05, tip.y + 0.02, tip.z + 0.2), V(s * 0.1, tip.y, tip.z + 0.45)];
      P.add(ribbon(q, (t) => 0.03 * (1 - t * 0.6), 14, 0.5), { part: 24, pivot: tip, phase: s, side: 0.4, color: (x, y, z, t, out) => { out.copy(C.acc).lerp(C.pale, 0.3); return 0.6; } });
    }
    return { hz: 0.22, spine: (x, y, z) => -0.13 * (0.35 + 0.65 * smooth(z0, z1, z)) };
  },
};

function buildLeviathan(sp, taken) {
  const C = colorsFor(sp, taken);
  const P = new Parts();
  const info = LEVIATHANS[sp.look.plan](sp, P, C);
  sp.anim = { hz: info.hz };
  return P.build(info.spine);
}

const BUILD = { grazer: buildGrazer, flyer: buildFlyer, floater: buildFloater, leviathan: buildLeviathan };

// ---------------------------------------------------------------- material

// Rig evaluated per vertex in model space (unit scale, the instance matrix
// carries the size). aAnim is per instance: x amount (walk, flap), y cycle
// phase kept by the CPU so feet match the ground speed, z pose (grazing),
// w head turn.
const RIG_GLSL = /* glsl */ `
  attribute float aPart;
  attribute vec4 aPivot;
  attribute vec4 aPivot2;
  attribute vec4 aRig;
  attribute vec4 aAnim;
  vec3 rigN;

  vec3 rotX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
  vec3 rotY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }
  vec3 rotZ(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z); }

  // jellyfish stroke, a quick squeeze and a slow release
  float fPulse(float ph) {
    float f = fract(ph / 6.28318);
    return smoothstep(0.0, 0.16, f) * (1.0 - smoothstep(0.16, 0.8, f));
  }

  vec3 faunaRig(vec3 p, vec3 n) {
    float amp = aAnim.x;
    float ph = aAnim.y;
    float seed = float(gl_InstanceID) * 2.399;
    vec3 piv = aPivot.xyz;
    float w = aRig.x;
    float t = aRig.y;
    if (aPart < 0.5) {
      // breathing
      p = piv + (p - piv) * (1.0 + sin(uTime * 1.7 + seed) * 0.018);
    } else if (aPart < 1.5) {
      // two segment leg: swing at the hip, the knee lifts the foot on the way forward
      float lph = ph + aPivot.w;
      float kA = -max(0.0, cos(lph)) * 1.1 * amp * aPivot2.w;
      float hA = sin(lph) * 0.5 * amp;
      vec3 kp = aPivot2.xyz;
      p = mix(p, kp + rotX(p - kp, kA), w);
      n = mix(n, rotX(n, kA), w);
      p = piv + rotX(p - piv, hA);
      n = rotX(n, hA);
    } else if (aPart < 2.5) {
      // splayed insect leg: sweep around the hip, lift on the way forward
      float lph = ph + aPivot.w;
      float s = aPivot2.w;
      float lift = s * max(0.0, cos(lph)) * 0.5 * amp;
      float yaw = s * sin(lph) * 0.42 * amp;
      p = piv + rotY(rotZ(p - piv, lift), yaw);
      n = rotY(rotZ(n, lift), yaw);
    } else if (aPart < 3.5) {
      // hopping legs trail behind in the air and tuck the lower leg
      float hA = -cos(ph) * 0.55 * amp;
      float kA = max(0.0, sin(ph)) * 0.8 * amp * aPivot2.w;
      vec3 kp = aPivot2.xyz;
      p = mix(p, kp + rotX(p - kp, kA), w);
      n = mix(n, rotX(n, kA), w);
      p = piv + rotX(p - piv, hA);
      n = rotX(n, hA);
    } else if (aPart < 5.5) {
      // neck and head: graze, look around, nod with the gait. Ears and
      // antennae (t > 0) wobble.
      p += vec3(sin(uTime * 4.3 + seed + p.y * 5.0), 0.0, cos(uTime * 3.7 + seed + p.x * 4.0)) * t * t * 0.035;
      float pitch = (-aAnim.z * aPivot2.x + sin(ph * 2.0) * aPivot2.y * amp + sin(uTime * 0.9 + seed) * 0.03) * w;
      float yaw = (aAnim.w + sin(uTime * 0.37 + seed) * 0.1 * (1.0 - amp)) * w;
      p = piv + rotY(rotX(p - piv, pitch), yaw);
      n = rotY(rotX(n, pitch), yaw);
    } else if (aPart < 6.5) {
      // tail, a wave running to the tip
      float a = (sin(uTime * 2.3 + seed - t * 2.5) * 0.3 + sin(ph - t * 2.0) * 0.2 * amp) * t * aPivot2.w;
      p = piv + rotY(p - piv, a);
      n = rotY(n, a);
    } else if (aPart < 10.5) {
      // wing: the inner part flaps at the shoulder, the outer part lags
      // behind and sweeps back on the upstroke. amp 0 is a glide.
      float s = sign(aPivot2.w);
      float k = abs(aPivot2.w);
      float wph = ph + aPivot.w;
      float glide = 1.0 - amp;
      float a1 = s * k * (sin(wph) * 0.8 * amp + glide * (0.12 + sin(uTime * 1.1 + seed) * 0.05));
      float a2 = s * k * (sin(wph - 1.0) * 0.55 * amp - glide * 0.08);
      float sweep = -s * max(0.0, cos(wph)) * 0.4 * amp;
      vec3 ep = aPivot2.xyz;
      p = mix(p, ep + rotZ(rotY(p - ep, sweep), a2), w);
      n = mix(n, rotZ(rotY(n, sweep), a2), w);
      p = piv + rotZ(p - piv, a1);
      n = rotZ(n, a1);
    } else if (aPart < 11.5) {
      // ray fins, a wave running from front to back that grows toward the tips
      float d = abs(p.x - piv.x);
      float wv = sin(ph + aPivot.w - p.z * 2.2);
      p.y += d * d * wv * 0.45 * aPivot2.w;
      n = normalize(n - vec3(sign(p.x) * d * wv * 0.9 * aPivot2.w, 0.0, 0.0));
    } else if (aPart < 20.5) {
      // tentacles sway with a wave running down them. The roots follow the
      // bell, except with a negative amplitude (vines, not on a floater).
      float s = abs(aPivot2.w);
      float pc = step(0.0, aPivot2.w) * amp;
      p.x += (sin(uTime * 1.7 + aPivot.w - t * 4.0) * 0.16 + sin(uTime * 0.6 + aPivot.w * 2.0) * 0.08) * t * s;
      p.z += cos(uTime * 1.3 + aPivot.w * 1.7 - t * 3.3) * 0.16 * t * s;
      p.xz -= piv.xz * fPulse(ph) * pc * 0.18 * (1.0 - t * 0.6);
      p.y += fPulse(ph - t * 1.5) * pc * 0.1 * t * s;
    } else if (aPart < 21.5) {
      // bell squeezes in toward the rim
      float c = fPulse(ph) * amp;
      p.xz = piv.xz + (p.xz - piv.xz) * (1.0 - c * 0.2 * w);
      p.y = piv.y + (p.y - piv.y) * (1.0 + c * 0.1 * w);
    } else if (aPart < 22.5) {
      // frills and sails flutter
      float c = fPulse(ph) * amp;
      p.xz = piv.xz + (p.xz - piv.xz) * (1.0 - c * 0.2 * w);
      p.x += sin(uTime * 3.1 + atan(p.z, p.x) * 6.0 + p.y * 4.0 + seed) * 0.03 * t;
      p.y += sin(uTime * 2.7 + atan(p.z, p.x) * 6.0 + seed) * 0.03 * t;
    } else if (aPart > 23.5 && aPart < 24.5) {
      // streamers trailing behind
      float s = aPivot2.w;
      p.x += sin(uTime * 1.1 + aPivot.w - t * 5.0) * 0.12 * t * s;
      p.y += cos(uTime * 0.9 + aPivot.w * 1.3 - t * 4.0) * 0.1 * t * s;
    }
    // slow wave through the whole body of the long flyers
    float sw = aRig.w;
    if (sw > 0.0) p.y += sw * sin(ph - p.z * 3.5);
    else if (sw < 0.0) p.x -= sw * sin(ph - p.z * 3.5);
    rigN = normalize(n);
    return p;
  }
`;

export function faunaMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, side: THREE.DoubleSide });
  patchStandard(m, {
    key: 'fauna',
    vertexPars: /* glsl */ `
      ${RIG_GLSL}
      varying float vGlowF;
      varying float vGloss;
    `,
    vertexBegin: /* glsl */ `
      transformed = rigP;
      {
        float gl = aRig.z;
        vGloss = step(1.5, gl);
        gl -= vGloss * 2.0;
        vGlowF = gl * (0.8 + 0.2 * sin(uTime * 1.3 + float(gl_InstanceID) * 2.399 + aRig.y * 3.0));
        // comb rows shimmer in waves
        if (aPart > 22.5 && aPart < 23.5) vGlowF *= 0.2 + 0.8 * pow(0.5 + 0.5 * sin(uTime * 4.0 - aRig.y * 9.0 + aPivot.w), 3.0);
      }
    `,
    fragmentPars: 'varying float vGlowF; varying float vGloss;',
    // soft facets like the terrain, part smooth and part flat
    normal: /* glsl */ `
      {
        vec3 fnV = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
        if (dot(fnV, normal) < 0.0) fnV = -fnV;
        normal = normalize(mix(normal, fnV, 0.55));
      }
    `,
    emissive: /* glsl */ `
      {
        vec3 upG = normalize(vWorldPosP - uAmbCenter);
        float nightK = 1.0 - smoothstep(-0.12, 0.18, dot(upG, normalize(uSunPos - uAmbCenter)));
        totalEmissiveRadiance += vColor.rgb * vGlowF * (0.22 + nightK * 1.9);
      }
    `,
    extra(shader) {
      shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n vec3 rigP = faunaRig(position, objectNormal);\n objectNormal = rigN;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.3, vGloss);');
    },
  });
  return m;
}

// shadow pass with the same animation, otherwise shadows keep the rest pose
export function faunaDepthMaterial() {
  const m = new THREE.MeshDepthMaterial();
  m.customProgramCacheKey = () => 'fauna-depth';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = env.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\n${RIG_GLSL}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed = faunaRig(position, vec3(0.0, 1.0, 0.0));');
  };
  return m;
}

// ---------------------------------------------------------------- behaviour

export class Fauna {
  constructor(planet, species) {
    this.planet = planet;
    this.species = species;
    this.group = new THREE.Group();
    planet.group.add(this.group);
    this.material = faunaMaterial();
    this.depthMaterial = faunaDepthMaterial();
    this.herds = [];
    const taken = [];
    for (const sp of species) {
      const geo = BUILD[sp.kind](sp, taken);
      // geometry is unit scale, the instance matrix carries the size
      sp.radius = geo.boundingSphere.radius * sp.size;
      sp.hitY = geo.boundingSphere.center.y * sp.size;
      const max = sp.group * 2;
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
      anim.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aAnim', anim);
      const mesh = new THREE.InstancedMesh(geo, this.material, max);
      mesh.customDepthMaterial = this.depthMaterial;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      sp.mesh = mesh;
      sp.animAttr = anim;
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
          // animation state
          gait: this.rng.range(0, TAU),
          pose: 0,
          look: 0,
          lookTo: 0,
          lookT: this.rng.range(0, 3),
          grazing: false,
          bank: 0,
          pitch: 0,
          lift: 0,
          squash: 0,
          flapping: true,
          flapT: this.rng.range(1, 4),
          spin: this.rng.range(0, TAU),
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
      sp.animAttr.needsUpdate = true;
    }
  }

  stepGrazer(m, herd, dt, player) {
    const sp = herd.sp;
    const up = _v.copy(m.pos).normalize();
    let speed = sp.speed;
    // flee from a player who gets close
    const toPlayer = _v2.subVectors(player, m.pos);
    const pd = toPlayer.length();
    const toDir = _v3.copy(toPlayer).projectOnPlane(up).normalize();
    if (pd < 11) {
      m.target = m.pos.clone().addScaledVector(toDir, -20);
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

    // Gait phase advances with the distance covered so feet don't skate.
    // Hops finish in the air before the creature stops.
    const a = sp.anim;
    const v = moving ? speed : 0;
    if (a.hop) {
      const len = a.stride * sp.size;
      const airborne = Math.sin(m.gait) > 0;
      m.gait += v ? (dt * v * TAU) / len : airborne ? dt * TAU * 1.2 : 0;
      const s = Math.sin(m.gait);
      m.lift = Math.max(0, s) * a.hip * sp.size * 0.55 * m.walk;
      m.squash = (s < 0 ? -s * 0.1 : -s * 0.05) * m.walk;
    } else {
      const stride = Math.max(0.05, a.stride * sp.size * Math.max(0.35, m.walk));
      m.gait += Math.min((dt * v * TAU) / stride, dt * TAU * 6);
      m.lift = -a.hip * sp.size * (1 - Math.cos(0.5 * m.walk * Math.sin(m.gait)));
    }
    m.gait %= TAU;

    // idle: graze with the head down or look around, and keep an eye on a
    // player who comes close
    if (!moving) {
      m.lookT -= dt;
      if (m.lookT <= 0) {
        m.lookT = this.rng.range(1.5, 4.5);
        m.grazing = this.rng.chance(0.55);
        m.lookTo = m.grazing ? 0 : this.rng.range(-0.8, 0.8);
      }
    }
    let poseTo = !moving && m.grazing ? 1 : 0;
    let lookTo = moving ? 0 : m.lookTo;
    if (pd < 28 && !(m.fleeing > 0)) {
      poseTo = 0;
      _f.copy(m.heading).projectOnPlane(up).normalize();
      _r.crossVectors(_f, up);
      lookTo = Math.max(-1.1, Math.min(1.1, Math.atan2(-toDir.dot(_r), toDir.dot(_f))));
    }
    m.pose += (poseTo - m.pose) * Math.min(1, dt * 2.5);
    m.look += (lookTo - m.look) * Math.min(1, dt * 3);

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
    const sp = herd.sp;
    const big = sp.kind === 'leviathan';
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
    const prev = _f.copy(m.heading).projectOnPlane(dir).normalize();
    let climb = 0;
    if (vel.lengthSq() > 1e-6) {
      m.heading.copy(vel).normalize();
      climb = m.heading.dot(dir);
    }
    m.pos.lerp(target, Math.min(1, dt * 2));
    m.up = dir;

    // bank into the turn and pitch with the climb
    const cur = _r.copy(m.heading).projectOnPlane(dir).normalize();
    const turn = dt > 0 ? Math.asin(Math.max(-1, Math.min(1, _v3.crossVectors(prev, cur).dot(dir)))) / dt : 0;
    const bankTo = Math.max(-0.75, Math.min(0.75, turn * (big ? 6 : 2.5)));
    m.bank += (bankTo - m.bank) * Math.min(1, dt * (big ? 0.5 : 2));
    m.pitch += (Math.max(-0.4, Math.min(0.4, climb * 1.5)) - m.pitch) * Math.min(1, dt * 2);

    // flap in bursts and glide in between, always flap when climbing
    const a = sp.anim;
    if (a.glides) {
      m.flapT -= dt;
      if (m.flapT <= 0) {
        m.flapping = !m.flapping;
        m.flapT = m.flapping ? this.rng.range(1.5, 4) : this.rng.range(1, 3);
      }
      const want = m.flapping || climb > 0.08 ? 1 : 0;
      m.walk += (want - m.walk) * Math.min(1, dt * 2.5);
      m.gait += dt * TAU * a.hz * (0.4 + 0.6 * m.walk);
    } else {
      m.walk = 1;
      m.gait += dt * TAU * a.hz;
    }
    m.gait %= TAU;
  }

  stepFloater(m, herd, dt, time) {
    const sp = herd.sp;
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
    // turn slowly and sway a little, each stroke gives a small push up
    m.spin += dt * 0.1 * Math.sign(m.orbitW);
    m.heading.set(1, 0, 0).projectOnPlane(dir).normalize().applyAxisAngle(dir, m.spin);
    m.up = dir;
    m.walk = 1;
    m.gait = (m.gait + dt * TAU * sp.anim.hz) % TAU;
    m.lift = Math.sin(m.gait - 1.2) * 0.08 * sp.size;
    m.bank = Math.sin(time * 0.4 + m.phase) * 0.08;
    m.pitch = Math.cos(time * 0.33 + m.phase) * 0.08;
  }

  writeInstance(sp, m) {
    const i = sp.count++;
    const up = m.up || _v.copy(m.pos).normalize();
    const fwd = _f.copy(m.heading).projectOnPlane(up).normalize();
    if (fwd.lengthSq() < 0.5) fwd.set(1, 0, 0).projectOnPlane(up).normalize();
    const right = _r.crossVectors(up, fwd);
    // model faces -Z
    _m.makeBasis(right.negate(), up, _v3.copy(fwd).negate());
    _q.setFromRotationMatrix(_m);
    if (m.bank || m.pitch) _q.multiply(_q2.setFromEuler(_e.set(m.pitch || 0, 0, m.bank || 0)));
    // hoppers squash on landing and stretch in the air, around the feet
    const sq = m.squash || 0;
    _s.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5).multiplyScalar(sp.size);
    _v2.copy(m.pos).addScaledVector(up, m.lift || 0);
    _m.compose(_v2, _q, _s);
    sp.mesh.setMatrixAt(i, _m);
    sp.animAttr.setXYZW(i, m.walk, m.gait || 0, m.pose || 0, m.look || 0);
    m.index = i;
  }

  // creature hit by a local ray, for the analysis visor
  raycast(origin, dir, range) {
    let best = null;
    for (const herd of this.herds) {
      const sp = herd.sp;
      for (const m of herd.members) {
        const up = m.up || _v.copy(m.pos).normalize();
        const c = _v2.copy(m.pos).addScaledVector(up, sp.hitY).sub(origin);
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
    this.depthMaterial.dispose();
    this.planet.group.remove(this.group);
  }
}
