import { createNoise3D, createNoise3DGrad, fbm } from '../core/noise.js';
import { hash3, hashInt } from '../core/rng.js';
import { smoothstep } from '../core/math.js';

// Planet height function. Shared by the chunk workers and the main thread
// (collision, scatter placement) so both always agree on where the ground is.
// Heights are in meters relative to the planet's base radius (sea level).
//
// On top of continents, mountains and hills each planet type gets its own
// landforms (see buildLandforms in planetTypes.js). A feature parameter left
// at 0 or undefined turns that feature off. Anything with a small width fades
// with lod so far chunks don't alias.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Every key sample() reads. Params are copied into one fixed shape because
// planet types set different keys in different orders, and a worker that sees
// several planets would otherwise make every t.x lookup polymorphic (about
// 1.5x slower overall).
const PARAMS = {
  seed: 0, radius: 1000, contScale: 1000, contAmp: 0, contBias: 0, oceanDepth: 0,
  mountScale: 1000, mountAmp: 0, mountCoverage: 0, mountSharp: 1, hillScale: 100, hillAmp: 0,
  detailScale: 30, detailAmp: 0, warpScale: 1000, warpAmp: 0, terraceStep: 0, terraceMix: 0,
  duneAmp: 0, duneScale: 100, pillarAmp: 0, pillarScale: 100, pillarThreshold: 0.5,
  craterDensity: 0, craterScale: 500, craterDepth: 0.25, craterGlass: 0, craterEjecta: 0, mariaLevel: 0,
  beachWidth: 0, moistScale: 1000, hasOcean: false, erosion: 0,
  riverScale: 2000, riverWidth: 5, riverBank: 10, riverSlope: 0, riverHi: 0, riverMoist: 0, riverDepth: 0, canyonDepth: 0, canyonRel: 0, riverGlow: 0,
  mesaScale: 800, mesaAmp: 0, mesaTiers: 1, mesaGap: 0.1, mesaLevel: 0.3, mesaEdge: 6, butteLevel: 0,
  volcScale: 2500, volcDensity: 0, volcAmp: 0,
  blisterScale: 200, blisterDensity: 0, blisterAmp: 0, poolRatio: 0, poolDepth: 0,
  colScale: 10, colAmp: 0, colBevel: 1, colRegion: 600, colLevel: 0,
  arcScale: 2000, arcAmp: 0, bankDepth: 3, atollScale: 1000, atollDensity: 0, atollH: 0, lagoonDepth: 0,
  iceLevel: 0, iceSoft: 8, iceScale: 1000, crevScale: 100, crevWidth: 3, crevDepth: 0,
};

function params(src) {
  const t = {};
  for (const k in PARAMS) t[k] = src[k] ?? PARAMS[k];
  return t;
}

export class TerrainGenerator {
  constructor(src) {
    const t = params(src);
    this.t = t;
    this.R = t.radius;
    this.nA = createNoise3D(t.seed);
    this.nB = createNoise3D(t.seed + 101);
    this.nC = createNoise3D(t.seed + 202);
    this.nD = createNoise3D(t.seed + 303);
    // gA to gD are the same fields as nA to nD plus their gradients
    this.gA = createNoise3DGrad(t.seed);
    this.gB = createNoise3DGrad(t.seed + 101);
    this.gC = createNoise3DGrad(t.seed + 202);
    this.gD = createNoise3DGrad(t.seed + 303);
    this.gW = createNoise3DGrad(t.seed + 404);
    this.gR = createNoise3DGrad(t.seed + 505);
    this.gK = createNoise3DGrad(t.seed + 606);
    this.craterSeed = (t.seed * 7 + 13) | 0;
    this.cellSeed = hashInt(t.seed ^ 0x3c6ef372);
    this.erosion = t.erosion || 0;
    const ml = t.mariaLevel || 0;
    this.mariaH = ml > 0 ? (1 - Math.exp(-ml * 3.5)) * t.contAmp : ml * t.oceanDepth;
    this.g = new Float64Array(3);
    this.g2 = new Float64Array(3);
    // per sample outputs of the helpers
    this.f = 0;
    this.flat = 0;
    this.carved = 0;
    this.bed = 0;
    this._tmp = { h: 0, m: 0, f: 0 };
  }

