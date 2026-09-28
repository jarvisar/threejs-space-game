import { createNoise3D, fbm, ridged } from '../core/noise.js';
import { hash3 } from '../core/rng.js';

// Planet height function. Shared by the chunk workers and the main thread
// (collision, scatter placement) so both always agree on where the ground is.
// Heights are in meters relative to the planet's base radius (sea level).

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class TerrainGenerator {
  constructor(t) {
    this.t = t;
    this.R = t.radius;
    this.nA = createNoise3D(t.seed);
    this.nB = createNoise3D(t.seed + 101);
    this.nC = createNoise3D(t.seed + 202);
    this.nD = createNoise3D(t.seed + 303);
    this.nW = createNoise3D(t.seed + 404);
    this.craterSeed = (t.seed * 7 + 13) | 0;
  }

  // Samples the unit direction (x, y, z). out receives { h, m }.
  // lod is the smallest wavelength in meters worth evaluating.
  sample(x, y, z, out, lod = 0) {
    const t = this.t;
    const R = this.R;
    let px = x * R, py = y * R, pz = z * R;

    if (t.warpAmp > 0) {
      const s = 1 / t.warpScale;
      const lw = lod / t.warpScale;
      const wx = fbm(this.nW, px * s, py * s, pz * s, 2, lw);
      const wy = fbm(this.nW, px * s + 19.1, py * s + 7.3, pz * s - 11.7, 2, lw);
      const wz = fbm(this.nW, px * s - 5.3, py * s + 23.9, pz * s + 3.1, 2, lw);
      px += wx * t.warpAmp;
      py += wy * t.warpAmp;
      pz += wz * t.warpAmp;
    }

    // continents
    const cs = 1 / t.contScale;
    const c = fbm(this.nA, px * cs, py * cs, pz * cs, 6, lod * cs) * 1.35 + t.contBias;
    let h;
    if (c > 0) h = (1 - Math.exp(-c * 3.5)) * t.contAmp;
    else h = c * t.oceanDepth;
    const land = smoothstep(-0.04, 0.2, c);

    // mountains, grouped into ranges by a low frequency region mask
    if (t.mountAmp > 0) {
      const rs = 1 / (t.contScale * 0.6);
      const region = fbm(this.nB, px * rs + 3.3, py * rs, pz * rs, 3, lod * rs) * 0.5 + 0.5;
      const cov = t.mountCoverage;
      const mask = smoothstep(0.75 - cov, 1.0 - cov * 0.8, region + c * 0.35) * (0.25 + 0.75 * land);
      if (mask > 0.001) {
        const ms = 1 / t.mountScale;
        const r = ridged(this.nA, px * ms, py * ms, pz * ms, 8, lod * ms);
        h += Math.pow(r, t.mountSharp) * t.mountAmp * mask;
      }
    }

    // rolling hills
    const hs = 1 / t.hillScale;
    h += fbm(this.nB, px * hs, py * hs, pz * hs, 5, lod * hs) * t.hillAmp * (0.35 + 0.65 * land);

    // plateaus and mesas
    if (t.terraceStep > 0 && h > 0) {
      const tt = h / t.terraceStep;
      const fl = Math.floor(tt);
      const f = tt - fl;
      const stepped = (fl + smoothstep(0.55, 0.8, f)) * t.terraceStep;
      h += (stepped - h) * t.terraceMix;
    }

    if (t.duneAmp > 0) {
      const ds = 1 / t.duneScale;
      if (t.duneScale > lod * 0.7) {
        const n = 1 - Math.abs(this.nC(px * ds * 0.3, py * ds, pz * ds * 0.85 + this.nB(px * ds * 0.1, py * ds * 0.1, pz * ds * 0.1) * 2.0));
        const dm = smoothstep(0.1, 0.5, fbm(this.nD, px * cs * 2, py * cs * 2, pz * cs * 2, 2));
        h += n * n * t.duneAmp * dm * land;
      }
    }

    if (t.pillarAmp > 0 && t.pillarScale > lod * 0.8) {
      const ps = 1 / t.pillarScale;
      const v = this.nD(px * ps, py * ps, pz * ps);
      const m = smoothstep(t.pillarThreshold, t.pillarThreshold + 0.05, v);
      if (m > 0) {
        const cap = 0.75 + 0.25 * this.nC(px * ps * 3, py * ps * 3, pz * ps * 3);
        h += m * t.pillarAmp * cap * land;
      }
    }

    if (t.craterDensity > 0) {
      h += this.craters(px, py, pz, t.craterScale, lod, 0);
      h += this.craters(px, py, pz, t.craterScale * 0.3, lod, 1) * 0.8;
    }

    // small detail
    const ds2 = 1 / t.detailScale;
    h += fbm(this.nC, px * ds2, py * ds2, pz * ds2, 4, lod * ds2) * t.detailAmp;

    // flatten around sea level for beaches
    if (t.beachWidth > 0) {
      const b = t.beachWidth;
      h = (h * h * h) / (h * h + b * b);
    }

    const ms2 = 1 / t.moistScale;
    let m = fbm(this.nD, px * ms2 + 7.7, py * ms2, pz * ms2, 3) * 0.75 + 0.5;
    m = m < 0 ? 0 : m > 1 ? 1 : m;

    out.h = h;
    out.m = m;
    return h;
  }

  height(x, y, z, lod = 0) {
    return this.sample(x, y, z, this._tmp || (this._tmp = { h: 0, m: 0 }), lod);
  }

  craters(px, py, pz, scale, lod, layer) {
    if (scale < lod * 2) return 0;
    const t = this.t;
    const inv = 1 / scale;
    const gx = px * inv, gy = py * inv, gz = pz * inv;
    const cx = Math.floor(gx), cy = Math.floor(gy), cz = Math.floor(gz);
    let total = 0;
    const seed = this.craterSeed + layer * 7919;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ix = cx + dx, iy = cy + dy, iz = cz + dz;
          const hsh = hash3(ix, iy, iz, seed);
          if ((hsh & 1023) / 1024 > t.craterDensity) continue;
          const fx = ix + ((hsh >>> 10) & 255) / 255;
          const fy = iy + ((hsh >>> 18) & 255) / 255;
          const fz = iz + (hash3(iz, ix, iy, seed + 1) & 255) / 255;
          const r = 0.18 + 0.3 * (((hsh >>> 26) & 63) / 63);
          const ddx = gx - fx, ddy = gy - fy, ddz = gz - fz;
          const d = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) / r;
          if (d > 1.6) continue;
          const depth = r * scale * t.craterDepth;
          let v;
          if (d < 1) v = Math.max(d * d - 1, -0.75) * depth;
          else v = 0;
          const rim = Math.exp(-((d - 1) * (d - 1)) / 0.04) * depth * 0.3;
          total += v + rim;
        }
      }
    }
    return total;
  }

  // Rough upper bound on how far the surface can rise, used for culling.
  maxHeight() {
    const t = this.t;
    return t.contAmp + t.mountAmp + t.hillAmp + t.detailAmp + t.pillarAmp + t.duneAmp + (t.craterDensity > 0 ? t.craterScale * 0.1 : 0);
  }

  minHeight() {
    const t = this.t;
    return -(t.oceanDepth + t.hillAmp + t.detailAmp + (t.craterDensity > 0 ? t.craterScale * 0.3 * t.craterDepth : 0));
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

// Inverse of faceDir. Returns face index and fills uv (-1..1).
export function dirToFace(x, y, z, uv) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let face, cu, cv;
  if (ax >= ay && ax >= az) {
    if (x > 0) { face = 0; cu = -z / ax; cv = y / ax; }
    else { face = 1; cu = z / ax; cv = y / ax; }
  } else if (ay >= az) {
    if (y > 0) { face = 2; cu = x / ay; cv = -z / ay; }
    else { face = 3; cu = x / ay; cv = z / ay; }
  } else {
    if (z > 0) { face = 4; cu = x / az; cv = y / az; }
    else { face = 5; cu = -x / az; cv = y / az; }
  }
  uv[0] = Math.atan(cu) / QPI;
  uv[1] = Math.atan(cv) / QPI;
  return face;
}
