// JS port of the Ashima simplex noise in render/shaders/noise.glsl.js. Same
// math step for step, so a pattern placed on the CPU (cloud puffs) lines up
// with the same pattern drawn in a shader (far clouds, cloud shadows).
// createNoise3D in noise.js is a different, seeded noise and won't match.

// The floor() calls land exactly on integers a lot, so the constants and the
// products feeding them are rounded to float32 like the GPU does. Plain
// doubles end up just below the integer and pick a different gradient.
const f32 = Math.fround;
const INV289 = f32(1 / 289);
const mod289 = (x) => x - Math.floor(f32(x * INV289)) * 289;
const permute = (x) => mod289((x * 34 + 10) * x);
const C0 = 1 / 6;
const C1 = 1 / 3;
const NS_Z = f32(0.142857142857);
const NS_X = f32(NS_Z * 2);
const NS_Y = f32(f32(NS_Z * 0.5) - 1);

const cx = [0, 0, 0, 0];
const cy = [0, 0, 0, 0];
const cz = [0, 0, 0, 0];
const oi = [0, 0, 0, 0];
const oj = [0, 0, 0, 0];
const ok = [0, 0, 0, 0];

export function snoise(vx, vy, vz) {
  const s = (vx + vy + vz) * C1;
  let ix = Math.floor(vx + s);
  let iy = Math.floor(vy + s);
  let iz = Math.floor(vz + s);
  const t = (ix + iy + iz) * C0;
  const x0 = vx - ix + t, y0 = vy - iy + t, z0 = vz - iz + t;

  const gx = x0 >= y0 ? 1 : 0, gy = y0 >= z0 ? 1 : 0, gz = z0 >= x0 ? 1 : 0;
  const lx = 1 - gx, ly = 1 - gy, lz = 1 - gz;
  const i1x = Math.min(gx, lz), i1y = Math.min(gy, lx), i1z = Math.min(gz, ly);
  const i2x = Math.max(gx, lz), i2y = Math.max(gy, lx), i2z = Math.max(gz, ly);

  cx[0] = x0; cy[0] = y0; cz[0] = z0;
  cx[1] = x0 - i1x + C0; cy[1] = y0 - i1y + C0; cz[1] = z0 - i1z + C0;
  cx[2] = x0 - i2x + C1; cy[2] = y0 - i2y + C1; cz[2] = z0 - i2z + C1;
  cx[3] = x0 - 0.5; cy[3] = y0 - 0.5; cz[3] = z0 - 0.5;
  oi[0] = 0; oi[1] = i1x; oi[2] = i2x; oi[3] = 1;
  oj[0] = 0; oj[1] = i1y; oj[2] = i2y; oj[3] = 1;
  ok[0] = 0; ok[1] = i1z; ok[2] = i2z; ok[3] = 1;

  ix = mod289(ix);
  iy = mod289(iy);
  iz = mod289(iz);

  let sum = 0;
  for (let k = 0; k < 4; k++) {
    const p = permute(permute(permute(iz + ok[k]) + iy + oj[k]) + ix + oi[k]);
    const j = p - 49 * Math.floor(f32(f32(p * NS_Z) * NS_Z));
    const x_ = Math.floor(f32(j * NS_Z));
    const y_ = Math.floor(j - 7 * x_);
    const x = f32(f32(x_ * NS_X) + NS_Y);
    const y = f32(f32(y_ * NS_X) + NS_Y);
    const h = f32(f32(1 - Math.abs(x)) - Math.abs(y));
    const sh = h <= 0 ? -1 : 0;
    const gxk = x + (Math.floor(x) * 2 + 1) * sh;
    const gyk = y + (Math.floor(y) * 2 + 1) * sh;
    const norm = 1.79284291400159 - 0.85373472095314 * (gxk * gxk + gyk * gyk + h * h);
    let m = 0.5 - (cx[k] * cx[k] + cy[k] * cy[k] + cz[k] * cz[k]);
    if (m <= 0) continue;
    m *= m;
    sum += m * m * norm * (gxk * cx[k] + gyk * cy[k] + h * cz[k]);
  }
  return 105 * sum;
}