  // Samples the unit direction (x, y, z). out receives { h, m, f }, f is a 0..1
  // feature mask the terrain shader colors per planet type (lava, ice, glass).
  // Negative f marks dark maria on airless worlds.
  // lod is the smallest wavelength in meters worth evaluating.
  sample(x, y, z, out, lod = 0) {
    const t = this.t;
    const R = this.R;
    let px = x * R, py = y * R, pz = z * R;
    this.f = 0;

    if (t.warpAmp > 0) {
      // offset along the gradient of a two octave field, about as strong as
      // three separate fbm lookups at a third of the cost
      const s = 1 / t.warpScale;
      const g = this.g;
      this.gW(px * s, py * s, pz * s, g);
      let wx = g[0], wy = g[1], wz = g[2];
      const w2 = Math.min(1, (t.warpScale / (2 * lod) - 1) * 1.5);
      if (w2 > 0) {
        this.gW(px * s * 2 + 19.1, py * s * 2 + 7.3, pz * s * 2 - 11.7, g);
        wx += g[0] * 0.5 * w2;
        wy += g[1] * 0.5 * w2;
        wz += g[2] * 0.5 * w2;
      }
      const k = t.warpAmp * 0.12;
      px += wx * k;
      py += wy * k;
      pz += wz * k;
    }

    // continents
    const cs = 1 / t.contScale;
    const c = fbm(this.nA, px * cs, py * cs, pz * cs, 5, lod * cs) * 1.35 + t.contBias;
    let h;
    if (c > 0) h = (1 - Math.exp(-c * 3.5)) * t.contAmp;
    else h = c * t.oceanDepth;
    const land = smoothstep(-0.04, 0.2, c);
    const h0 = h;

    const ms2 = 1 / t.moistScale;
    let m = fbm(this.nD, px * ms2 + 7.7, py * ms2, pz * ms2, 3, lod * ms2) * 0.75 + 0.5;
    m = m < 0 ? 0 : m > 1 ? 1 : m;

    // tablelands and mesas, flat tops keep less of the hills below
    let flat = 0;
    if (t.mesaAmp > 0) {
      h += this.mesas(px, py, pz, x, y, z, lod) * land;
      flat = this.flat * land;
    }

    // mountains, grouped into ranges by a low frequency region mask
    if (t.mountAmp > 0) {
      const rs = 1 / (t.contScale * 0.6);
      const region = fbm(this.nB, px * rs + 3.3, py * rs, pz * rs, 2, lod * rs) * 0.5 + 0.5;
      const cov = t.mountCoverage;
      const mask = smoothstep(0.75 - cov, 1.0 - cov * 0.8, region + c * 0.35) * (0.25 + 0.75 * land);
      if (mask > 0.001) {
        const ms = 1 / t.mountScale;
        const r = this.erodedRidge(px * ms, py * ms, pz * ms, x, y, z, 6, 3, lod * ms, this.erosion * 0.06);
        h += Math.pow(r, t.mountSharp) * t.mountAmp * mask;
      }
    }

    // volcanoes, their cones keep smooth flanks
    let cone = 0;
    if (t.volcDensity > 0) {
      const v = this.volcanoes(px, py, pz) * (0.3 + 0.7 * land);
      h += v;
      cone = Math.min(1, v / (t.volcAmp * 0.3));
    }

    // rolling hills
    const hs = 1 / t.hillScale;
    const hill = this.erodedFbm(this.gB, this.nB, px * hs, py * hs, pz * hs, x, y, z, 5, 2, lod * hs, this.erosion * 0.35);
    h += hill * t.hillAmp * (0.35 + 0.65 * land) * (1 - 0.8 * flat) * (1 - 0.7 * cone);

    // plateaus and mesas
    if (t.terraceStep > 0 && h > 0) {
      const tt = h / t.terraceStep;
      const fl = Math.floor(tt);
      const f = tt - fl;
      const stepped = (fl + smoothstep(0.45, 0.85, f)) * t.terraceStep;
      h += (stepped - h) * t.terraceMix;
    }

    if (t.duneAmp > 0) {
      const ds = 1 / t.duneScale;
      if (t.duneScale > lod * 0.7) {
        const n = 1 - Math.abs(this.nC(px * ds * 0.3, py * ds, pz * ds * 0.85 + this.nB(px * ds * 0.1, py * ds * 0.1, pz * ds * 0.1) * 2.0));
        const dm = smoothstep(0.1, 0.5, fbm(this.nD, px * cs * 2, py * cs * 2, pz * cs * 2, 2));
        h += n * n * t.duneAmp * dm * land * (1 - flat);
      }
    }

    if (t.pillarAmp > 0 && t.pillarScale > lod * 0.8) {
      const ps = 1 / t.pillarScale;
      const v = this.nD(px * ps, py * ps, pz * ps);
      const pm = smoothstep(t.pillarThreshold, t.pillarThreshold + 0.05, v);
      if (pm > 0) {
        const cap = 0.75 + 0.25 * this.nC(px * ps * 3, py * ps * 3, pz * ps * 3);
        h += pm * t.pillarAmp * cap * land;
      }
    }

    // blisters come in fields, only in the wetter half of the planet
    if (t.blisterDensity > 0 && t.blisterScale > lod * 2 && m > 0.42) h += this.blisters(px, py, pz, lod) * land * smoothstep(0.42, 0.5, m);

    if (t.colAmp > 0) h += this.columns(px, py, pz, lod) * land;

    if (t.craterDensity > 0) {
      // maria: low basins flooded smooth long ago, fewer craters since
      const maria = t.mariaLevel ? smoothstep(t.mariaLevel + 0.1, t.mariaLevel - 0.02, c) : 0;
      if (maria > 0) {
        h += (this.mariaH - h) * maria * 0.85;
        // negative feature values darken, see createTerrainMaterial
        this.f = -maria;
      }
      const k = 1 - maria * 0.6;
      h += this.craters(px, py, pz, t.craterScale, lod, 0) * k;
      h += this.craters(px, py, pz, t.craterScale * 0.3, lod, 1) * 0.8 * k;
    }

    // island chains out in the open ocean: rounded islands strung along the
    // ridge lines of a field, sitting on a shallow shelf that reads turquoise
    if (t.arcAmp > 0 && c < 0.1 && h < t.arcAmp) {
      const as = 1 / t.arcScale;
      const a = 1 - Math.abs(this.nB(px * as + 41.3, py * as, pz * as - 17.7));
      if (a > 0.8) {
        const bump = smoothstep(0.05, 0.6, this.nC(px * as * 5 - 3.1, py * as * 5 + 8.4, pz * as * 5)) * smoothstep(0.88, 0.98, a);
        const top = -t.bankDepth + (t.arcAmp + t.bankDepth) * bump * bump * (3 - 2 * bump) + hill * 3;
        const band = smoothstep(0.8, 0.9, a) * smoothstep(0.1, -0.05, c);
        if (top > h) h += (top - h) * band;
      }
    }
    if (t.atollDensity > 0 && h < 4) h = this.atolls(px, py, pz, h);

    // ice sheets bury the low ground on frozen worlds and end in steep ice
    // walls a little inland of the coast
    let ice = 0;
    if (t.iceLevel > 0) {
      let shelf = 1;
      if (t.hasOcean) {
        // a wide rounded margin a little inland of the coast. The continent
        // field changes about 3.5 units per contScale.
        const e = Math.max(45, lod * 3) * 3.5 * cs;
        const mid = 40 * 3.5 * cs;
        shelf = smoothstep(mid - e * 0.5, mid + e * 0.5, c);
      }
      if (shelf > 0) {
        // a set height over the continent floor, so the ice buries the hills
        // and leaves the ranges standing out of it
        const is = 1 / t.iceScale;
        const L = ((h0 > 0 ? h0 : 0) + t.iceLevel + this.nC(px * is, py * is, pz * is) * t.iceLevel * 0.45) * shelf;
        const k = t.iceSoft;
        const d = h - L;
        if (d < k) {
          if (d <= -k) {
            h = L;
            ice = shelf;
          } else {
            h = L + ((d + k) * (d + k)) / (4 * k);
            ice = (1 - (d + k) / (2 * k)) * shelf;
          }
        }
      }
    }

    // rivers, canyons, lava channels and glowing fissures all carve along the
    // zero line of one low frequency field
    if (t.riverDepth > 0 || t.canyonDepth > 0) {
      let amt = t.riverHi ? 1 - smoothstep(t.riverHi * 0.5, t.riverHi, h) : 1;
      if (t.riverMoist > 0) amt *= smoothstep(t.riverMoist - 0.08, t.riverMoist + 0.08, m);
      if (amt > 0) {
        const w = this.carve(px, py, pz, x, y, z, h, h0, lod, amt);
        h = this.carved;
        if (w > 0) {
          // wetter banks along real rivers
          if (t.riverDepth > 0) m += w * 0.25 * (1 - m);
          if (t.riverGlow) this.f = Math.max(this.f, this.bed * amt);
        }
      }
    }

    if (t.crevDepth > 0 && ice > 0.3 && lod < t.crevWidth * 1.2) h -= this.crevasses(px, py, pz, x, y, z, lod) * (ice - 0.3) * 1.43;
    if (ice > 0) this.f = Math.max(this.f, ice);

    // small detail
    const ds2 = 1 / t.detailScale;
    h += fbm(this.nC, px * ds2, py * ds2, pz * ds2, 3, lod * ds2) * t.detailAmp * (1 - 0.6 * flat) * (1 - 0.75 * ice);

    // flatten around sea level for beaches
    if (t.beachWidth > 0) {
      const b = t.beachWidth;
      h = (h * h * h) / (h * h + b * b);
    }

    out.h = h;
    out.m = m;
    out.f = this.f;
    return h;
  }

