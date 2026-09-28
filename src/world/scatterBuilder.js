import { faceDir } from '../gen/terrain.js';
import { RNG, hash3 } from '../core/rng.js';

// Places flora and rocks inside one scatter cell (a quadtree node at a fixed
// level). Placement only depends on the cell coords and species seed, so the
// same plants come back every time the cell is regenerated.

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function buildScatter(gen, terrain, msg) {
  const R = terrain.radius;
  const { face, level, x, y, species } = msg;
  const size = 2 / (1 << level);
  const u0 = -1 + x * size;
  const v0 = -1 + y * size;
  const d = [0, 0, 0];
  const d2 = [0, 0, 0];
  const d3 = [0, 0, 0];
  const out = { h: 0, m: 0 };

  faceDir(face, u0 + size / 2, v0 + size / 2, d);
  const hc = gen.sample(d[0], d[1], d[2], out, 1);
  const cx = d[0] * (R + hc), cy = d[1] * (R + hc), cz = d[2] * (R + hc);

  // approximate cell area in m^2, the tangent warp keeps this within ~30%
  const side = R * (Math.PI / 4) * size;
  const area = side * side;
  const eps = size / 400;
  const hasOcean = terrain.hasOcean;

  const results = [];
  const transfer = [];
  for (const sp of species) {
    const rng = new RNG(hash3(face * 131 + level, x, y, sp.seed));
    const expected = sp.density * area;
    let n = Math.floor(expected);
    if (rng.next() < expected - n) n++;
    const buf = new Float32Array(n * 8);
    let count = 0;
    for (let k = 0; k < n; k++) {
      const u = u0 + rng.next() * size;
      const v = v0 + rng.next() * size;
      const r1 = rng.next(), r2 = rng.next(), r3 = rng.next(), r4 = rng.next();
      faceDir(face, u, v, d);
      const h = gen.sample(d[0], d[1], d[2], out, 1);
      if (h < sp.minH || h > sp.maxH) continue;
      if (hasOcean && h < (sp.underwater ? -1e9 : 0.6)) continue;
      const m = out.m;
      if (m < sp.moistMin || m > sp.moistMax) {
        const edge = m < sp.moistMin ? sp.moistMin - m : m - sp.moistMax;
        if (edge > 0.08 || r1 < edge / 0.08) continue;
      }
      if (sp.cluster > 0) {
        const cs = 1 / sp.clusterScale;
        const c = gen.nB(d[0] * R * cs + sp.seed % 97, d[1] * R * cs, d[2] * R * cs) * 0.5 + 0.5;
        if (c < sp.cluster * (0.6 + 0.4 * r2)) continue;
      }

      // surface normal from two nearby samples
      faceDir(face, u + eps, v, d2);
      faceDir(face, u, v + eps, d3);
      const h2 = gen.sample(d2[0], d2[1], d2[2], out, 1);
      const h3 = gen.sample(d3[0], d3[1], d3[2], out, 1);
      const px = d[0] * (R + h), py = d[1] * (R + h), pz = d[2] * (R + h);
      const ax = d2[0] * (R + h2) - px, ay = d2[1] * (R + h2) - py, az = d2[2] * (R + h2) - pz;
      const bx = d3[0] * (R + h3) - px, by = d3[1] * (R + h3) - py, bz = d3[2] * (R + h3) - pz;
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const slope = 1 - (nx * d[0] + ny * d[1] + nz * d[2]);
      if (slope > sp.maxSlope) continue;
      if (sp.minSlope && slope < sp.minSlope) continue;

      const scale = sp.scaleMin + (sp.scaleMax - sp.scaleMin) * r3 * r3;
      const al = sp.align;
      let ux = d[0] + (nx - d[0]) * al, uy = d[1] + (ny - d[1]) * al, uz = d[2] + (nz - d[2]) * al;
      const ul = Math.hypot(ux, uy, uz);
      ux /= ul; uy /= ul; uz /= ul;
      const sink = (sp.sink || 0) * scale + slope * 1.5 * scale * (sp.slopeSink ?? 0.3);
      const lift = sp.lift ? sp.lift * (0.6 + 0.8 * r2) : 0;
      const o = count * 8;
      buf[o] = px - cx + d[0] * (lift - sink);
      buf[o + 1] = py - cy + d[1] * (lift - sink);
      buf[o + 2] = pz - cz + d[2] * (lift - sink);
      buf[o + 3] = ux;
      buf[o + 4] = uy;
      buf[o + 5] = uz;
      buf[o + 6] = scale * (sp.moistScale ? 0.75 + 0.5 * smoothstep(sp.moistMin, sp.moistMax, m) : 1);
      buf[o + 7] = r4 * Math.PI * 2;
      count++;
    }
    const trimmed = buf.slice(0, count * 8);
    results.push({ id: sp.id, count, data: trimmed });
    transfer.push(trimmed.buffer);
  }
  return { center: [cx, cy, cz], species: results, transfer };
}
