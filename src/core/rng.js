// Deterministic helpers. Everything procedural in the game is derived from
// integer seeds through these so a galaxy seed always rebuilds the same universe.

export function hashInt(x) {
  x = x | 0;
  x = Math.imul((x >>> 16) ^ x, 0x45d9f3b);
  x = Math.imul((x >>> 16) ^ x, 0x45d9f3b);
  x = (x >>> 16) ^ x;
  return x >>> 0;
}

export function hashCombine(a, b) {
  return hashInt((a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b)) | 0);
}

export function hash3(x, y, z, seed = 0) {
  let h = hashInt(seed ^ Math.imul(x | 0, 0x8da6b343));
  h = hashInt(h ^ Math.imul(y | 0, 0xd8163841));
  h = hashInt(h ^ Math.imul(z | 0, 0xcb1ab31f));
  return h;
}

export class RNG {
  constructor(seed = 1) {
    this.s = (seed >>> 0) || 0x1234567;
  }

  next() {
    // mulberry32
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a, b) {
    return a + (b - a) * this.next();
  }

  int(a, b) {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  chance(p) {
    return this.next() < p;
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  weighted(entries) {
    // entries: [[value, weight], ...]
    let total = 0;
    for (const e of entries) total += e[1];
    let r = this.next() * total;
    for (const e of entries) {
      r -= e[1];
      if (r <= 0) return e[0];
    }
    return entries[entries.length - 1][0];
  }

  gauss() {
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  seed() {
    return Math.floor(this.next() * 4294967296) >>> 0;
  }
}