  height(x, y, z, lod = 0) {
    return this.sample(x, y, z, this._tmp, lod);
  }

  // fBm where each octave is damped by the slope of the octaves before it
  // (Inigo Quilez's article on noise derivatives). Slopes come out smooth and the detail
  // gathers on flats, crests and valley floors, which reads as weathering.
  // (ux, uy, uz) is the surface normal, only the slope along the ground counts.
  // Gradients are only taken for the first `slopeOcts` octaves. The finer
  // ones are damped by the slope so far, which looks the same and saves about
  // a third of the cost.
  erodedFbm(ng, n0, x, y, z, ux, uy, uz, octaves, slopeOcts, minWave, k) {
    const g = this.g;
    let sum = 0, amp = 1, freq = 1, norm = 0, dx = 0, dy = 0, dz = 0, e = 1;
    for (let o = 0; o < octaves; o++) {
      const wave = 1 / freq;
      if (wave < minWave) break;
      const w = minWave > 0 ? Math.min(1, (wave / minWave - 1) * 1.5) : 1;
      if (o < slopeOcts) {
        const n = ng(x * freq, y * freq, z * freq, g);
        const du = dx * ux + dy * uy + dz * uz;
        e = 1 / (1 + k * (dx * dx + dy * dy + dz * dz - du * du));
        sum += n * amp * w * e;
        const s = amp * freq * w;
        dx += g[0] * s;
        dy += g[1] * s;
        dz += g[2] * s;
        if (o === slopeOcts - 1) {
          const du2 = dx * ux + dy * uy + dz * uz;
          e = 1 / (1 + k * (dx * dx + dy * dy + dz * dz - du2 * du2));
        }
      } else sum += n0(x * freq, y * freq, z * freq) * amp * w * e;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return norm > 0 ? sum / norm : 0;
  }

  // Ridged multifractal with the same slope damping. Crests stay sharp, the
  // flanks smooth out into long spurs and gullies instead of noisy rubble.
  erodedRidge(x, y, z, ux, uy, uz, octaves, slopeOcts, minWave, k) {
    const g = this.g;
    let sum = 0, amp = 1, freq = 1, norm = 0, prev = 1, dx = 0, dy = 0, dz = 0, e = 1;
    for (let o = 0; o < octaves; o++) {
      const wave = 1 / freq;
      if (wave < minWave) break;
      const w = minWave > 0 ? Math.min(1, (wave / minWave - 1) * 1.5) : 1;
      let n;
      if (o < slopeOcts) {
        n = this.gA(x * freq + o * 17.1, y * freq, z * freq, g);
        const du = dx * ux + dy * uy + dz * uz;
        e = 1 / (1 + k * (dx * dx + dy * dy + dz * dz - du * du));
      } else n = this.nA(x * freq + o * 17.1, y * freq, z * freq);
      const r = 1 - (n < 0 ? -n : n);
      const v = r * r * amp * prev * w;
      sum += v * e;
      if (o < slopeOcts) {
        // d(r^2)/dp = -2 r sign(n) grad
        const s = (n < 0 ? 2 : -2) * r * amp * prev * w * freq;
        dx += g[0] * s;
        dy += g[1] * s;
        dz += g[2] * s;
        if (o === slopeOcts - 1) {
          const du2 = dx * ux + dy * uy + dz * uz;
          e = 1 / (1 + k * (dx * dx + dy * dy + dz * dz - du2 * du2));
        }
      }
      norm += amp;
      prev = Math.min(1, r * r * 1.8);
      amp *= 0.5;
      freq *= 2;
    }
    return norm > 0 ? sum / norm : 0;
  }

  // Flat topped plateaus in tiers. Each tier has a sharp rim over a steep
  // cliff and a gentle talus apron at the foot. Sets this.flat to the top mask.
  mesas(px, py, pz, ux, uy, uz, lod) {
    const t = this.t;
    const s = 1 / t.mesaScale;
    const g = this.g;
    // three octave fbm with its gradient
    const qx = px * s + 31.7, qy = py * s - 12.9, qz = pz * s + 5.3;
    const mw = lod * s;
    let v = 0, gx = 0, gy = 0, gz = 0, amp = 1, freq = 1, norm = 0;
    for (let o = 0; o < 3; o++) {
      const wave = 1 / freq;
      if (wave < mw) break;
      const w = mw > 0 ? Math.min(1, (wave / mw - 1) * 1.5) : 1;
      v += this.gC(qx * freq, qy * freq, qz * freq, g) * amp * w;
      const k = amp * freq * w;
      gx += g[0] * k;
      gy += g[1] * k;
      gz += g[2] * k;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    v /= norm;
    gx /= norm;
    gy /= norm;
    gz /= norm;
    if (t.butteLevel > 0) {
      // lone buttes out on the flats
      const b = this.gD(px * s * 4 - 8.1, py * s * 4 + 2.2, pz * s * 4, g);
      const bv = t.mesaLevel + (b - t.butteLevel) * 0.3;
      if (bv > v) {
        v = bv;
        gx = g[0] * 1.2;
        gy = g[1] * 1.2;
        gz = g[2] * 1.2;
      }
    }
    // Rim width in field units from the slope of the field along the ground,
    // so every cliff is the same width in meters. Where the field changes
    // fast a fixed width made cliffs narrower than the vertex spacing, which
    // shows up as a row of teeth.
    const gu = gx * ux + gy * uy + gz * uz;
    const gt = Math.sqrt(Math.max(gx * gx + gy * gy + gz * gz - gu * gu, 0.25)) * s;
    // Coarse chunks get wider cliffs around the same midline, so neighbors
    // of different levels still meet at about the same height
    const e0 = t.mesaEdge * gt;
    const e = Math.max(t.mesaEdge, lod * 1.5) * gt;
    let rise = 0;
    this.flat = 0;
    for (let i = 0; i < t.mesaTiers; i++) {
      const th = t.mesaLevel + i * t.mesaGap + e0 * 0.5;
      // rounded rim, a hard kink there saws into teeth on the vertex grid
      const q1 = clamp01((v - th) / e + 0.5);
      const q2 = clamp01((v - th + e * 3.5) / (e * 4));
      rise += 0.8 * q1 * q1 * (3 - 2 * q1) + 0.2 * q2 * q2 * (3 - 2 * q2);
      if (i === 0) this.flat = q1;
    }
    return (rise * t.mesaAmp) / t.mesaTiers;
  }

  // Cuts a channel along the zero line of a low frequency field. Distance to
  // the line comes from value / gradient, so the width stays even whatever the
  // field is doing. Wet channels (rivers, lava) go down to riverDepth below sea
  // level so the ocean pass fills them. Dry ones (canyons, glacial valleys,
  // fissures) cut canyonDepth below the continent floor, with benches when the
  // planet has terraces. Returns how close to the bed the point is (0..1),
  // this.carved is the new height and this.bed the bed mask.
  carve(px, py, pz, ux, uy, uz, h, h0, lod, amt) {
    const t = this.t;
    const g = this.g, g2 = this.g2;
    const s = 1 / t.riverScale;
    const n1 = this.gR(px * s, py * s, pz * s, g);
    const n2 = this.gR(px * s * 2.7 + 13.1, py * s * 2.7 - 4.2, pz * s * 2.7, g2);
    const v = n1 + n2 * 0.3;
    const gx = g[0] + g2[0] * 0.81, gy = g[1] + g2[1] * 0.81, gz = g[2] + g2[2] * 0.81;
    const gu = gx * ux + gy * uy + gz * uz;
    // clamped so saddles in the field don't blow the valley up
    const gt = Math.sqrt(Math.max(gx * gx + gy * gy + gz * gz - gu * gu, 0.8));
    const dist = (v < 0 ? -v : v) / (gt * s);
    this.carved = h;
    this.bed = 0;
    const wb = Math.max(t.riverWidth, lod * 0.7);
    const hb = h > 0 ? h : 0;
    // the valley doesn't grow with lod, only the flat bed inside it does
    const wv = Math.max(t.riverWidth + t.riverBank + hb * t.riverSlope, wb * 1.5);
    if (dist >= wv) return 0;
    const q = dist <= wb ? 0 : (dist - wb) / (wv - wb);
    let target;
    if (t.canyonDepth > 0) {
      // canyons cut down from the continent floor, through any mesa in the
      // way, fissures just follow the ground
      // narrow fissures get shallower as the bed widens on coarse chunks
      const depth = t.canyonRel ? t.canyonDepth * Math.min(1, (t.riverWidth * 2) / wb) : t.canyonDepth;
      const bed = (t.canyonRel || h0 > h ? h : h0) - depth;
      // eased at the foot and the rim, a crease at the floor saws into teeth
      const k = q * q * (3 - 2 * q);
      target = bed + (h - bed) * k;
      if (t.terraceStep > 0) {
        // soft risers, sharp ones saw into teeth where the wall is steep
        const tt = (target - bed) / t.terraceStep;
        const fl = Math.floor(tt);
        target = bed + (fl + smoothstep(0.3, 0.9, tt - fl)) * t.terraceStep;
      }
    } else {
      const bed = -t.riverDepth * Math.min(1, (t.riverWidth * 2) / wb);
      target = bed + (h - bed) * q * q * (3 - 2 * q);
    }
    if (target < h) this.carved = h + (target - h) * amt;
    this.bed = 1 - smoothstep(wb * 0.5, wb * 1.2, dist);
    return 1 - q;
  }

  // Shield and strato volcanoes with a caldera on top. The caldera floor
  // glows (this.f).
  volcanoes(px, py, pz) {
    const t = this.t;
    const inv = 1 / t.volcScale;
    const gx = px * inv, gy = py * inv, gz = pz * inv;
    const cx = Math.floor(gx), cy = Math.floor(gy), cz = Math.floor(gz);
    const fx = gx - cx, fy = gy - cy, fz = gz - cz;
    const RM2 = 0.4 * 0.4;
    let total = 0;
    for (let dz = -1; dz <= 1; dz++) {
      const bz = dz < 0 ? fz * fz : dz > 0 ? (1 - fz) * (1 - fz) : 0;
      if (bz > RM2) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const by = bz + (dy < 0 ? fy * fy : dy > 0 ? (1 - fy) * (1 - fy) : 0);
        if (by > RM2) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (by + (dx < 0 ? fx * fx : dx > 0 ? (1 - fx) * (1 - fx) : 0) > RM2) continue;
          const ix = cx + dx, iy = cy + dy, iz = cz + dz;
          const hsh = hash3(ix, iy, iz, this.cellSeed);
          if ((hsh & 1023) / 1024 > t.volcDensity) continue;
          const h2 = hashInt(hsh);
          const ox = ix + ((hsh >>> 10) & 255) / 255, oy = iy + ((hsh >>> 18) & 255) / 255, oz = iz + (h2 & 255) / 255;
          const r = 0.24 + 0.16 * (((h2 >>> 8) & 255) / 255);
          const ddx = gx - ox, ddy = gy - oy, ddz = gz - oz;
          const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
          if (d2 >= r * r) continue;
          const d = Math.sqrt(d2) / r;
          const H = t.volcAmp * (0.5 + 0.5 * (((h2 >>> 16) & 255) / 255));
          const rc = 0.12 + 0.08 * (((h2 >>> 24) & 127) / 127);
          if (d > rc) {
            const q = (1 - d) / (1 - rc);
            total += H * Math.pow(q, 2.2);
          } else {
            const k = d / rc, k2 = k * k;
            // steep inner wall down to a flat floor
            total += H * (0.86 + 0.14 * k2 * k2 * k2);
            const lava = 1 - smoothstep(0.55, 0.9, k);
            if (lava > this.f) this.f = lava;
          }
        }
      }
    }
    return total;
  }

