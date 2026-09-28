import { RNG } from './rng.js';

// Seeded 3D simplex noise (Gustavson). Returns roughly -1..1.
// Written without allocations since terrain workers call it millions of times.

const F3 = 1 / 3;
const G3 = 1 / 6;

const GRAD = new Float64Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

export function createNoise3D(seed) {
  const rng = new RNG(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permMod12[i] = (perm[i] % 12) * 3;
  }

  return function noise3D(x, y, z) {
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const z0 = z - (k - t);

    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }

    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;

    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0;

    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) {
      const g = permMod12[ii + perm[jj + perm[kk]]];
      t0 *= t0;
      n += t0 * t0 * (GRAD[g] * x0 + GRAD[g + 1] * y0 + GRAD[g + 2] * z0);
    }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) {
      const g = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]];
      t1 *= t1;
      n += t1 * t1 * (GRAD[g] * x1 + GRAD[g + 1] * y1 + GRAD[g + 2] * z1);
    }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) {
      const g = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]];
      t2 *= t2;
      n += t2 * t2 * (GRAD[g] * x2 + GRAD[g + 1] * y2 + GRAD[g + 2] * z2);
    }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) {
      const g = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]];
      t3 *= t3;
      n += t3 * t3 * (GRAD[g] * x3 + GRAD[g + 1] * y3 + GRAD[g + 2] * z3);
    }
    return 32 * n;
  };
}

// Same noise as createNoise3D(seed) that also writes its gradient to g[0..2].
// Terrain uses the gradient for slope based erosion and for distance to the
// zero line of a field (rivers, cracks) without extra samples.
export function createNoise3DGrad(seed) {
  const rng = new RNG(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permMod12[i] = (perm[i] % 12) * 3;
  }

  return function noise3DGrad(x, y, z, g) {
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const z0 = z - (k - t);

    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }

    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;

    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0, dx = 0, dy = 0, dz = 0;

    // per corner t^4 * dot(grad, d), derivative t^4 * grad - 8 t^3 dot(grad, d) d
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) {
      const gi = permMod12[ii + perm[jj + perm[kk]]];
      const gx = GRAD[gi], gy = GRAD[gi + 1], gz = GRAD[gi + 2];
      const dot = gx * x0 + gy * y0 + gz * z0;
      const t2 = t0 * t0, t4 = t2 * t2, q = 8 * t2 * t0 * dot;
      n += t4 * dot;
      dx += t4 * gx - q * x0; dy += t4 * gy - q * y0; dz += t4 * gz - q * z0;
    }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) {
      const gi = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]];
      const gx = GRAD[gi], gy = GRAD[gi + 1], gz = GRAD[gi + 2];
      const dot = gx * x1 + gy * y1 + gz * z1;
      const t2 = t1 * t1, t4 = t2 * t2, q = 8 * t2 * t1 * dot;
      n += t4 * dot;
      dx += t4 * gx - q * x1; dy += t4 * gy - q * y1; dz += t4 * gz - q * z1;
    }
    let t2_ = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2_ > 0) {
      const gi = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]];
      const gx = GRAD[gi], gy = GRAD[gi + 1], gz = GRAD[gi + 2];
      const dot = gx * x2 + gy * y2 + gz * z2;
      const t2 = t2_ * t2_, t4 = t2 * t2, q = 8 * t2 * t2_ * dot;
      n += t4 * dot;
      dx += t4 * gx - q * x2; dy += t4 * gy - q * y2; dz += t4 * gz - q * z2;
    }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) {
      const gi = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]];
      const gx = GRAD[gi], gy = GRAD[gi + 1], gz = GRAD[gi + 2];
      const dot = gx * x3 + gy * y3 + gz * z3;
      const t2 = t3 * t3, t4 = t2 * t2, q = 8 * t2 * t3 * dot;
      n += t4 * dot;
      dx += t4 * gx - q * x3; dy += t4 * gy - q * y3; dz += t4 * gz - q * z3;
    }
    g[0] = 32 * dx;
    g[1] = 32 * dy;
    g[2] = 32 * dz;
    return 32 * n;
  };
}

// fBm that drops octaves finer than minWave (in the same units as 1/freq).
// Used for LOD prefiltering so coarse chunks don't alias.
export function fbm(noise, x, y, z, octaves, minWave = 0, lac = 2.0, gain = 0.5) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const wave = 1 / freq;
    if (wave < minWave) break;
    // fade the last octave in instead of popping it
    const w = minWave > 0 ? Math.min(1, (wave / minWave - 1) * 1.5) : 1;
    sum += noise(x * freq, y * freq, z * freq) * amp * w;
    norm += amp;
    amp *= gain;
    freq *= lac;
  }
  return norm > 0 ? sum / norm : 0;
}

// Ridged multifractal, 0..1. Good for mountain chains.
export function ridged(noise, x, y, z, octaves, minWave = 0, lac = 2.0, gain = 0.5) {
  let sum = 0, amp = 1, freq = 1, norm = 0, prev = 1;
  for (let o = 0; o < octaves; o++) {
    const wave = 1 / freq;
    if (wave < minWave) break;
    const w = minWave > 0 ? Math.min(1, (wave / minWave - 1) * 1.5) : 1;
    let n = 1 - Math.abs(noise(x * freq + o * 17.1, y * freq, z * freq));
    n *= n;
    sum += n * amp * prev * w;
    norm += amp;
    prev = Math.min(1, n * 1.8);
    amp *= gain;
    freq *= lac;
  }
  return norm > 0 ? sum / norm : 0;
}
