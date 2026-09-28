import { faceDir } from '../gen/terrain.js';

export const CHUNK_N = 33;

// Perimeter of the N x N grid in counter clockwise order when viewed from
// outside the planet. Skirt vertex k hangs below perimeter[k].
export function perimeterIndices(N) {
  const p = [];
  for (let i = 0; i < N - 1; i++) p.push(i);
  for (let j = 0; j < N - 1; j++) p.push(j * N + N - 1);
  for (let i = N - 1; i > 0; i--) p.push((N - 1) * N + i);
  for (let j = N - 1; j > 0; j--) p.push(j * N);
  return p;
}

export function buildChunkIndex(N) {
  const per = perimeterIndices(N);
  const P = per.length;
  const tris = (N - 1) * (N - 1) * 2 + P * 2;
  const idx = new Uint16Array(tris * 3);
  let k = 0;
  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < N - 1; i++) {
      const a = j * N + i;
      const b = a + 1;
      const c = a + N;
      const d = c + 1;
      // alternate the diagonal so slopes don't all shade in one direction
      if ((i + j) & 1) {
        idx[k++] = a; idx[k++] = b; idx[k++] = d;
        idx[k++] = a; idx[k++] = d; idx[k++] = c;
      } else {
        idx[k++] = a; idx[k++] = b; idx[k++] = c;
        idx[k++] = b; idx[k++] = d; idx[k++] = c;
      }
    }
  }
  const base = N * N;
  for (let s = 0; s < P; s++) {
    const a = per[s];
    const b = per[(s + 1) % P];
    const a2 = base + s;
    const b2 = base + ((s + 1) % P);
    idx[k++] = a; idx[k++] = a2; idx[k++] = b;
    idx[k++] = b; idx[k++] = a2; idx[k++] = b2;
  }
  return idx;
}

// Builds one quadtree chunk. Positions are relative to the chunk center so
// float32 precision stays good on the GPU.
export function buildChunk(gen, R, face, level, x, y, N) {
  const size = 2 / (1 << level);
  const u0 = -1 + x * size;
  const v0 = -1 + y * size;
  const step = size / (N - 1);
  const spacing = R * (Math.PI / 4) * step;
  const lod = spacing * 1.6;

  const G = N + 2;
  const gp = new Float64Array(G * G * 3);
  const gh = new Float32Array(G * G);
  const gm = new Float32Array(G * G);
  const d = [0, 0, 0];
  const out = { h: 0, m: 0 };

  for (let j = 0; j < G; j++) {
    const v = v0 + (j - 1) * step;
    for (let i = 0; i < G; i++) {
      const u = u0 + (i - 1) * step;
      faceDir(face, u, v, d);
      gen.sample(d[0], d[1], d[2], out, lod);
      const r = R + out.h;
      const o = (j * G + i) * 3;
      gp[o] = d[0] * r;
      gp[o + 1] = d[1] * r;
      gp[o + 2] = d[2] * r;
      gh[j * G + i] = out.h;
      gm[j * G + i] = out.m;
    }
  }

  const per = perimeterIndices(N);
  const V = N * N + per.length;
  const positions = new Float32Array(V * 3);
  const normals = new Float32Array(V * 3);
  const data = new Float32Array(V * 2);

  const mid = ((N >> 1) + 1) * G + (N >> 1) + 1;
  const cx = gp[mid * 3], cy = gp[mid * 3 + 1], cz = gp[mid * 3 + 2];

  let minH = Infinity, maxH = -Infinity, rad2 = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const g = (j + 1) * G + (i + 1);
      const o = (j * N + i) * 3;
      const px = gp[g * 3] - cx, py = gp[g * 3 + 1] - cy, pz = gp[g * 3 + 2] - cz;
      positions[o] = px;
      positions[o + 1] = py;
      positions[o + 2] = pz;
      const r2 = px * px + py * py + pz * pz;
      if (r2 > rad2) rad2 = r2;

      const l = (g - 1) * 3, rr = (g + 1) * 3, dn = (g - G) * 3, up = (g + G) * 3;
      const ax = gp[rr] - gp[l], ay = gp[rr + 1] - gp[l + 1], az = gp[rr + 2] - gp[l + 2];
      const bx = gp[up] - gp[dn], by = gp[up + 1] - gp[dn + 1], bz = gp[up + 2] - gp[dn + 2];
      let nx = ay * bz - az * by;
      let ny = az * bx - ax * bz;
      let nz = ax * by - ay * bx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      normals[o] = nx / nl;
      normals[o + 1] = ny / nl;
      normals[o + 2] = nz / nl;

      const h = gh[g];
      data[(j * N + i) * 2] = h;
      data[(j * N + i) * 2 + 1] = gm[g];
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }

  const chunkMeters = spacing * (N - 1);
  const skirt = Math.max(1.5, chunkMeters * 0.04);
  const base = N * N;
  for (let s = 0; s < per.length; s++) {
    const src = per[s];
    const o = (base + s) * 3;
    const so = src * 3;
    // push the skirt vertex toward the planet center
    const wx = positions[so] + cx, wy = positions[so + 1] + cy, wz = positions[so + 2] + cz;
    const wl = Math.hypot(wx, wy, wz);
    positions[o] = positions[so] - (wx / wl) * skirt;
    positions[o + 1] = positions[so + 1] - (wy / wl) * skirt;
    positions[o + 2] = positions[so + 2] - (wz / wl) * skirt;
    normals[o] = normals[so];
    normals[o + 1] = normals[so + 1];
    normals[o + 2] = normals[so + 2];
    data[(base + s) * 2] = data[src * 2];
    data[(base + s) * 2 + 1] = data[src * 2 + 1];
  }

  return {
    positions,
    normals,
    data,
    center: [cx, cy, cz],
    radius: Math.sqrt(rad2) + skirt,
    minH,
    maxH,
  };
}