  // Round blisters: smooth bubble domes, or sunken pools with a crusted rim
  // whose floor the shader paints as liquid (this.f).
  blisters(px, py, pz, lod) {
    const t = this.t;
    const S = t.blisterScale;
    const inv = 1 / S;
    const gx = px * inv, gy = py * inv, gz = pz * inv;
    const cx = Math.floor(gx), cy = Math.floor(gy), cz = Math.floor(gz);
    const fx = gx - cx, fy = gy - cy, fz = gz - cz;
    const RM2 = 0.55 * 0.55;
    const fade = 1 - smoothstep(S * 0.08, S * 0.2, lod);
    let total = 0;
    for (let dz = -1; dz <= 1; dz++) {
      const bz = dz < 0 ? fz * fz : dz > 0 ? (1 - fz) * (1 - fz) : 0;
      if (bz > RM2) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const by = bz + (dy < 0 ? fy * fy : dy > 0 ? (1 - fy) * (1 - fy) : 0);
        if (by > RM2) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (by + (dx < 0 ? fx * fx : dx > 0 ? (1 - fx) * (1 - fx) : 0) > RM2) continue;
          const ix = cx + dx, iy = cy + dy, iz = cz + dz;
          const hsh = hash3(ix, iy, iz, this.cellSeed + 17);
          if ((hsh & 1023) / 1024 > t.blisterDensity) continue;
          const h2 = hashInt(hsh);
          const ox = ix + ((hsh >>> 10) & 255) / 255, oy = iy + ((hsh >>> 18) & 255) / 255, oz = iz + (h2 & 255) / 255;
          const r = 0.2 + 0.24 * (((h2 >>> 8) & 255) / 255);
          const ddx = gx - ox, ddy = gy - oy, ddz = gz - oz;
          const d2 = (ddx * ddx + ddy * ddy + ddz * ddz) / (r * r);
          if (d2 >= 1.56) continue;
          const d = Math.sqrt(d2);
          const H = r * S * t.blisterAmp;
          if ((((h2 >>> 16) & 255) / 255) >= t.poolRatio) {
            if (d < 1) {
              const q = 1 - d2;
              total += H * q * Math.sqrt(q) * (1.6 - 0.6 * q);
            }
          } else {
            // pool: raised lip, flat sunken floor
            const e = (d - 0.92) / 0.14;
            total += H * 0.25 * Math.exp(-e * e) * fade;
            total -= t.poolDepth * (1 - smoothstep(0.62, 0.86, d)) * fade;
            const liq = 1 - smoothstep(0.66, 0.8, d);
            if (liq > this.f) this.f = liq;
          }
        }
      }
    }
    return total;
  }

  // Fields of basalt columns: the ground is split into irregular cells, each
  // lifted by its own amount with a small bevel between neighbors. Only the
  // near side 2x2x2 cells are searched, jitter is kept small enough for that.
  columns(px, py, pz, lod) {
    const t = this.t;
    const S = t.colScale;
    const rs = 1 / t.colRegion;
    const reg = smoothstep(t.colLevel, t.colLevel + 0.12, this.nB(px * rs - 23.1, py * rs + 9.7, pz * rs));
    if (reg <= 0) return 0;
    // coarse chunks get the average column height instead of nothing
    const fade = 1 - smoothstep(S * 0.3, S * 0.75, lod);
    if (fade <= 0) return 0.5 * t.colAmp * reg;
    const inv = 1 / S;
    const gx = px * inv, gy = py * inv, gz = pz * inv;
    const cx = Math.floor(gx), cy = Math.floor(gy), cz = Math.floor(gz);
    const sx = gx - cx < 0.5 ? -1 : 0, sy = gy - cy < 0.5 ? -1 : 0, sz = gz - cz < 0.5 ? -1 : 0;
    let d1 = 1e9, d2 = 1e9, h1 = 0, h2 = 0;
    for (let k = 0; k < 8; k++) {
      const ix = cx + sx + (k & 1), iy = cy + sy + ((k >> 1) & 1), iz = cz + sz + (k >> 2);
      const hsh = hash3(ix, iy, iz, this.cellSeed + 31);
      const ox = ix + 0.25 + (hsh & 255) / 510, oy = iy + 0.25 + ((hsh >>> 8) & 255) / 510, oz = iz + 0.25 + ((hsh >>> 16) & 255) / 510;
      const ddx = gx - ox, ddy = gy - oy, ddz = gz - oz;
      const d = ddx * ddx + ddy * ddy + ddz * ddz;
      const ch = (hsh >>> 24) / 255;
      if (d < d1) {
        d2 = d1; h2 = h1;
        d1 = d; h1 = ch;
      } else if (d < d2) {
        d2 = d;
        h2 = ch;
      }
    }
    // distance to the shared edge in meters, roughly
    const edge = (Math.sqrt(d2) - Math.sqrt(d1)) * S * 0.5;
    const k = smoothstep(0, t.colBevel, edge);
    const top = (h1 + h2) * 0.5 + (h1 - h2) * 0.5 * k;
    return (0.5 + (top - 0.5) * fade) * t.colAmp * reg;
  }

  // Ring reefs with a shallow lagoon inside and low islets on the rim. Only
  // ever raises the sea floor.
  atolls(px, py, pz, h) {
    const t = this.t;
    const S = t.atollScale;
    const inv = 1 / S;
    const gx = px * inv, gy = py * inv, gz = pz * inv;
    const cx = Math.floor(gx), cy = Math.floor(gy), cz = Math.floor(gz);
    const fx = gx - cx, fy = gy - cy, fz = gz - cz;
    const RM2 = 0.56 * 0.56;
    for (let dz = -1; dz <= 1; dz++) {
      const bz = dz < 0 ? fz * fz : dz > 0 ? (1 - fz) * (1 - fz) : 0;
      if (bz > RM2) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const by = bz + (dy < 0 ? fy * fy : dy > 0 ? (1 - fy) * (1 - fy) : 0);
        if (by > RM2) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (by + (dx < 0 ? fx * fx : dx > 0 ? (1 - fx) * (1 - fx) : 0) > RM2) continue;
          const ix = cx + dx, iy = cy + dy, iz = cz + dz;
          const hsh = hash3(ix, iy, iz, this.cellSeed + 53);
          if ((hsh & 1023) / 1024 > t.atollDensity) continue;
          const h2 = hashInt(hsh);
          const ox = ix + ((hsh >>> 10) & 255) / 255, oy = iy + ((hsh >>> 18) & 255) / 255, oz = iz + (h2 & 255) / 255;
          const r = 0.24 + 0.16 * (((h2 >>> 8) & 255) / 255);
          const ddx = gx - ox, ddy = gy - oy, ddz = gz - oz;
          const d2 = (ddx * ddx + ddy * ddy + ddz * ddz) / (r * r);
          if (d2 >= 1.96) continue;
          const d = Math.sqrt(d2);
          // islets along the ring with gaps the sea runs through
          const gap = this.nB(px * 0.012 + 7.1, py * 0.012, pz * 0.012 - 3.3);
          const top = t.atollH * (0.35 + gap);
          let v;
          if (d < 0.68) v = -t.lagoonDepth;
          else if (d < 0.92) v = -t.lagoonDepth + (top + t.lagoonDepth) * smoothstep(0.68, 0.9, d);
          else if (d < 1.05) v = top;
          else v = top - (top + t.oceanDepth) * smoothstep(1.05, 1.4, d);
          if (v > h) h = v;
        }
      }
    }
    return h;
  }

  // Crevasse depth at a point on an ice sheet, 0 outside the cracks
  crevasses(px, py, pz, ux, uy, uz, lod) {
    const t = this.t;
    const g = this.g;
    const s = 1 / t.crevScale;
    // stretched along one axis so the cracks tend to run in parallel sets
    const n = this.gK(px * s * 2.6, py * s, pz * s * 1.3, g);
    const gx = g[0] * 2.6, gy = g[1], gz = g[2] * 1.3;
    const gu = gx * ux + gy * uy + gz * uz;
    const gt = Math.sqrt(Math.max(gx * gx + gy * gy + gz * gz - gu * gu, 0.5)) * s;
    const dist = (n < 0 ? -n : n) / gt;
    const w = t.crevWidth;
    if (dist >= w) return 0;
    // only some of the lines crack open
    const open = smoothstep(-0.2, 0.3, this.nD(px * s * 0.5 + 3.3, py * s * 0.5, pz * s * 0.5));
    const q = 1 - dist / w;
    // faded over two chunk levels so the pop is split between them
    return t.crevDepth * q * q * (3 - 2 * q) * open * (1 - smoothstep(w * 0.3, w * 1.2, lod));
  }

  craters(px, py, pz, scale, lod, layer) {
    if (scale < lod * 2) return 0;
    const t = this.t;
    const inv = 1 / scale;
    const gx = px * inv, gy = py * inv, gz = pz * inv;
    const cx = Math.floor(gx), cy = Math.floor(gy), cz = Math.floor(gz);
    const fx = gx - cx, fy = gy - cy, fz = gz - cz;
    // largest crater (r 0.48) reaches 1.6 r from its center
    const RM2 = 0.77 * 0.77;
    let total = 0;
    const seed = this.craterSeed + layer * 7919;
    for (let dz = -1; dz <= 1; dz++) {
      const bz = dz < 0 ? fz * fz : dz > 0 ? (1 - fz) * (1 - fz) : 0;
      if (bz > RM2) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const by = bz + (dy < 0 ? fy * fy : dy > 0 ? (1 - fy) * (1 - fy) : 0);
        if (by > RM2) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (by + (dx < 0 ? fx * fx : dx > 0 ? (1 - fx) * (1 - fx) : 0) > RM2) continue;
          const ix = cx + dx, iy = cy + dy, iz = cz + dz;
          const hsh = hash3(ix, iy, iz, seed);
          if ((hsh & 1023) / 1024 > t.craterDensity) continue;
          const h2 = hashInt(hsh ^ 0x5bd1e995);
          const ox = ix + ((hsh >>> 10) & 255) / 255;
          const oy = iy + ((hsh >>> 18) & 255) / 255;
          const oz = iz + (h2 & 255) / 255;
          const r = 0.18 + 0.3 * (((hsh >>> 26) & 63) / 63);
          const ddx = gx - ox, ddy = gy - oy, ddz = gz - oz;
          const d = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) / r;
          if (d > 1.6) continue;
          const depth = r * scale * t.craterDepth;
          let v = 0;
          if (d < 1) {
            v = Math.max(d * d - 1, -0.75) * depth;
            // the big ones get a central peak
            if (r > 0.36 && d < 0.3) {
              const p = 1 - d / 0.3;
              v += depth * 0.45 * p * p * (3 - 2 * p);
            }
            if (t.craterGlass && d < 0.7) {
              const gl = 1 - smoothstep(0.45, 0.7, d);
              if (gl > this.f) this.f = gl;
            }
          }
          const rim = Math.exp(-((d - 1) * (d - 1)) / 0.04) * depth * 0.3;
          total += v + rim;
          // bright ejecta around some of the fresh ones
          if (t.craterEjecta && layer === 0 && d > 0.85 && ((h2 >>> 8) & 3) === 0) {
            const e = (d - 1.15) / 0.3;
            const ej = Math.exp(-e * e) * t.craterEjecta;
            if (ej > this.f) this.f = ej;
          }
        }
      }
    }
    return total;
  }

  // Upper bound on how far the surface can rise, used for culling
  maxHeight() {
    const t = this.t;
    let hmax = t.contAmp + t.mountAmp + t.hillAmp + t.detailAmp + t.pillarAmp + t.duneAmp;
    if (t.craterDensity > 0) hmax += t.craterScale * 0.12;
    if (t.terraceStep > 0) hmax += t.terraceStep * t.terraceMix;
    if (t.mesaAmp > 0) hmax += t.mesaAmp;
    // two overlapping cones at most in practice
    if (t.volcDensity > 0) hmax += t.volcAmp * 2;
    if (t.blisterDensity > 0) hmax += t.blisterScale * 0.44 * t.blisterAmp * 2;
    if (t.colAmp > 0) hmax += t.colAmp;
    if (t.arcAmp > 0) hmax += t.arcAmp + 3;
    if (t.iceLevel > 0) hmax = Math.max(hmax, t.contAmp + t.iceLevel * 1.5 + t.iceSoft);
    if (t.atollDensity > 0) hmax = Math.max(hmax, t.atollH * 1.4);
    return hmax;
  }

  minHeight() {
    const t = this.t;
    // continents: c can go down to -1.35 + contBias
    let hmin = -(Math.max(1, 1.35 - t.contBias) * t.oceanDepth + t.hillAmp + t.detailAmp);
    if (t.craterDensity > 0) hmin -= t.craterScale * t.craterDepth * 0.36 * 2.5;
    if (t.canyonDepth > 0) hmin -= t.canyonDepth + (t.terraceStep || 0);
    if (t.riverDepth > 0) hmin = Math.min(hmin, -t.riverDepth * 2);
    if (t.crevDepth > 0) hmin -= t.crevDepth;
    if (t.blisterDensity > 0) hmin -= t.poolDepth * 2;
    return hmin;
  }
}

// Cube face mapping. Each face maps (u, v) in -1..1 to a cube point with
// cross(d/du, d/dv) pointing outward, so one index buffer works for all faces.
export function faceToCube(face, u, v, out) {
  switch (face) {
    case 0: out[0] = 1; out[1] = v; out[2] = -u; break;
    case 1: out[0] = -1; out[1] = v; out[2] = u; break;
    case 2: out[0] = u; out[1] = 1; out[2] = -v; break;
    case 3: out[0] = u; out[1] = -1; out[2] = v; break;
    case 4: out[0] = u; out[1] = v; out[2] = 1; break;
    default: out[0] = -u; out[1] = v; out[2] = -1; break;
  }
  return out;
}

// Tangent warp spreads vertices more evenly than a plain normalized cube.
const QPI = Math.PI / 4;
export function faceDir(face, u, v, out) {
  faceToCube(face, Math.tan(u * QPI), Math.tan(v * QPI), out);
  const l = Math.hypot(out[0], out[1], out[2]);
  out[0] /= l;
  out[1] /= l;
  out[2] /= l;
  return out;
}

// Calls fn(face, x, y, dist) for every quadtree cell at `level` whose center is
// within `radius` meters of the unit direction `dir`, measured along the surface.
export function forEachCellNear(R, level, dir, radius, fn) {
  const d = [0, 0, 0];
  const walk = (face, l, x, y) => {
    const size = 2 / (1 << l);
    faceDir(face, -1 + (x + 0.5) * size, -1 + (y + 0.5) * size, d);
    const dist = Math.acos(Math.max(-1, Math.min(1, d[0] * dir.x + d[1] * dir.y + d[2] * dir.z))) * R;
    // a cell's corners reach about 0.75 of its width from the center
    if (dist > radius + ((R * Math.PI) / 2 / (1 << l)) * 0.75) return;
    if (l === level) {
      fn(face, x, y, dist);
      return;
    }
    walk(face, l + 1, x * 2, y * 2);
    walk(face, l + 1, x * 2 + 1, y * 2);
    walk(face, l + 1, x * 2, y * 2 + 1);
    walk(face, l + 1, x * 2 + 1, y * 2 + 1);
  };
  for (let f = 0; f < 6; f++) walk(f, 0, 0, 0);
}
