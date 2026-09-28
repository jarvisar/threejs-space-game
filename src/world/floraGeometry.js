import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG } from '../core/rng.js';
import { createNoise3D } from '../core/noise.js';

// Procedural meshes for flora and rocks. Everything is merged into one
// non-indexed geometry per species with vertex colors, aGlow (emissive at
// night) and aSway (how much wind moves the vertex).

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

class Parts {
  constructor() {
    this.list = [];
  }

  add(geo, color, opts = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv');
    if (opts.matrix) g.applyMatrix4(opts.matrix);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    const c2 = opts.color2 ? new THREE.Color(opts.color2) : null;
    const pos = g.attributes.position.array;
    let y0 = Infinity, y1 = -Infinity;
    if (c2) for (let i = 0; i < n; i++) { y0 = Math.min(y0, pos[i * 3 + 1]); y1 = Math.max(y1, pos[i * 3 + 1]); }
    for (let i = 0; i < n; i++) {
      let r = c.r, gg = c.g, b = c.b;
      if (c2) {
        const t = (pos[i * 3 + 1] - y0) / Math.max(1e-4, y1 - y0);
        r = c.r + (c2.r - c.r) * t;
        gg = c.g + (c2.g - c.g) * t;
        b = c.b + (c2.b - c.b) * t;
      }
      col[i * 3] = r;
      col[i * 3 + 1] = gg;
      col[i * 3 + 2] = b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(opts.glow || 0), 1));
    g.setAttribute('aSwayMul', new THREE.BufferAttribute(new Float32Array(n).fill(opts.sway ?? 1), 1));
    this.list.push(g);
    return g;
  }

  build(swayHeight) {
    const g = mergeGeometries(this.list, false);
    const pos = g.attributes.position.array;
    const mul = g.attributes.aSwayMul.array;
    const n = g.attributes.position.count;
    let maxY = 0.01;
    for (let i = 0; i < n; i++) maxY = Math.max(maxY, pos[i * 3 + 1]);
    const h = swayHeight || maxY;
    const sway = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = Math.max(0, pos[i * 3 + 1] / h);
      sway[i] = Math.min(1.5, t * t) * mul[i];
    }
    g.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
    g.deleteAttribute('aSwayMul');
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

function mat(pos, rot, scale) {
  _q.setFromEuler(rot || new THREE.Euler());
  _s.set(scale ? scale.x ?? scale : 1, scale ? scale.y ?? scale : 1, scale ? scale.z ?? scale : 1);
  return new THREE.Matrix4().compose(pos || new THREE.Vector3(), _q, _s);
}

function jitter(rng, hex, amt = 0.08) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL((hsl.h + rng.range(-amt, amt) * 0.3 + 1) % 1, Math.min(1, hsl.s * rng.range(0.9, 1.15)), Math.min(1, hsl.l * rng.range(1 - amt, 1 + amt)));
  return c;
}

// displaced icosphere, used for rocks and canopy blobs
function lumpy(rng, radius, detail, amount, stretch) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const noise = createNoise3D(rng.seed());
  const p = g.attributes.position;
  const f = rng.range(0.8, 1.6) / radius;
  for (let i = 0; i < p.count; i++) {
    _p.fromBufferAttribute(p, i);
    const n = noise(_p.x * f, _p.y * f, _p.z * f) * amount + noise(_p.x * f * 2.5, _p.y * f * 2.5, _p.z * f * 2.5) * amount * 0.4;
    _p.multiplyScalar(1 + n);
    if (stretch) _p.multiply(stretch);
    p.setXYZ(i, _p.x, _p.y, _p.z);
  }
  g.computeVertexNormals();
  return g;
}

// tapered, slightly bent trunk
function trunk(rng, h, r0, r1, bend, segs = 6) {
  const g = new THREE.CylinderGeometry(r1, r0, h, segs, 5, false);
  g.translate(0, h / 2, 0);
  const p = g.attributes.position;
  const dir = rng.range(0, Math.PI * 2);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = y / h;
    const off = bend * t * t;
    p.setX(i, p.getX(i) + Math.cos(dir) * off);
    p.setZ(i, p.getZ(i) + Math.sin(dir) * off);
  }
  g.computeVertexNormals();
  return { geo: g, top: new THREE.Vector3(Math.cos(dir) * bend, h, Math.sin(dir) * bend) };
}

function tube(points, radius, segs = 6, tubular = 10, taper = 0.4) {
  const curve = new THREE.CatmullRomCurve3(points);
  const g = new THREE.TubeGeometry(curve, tubular, radius, segs, false);
  // taper toward the end
  const p = g.attributes.position;
  const ringSize = segs + 1;
  for (let i = 0; i < p.count; i++) {
    const ring = Math.floor(i / ringSize);
    const t = ring / tubular;
    const c = curve.getPointAt(Math.min(1, t));
    _p.fromBufferAttribute(p, i).sub(c).multiplyScalar(1 - t * (1 - taper)).add(c);
    p.setXYZ(i, _p.x, _p.y, _p.z);
  }
  g.computeVertexNormals();
  return g;
}

function prism(radius, height, sides = 6) {
  const body = new THREE.CylinderGeometry(radius, radius, height, sides, 1);
  body.translate(0, height / 2, 0);
  const tip = new THREE.ConeGeometry(radius, radius * 1.8, sides, 1);
  tip.translate(0, height + radius * 0.9, 0);
  return mergeGeometries([body.toNonIndexed(), tip.toNonIndexed()]);
}

const BUILDERS = {
  tree(rng, sp, P) {
    const leaf = sp.palette.leaf;
    const h = rng.range(4, 7.5);
    const t = trunk(rng, h, rng.range(0.22, 0.38), rng.range(0.1, 0.18), rng.range(0.2, 1.0));
    P.add(t.geo, jitter(rng, sp.palette.trunk), { sway: 0.4 });
    const style = sp.style;
    if (style === 1) {
      const layers = rng.int(3, 5);
      for (let i = 0; i < layers; i++) {
        const r = rng.range(1.6, 2.4) * (1 - i / (layers + 1));
        const cone = new THREE.ConeGeometry(r, r * 1.3, 8, 1);
        P.add(cone, jitter(rng, leaf[i % leaf.length]), { matrix: mat(t.top.clone().add(new THREE.Vector3(0, -1.4 + i * 1.0, 0))) });
      }
    } else if (style === 2) {
      const r = rng.range(2.6, 3.8);
      const top = lumpy(rng, r, 1, 0.12, new THREE.Vector3(1, 0.32, 1));
      P.add(top, jitter(rng, leaf[0]), { matrix: mat(t.top.clone().add(new THREE.Vector3(0, 0.3, 0))), color2: jitter(rng, leaf[1]) });
    } else if (style === 3) {
      const r = rng.range(1.8, 2.6);
      P.add(lumpy(rng, r, 1, 0.18, new THREE.Vector3(1, 0.8, 1)), jitter(rng, leaf[0]), { matrix: mat(t.top) });
      const strands = rng.int(6, 10);
      for (let i = 0; i < strands; i++) {
        const a = (i / strands) * Math.PI * 2 + rng.range(-0.2, 0.2);
        const len = rng.range(1.5, 3.2);
        const base = t.top.clone().add(new THREE.Vector3(Math.cos(a) * r * 0.85, -0.2, Math.sin(a) * r * 0.85));
        const strand = new THREE.CylinderGeometry(0.05, 0.08, len, 4, 1);
        strand.translate(0, -len / 2, 0);
        P.add(strand, jitter(rng, leaf[1]), { matrix: mat(base), glow: sp.glow > 0.5 ? 0.6 : 0 });
        if (sp.glow > 0.5) P.add(new THREE.IcosahedronGeometry(0.14, 0), sp.palette.glow, { matrix: mat(base.clone().add(new THREE.Vector3(0, -len, 0))), glow: 2 });
      }
    } else {
      const blobs = rng.int(3, 5);
      for (let i = 0; i < blobs; i++) {
        const r = rng.range(1.1, 1.9);
        const off = new THREE.Vector3(rng.range(-1.2, 1.2), rng.range(-0.6, 1.0), rng.range(-1.2, 1.2));
        P.add(lumpy(rng, r, 1, 0.15), jitter(rng, leaf[i % leaf.length]), { matrix: mat(t.top.clone().add(off)) });
      }
      if (sp.glow > 0.5) {
        for (let i = 0; i < 6; i++) {
          const off = new THREE.Vector3(rng.range(-2, 2), rng.range(-1.2, 1.2), rng.range(-2, 2));
          P.add(new THREE.IcosahedronGeometry(0.18, 0), sp.palette.glow, { matrix: mat(t.top.clone().add(off)), glow: 2 });
        }
      }
    }
    return 8;
  },

  palm(rng, sp, P) {
    const h = rng.range(5, 8);
    const bend = rng.range(0.8, 2.2);
    const pts = [];
    const dir = rng.range(0, Math.PI * 2);
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      pts.push(new THREE.Vector3(Math.cos(dir) * bend * t * t, h * t, Math.sin(dir) * bend * t * t));
    }
    P.add(tube(pts, 0.22, 6, 8, 0.6), jitter(rng, sp.palette.trunk), { sway: 0.5 });
    const top = pts[4];
    const fronds = rng.int(6, 9);
    for (let i = 0; i < fronds; i++) {
      const a = (i / fronds) * Math.PI * 2 + rng.range(-0.2, 0.2);
      const len = rng.range(2.4, 3.6);
      const fp = [top.clone()];
      for (let k = 1; k <= 3; k++) {
        const t = k / 3;
        fp.push(top.clone().add(new THREE.Vector3(Math.cos(a) * len * t, 0.6 * t - 1.8 * t * t, Math.sin(a) * len * t)));
      }
      const frond = tube(fp, 0.28, 3, 6, 0.1);
      frond.scale(1, 0.35, 1);
      frond.translate(0, top.y * 0.65, 0);
      P.add(frond, jitter(rng, sp.palette.leaf[i % 3]), { sway: 1.2 });
    }
    return h;
  },

  icetree(rng, sp, P) {
    const h = rng.range(3.5, 6.5);
    P.add(prism(0.22, h, 6), jitter(rng, sp.palette.trunk), { sway: 0.2 });
    const branches = rng.int(4, 8);
    for (let i = 0; i < branches; i++) {
      const y = rng.range(h * 0.35, h * 0.9);
      const len = rng.range(0.8, 2.0) * (1.1 - y / h);
      const g = prism(0.1, len, 5);
      const a = rng.range(0, Math.PI * 2);
      P.add(g, jitter(rng, sp.palette.leaf[i % 3]), { matrix: mat(new THREE.Vector3(0, y, 0), new THREE.Euler(Math.cos(a) * 0.9, 0, Math.sin(a) * 0.9)), glow: 0.25 });
    }
    P.add(prism(0.3, 0.9, 6), jitter(rng, sp.palette.leaf[0]), { matrix: mat(new THREE.Vector3(0, h, 0)), glow: 0.5 });
    return h;
  },

  deadtree(rng, sp, P) {
    const h = rng.range(3, 6);
    const t = trunk(rng, h, rng.range(0.18, 0.3), 0.06, rng.range(0.2, 0.8), 5);
    const col = jitter(rng, sp.palette.trunk, 0.05).multiplyScalar(0.7);
    P.add(t.geo, col, { sway: 0.2 });
    const n = rng.int(3, 6);
    for (let i = 0; i < n; i++) {
      const y = rng.range(h * 0.4, h * 0.95);
      const a = rng.range(0, Math.PI * 2);
      const len = rng.range(0.8, 2.2);
      const start = new THREE.Vector3(t.top.x * (y / h) * (y / h), y, t.top.z * (y / h) * (y / h));
      const end = start.clone().add(new THREE.Vector3(Math.cos(a) * len, rng.range(0.3, 1.2), Math.sin(a) * len));
      const mid = start.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 0.2, 0));
      P.add(tube([start, mid, end], 0.07, 4, 4, 0.3), col, { sway: 0.4 });
    }
    return h;
  },

  twisttree(rng, sp, P) {
    const h = rng.range(3.5, 6.5);
    const pts = [];
    const turns = rng.range(0.6, 1.4);
    const rad = rng.range(0.3, 0.9);
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const a = t * turns * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * rad * t, h * t, Math.sin(a) * rad * t));
    }
    P.add(tube(pts, 0.2, 6, 14, 0.4), jitter(rng, sp.palette.trunk), { sway: 0.5 });
    const top = pts[8];
    for (let i = 0; i < 4; i++) {
      const off = new THREE.Vector3(rng.range(-1, 1), rng.range(-0.3, 0.8), rng.range(-1, 1));
      P.add(lumpy(rng, rng.range(0.6, 1.1), 0, 0.2), jitter(rng, sp.palette.leaf[i % 3]), { matrix: mat(top.clone().add(off)), glow: sp.glow > 0.5 ? 0.35 : 0 });
    }
    return h;
  },

  spiraltree(rng, sp, P) {
    const h = rng.range(4, 8);
    P.add(trunk(rng, h, 0.14, 0.06, rng.range(0, 0.5), 5).geo, jitter(rng, sp.palette.trunk), { sway: 0.5 });
    const n = rng.int(7, 12);
    const turns = rng.range(1.2, 2.2);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const a = t * turns * Math.PI * 2;
      const r = (1 - t) * rng.range(1.2, 1.8) + 0.3;
      const disc = new THREE.CylinderGeometry(r * 0.55, r * 0.6, 0.12, 10);
      const pos = new THREE.Vector3(Math.cos(a) * 0.25, h * (0.3 + 0.7 * t), Math.sin(a) * 0.25);
      P.add(disc, jitter(rng, sp.palette.leaf[i % 3]), { matrix: mat(pos, new THREE.Euler(rng.range(-0.2, 0.2), a, rng.range(-0.2, 0.2))), glow: sp.glow > 0.5 && i % 3 === 0 ? 0.8 : 0 });
    }
    return h;
  },

  bulbtree(rng, sp, P) {
    const h = rng.range(3.5, 6);
    const t = trunk(rng, h, 0.16, 0.09, rng.range(0.4, 1.4), 5);
    P.add(t.geo, jitter(rng, sp.palette.trunk), { sway: 0.6 });
    const r = rng.range(0.7, 1.2);
    P.add(new THREE.IcosahedronGeometry(r, 2), sp.palette.glow, { matrix: mat(t.top.clone().add(new THREE.Vector3(0, r * 0.6, 0)), null, new THREE.Vector3(1, 1.25, 1)), glow: 1.6 });
    for (let i = 0; i < 3; i++) {
      const y = rng.range(h * 0.3, h * 0.8);
      const a = rng.range(0, Math.PI * 2);
      P.add(new THREE.IcosahedronGeometry(0.25, 1), sp.palette.glow, { matrix: mat(new THREE.Vector3(Math.cos(a) * 0.5, y, Math.sin(a) * 0.5)), glow: 1.2 });
    }
    return h;
  },

  shrub(rng, sp, P) {
    const n = rng.int(3, 6);
    for (let i = 0; i < n; i++) {
      const r = rng.range(0.3, 0.6);
      const off = new THREE.Vector3(rng.range(-0.5, 0.5), r * rng.range(0.6, 1.2), rng.range(-0.5, 0.5));
      P.add(lumpy(rng, r, 0, 0.2), jitter(rng, sp.palette.leaf[i % 3]), { matrix: mat(off) });
    }
    if (sp.glow > 0.5) {
      for (let i = 0; i < 4; i++) {
        const off = new THREE.Vector3(rng.range(-0.6, 0.6), rng.range(0.5, 1.1), rng.range(-0.6, 0.6));
        P.add(new THREE.IcosahedronGeometry(0.08, 0), sp.palette.glow, { matrix: mat(off), glow: 2 });
      }
    }
    return 1.2;
  },

  dryshrub(rng, sp, P) {
    const n = rng.int(6, 11);
    const col = jitter(rng, sp.palette.veg2 || sp.palette.trunk);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const len = rng.range(0.5, 1.2);
      const stick = new THREE.CylinderGeometry(0.015, 0.03, len, 3);
      stick.translate(0, len / 2, 0);
      P.add(stick, col, { matrix: mat(new THREE.Vector3(), new THREE.Euler(Math.cos(a) * rng.range(0.3, 0.9), 0, Math.sin(a) * rng.range(0.3, 0.9))) });
    }
    return 1;
  },

  frostshrub(rng, sp, P) {
    const n = rng.int(5, 9);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const g = prism(0.05, rng.range(0.3, 0.8), 4);
      P.add(g, jitter(rng, sp.palette.leaf[i % 3]), { matrix: mat(new THREE.Vector3(rng.range(-0.2, 0.2), 0, rng.range(-0.2, 0.2)), new THREE.Euler(Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6)), glow: 0.2 });
    }
    return 0.9;
  },

  grass(rng, sp, P) {
    const n = rng.int(6, 10);
    const base = jitter(rng, sp.palette.veg || sp.palette.leaf[0], 0.06);
    const tip = jitter(rng, sp.palette.veg2 || sp.palette.leaf[1], 0.06);
    const pos = [];
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(0, 0.25);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = rng.range(0.35, 0.8);
      const w = rng.range(0.04, 0.07);
      const lean = rng.range(0.1, 0.35);
      const la = rng.range(0, Math.PI * 2);
      const tx = x + Math.cos(la) * lean, tz = z + Math.sin(la) * lean;
      const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
      pos.push(x - px, 0, z - pz, x + px, 0, z + pz, tx, h, tz);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.computeVertexNormals();
    // grass normals point up so it shades like the ground under it
    const nrm = g.attributes.normal;
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
    P.add(g, base, { color2: tip });
    return 0.8;
  },

  flower(rng, sp, P) {
    const h = rng.range(0.5, 1.1);
    const stem = new THREE.CylinderGeometry(0.02, 0.03, h, 4);
    stem.translate(0, h / 2, 0);
    P.add(stem, jitter(rng, sp.palette.veg || sp.palette.leaf[0]));
    const petals = rng.int(4, 7);
    const pc = jitter(rng, sp.palette.leaf[rng.int(0, 2)]);
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2;
      const petal = new THREE.SphereGeometry(0.12, 6, 4);
      P.add(petal, pc, { matrix: mat(new THREE.Vector3(Math.cos(a) * 0.12, h, Math.sin(a) * 0.12), new THREE.Euler(0, -a, 0.5), new THREE.Vector3(1.4, 0.3, 0.7)), glow: 0.3 });
    }
    P.add(new THREE.IcosahedronGeometry(0.07, 1), sp.palette.glow, { matrix: mat(new THREE.Vector3(0, h + 0.03, 0)), glow: 2.5 });
    return h;
  },

  mushroom(rng, sp, P) {
    const h = rng.range(0.3, 0.9);
    const stalk = new THREE.CylinderGeometry(0.06, 0.09, h, 6);
    stalk.translate(0, h / 2, 0);
    P.add(stalk, jitter(rng, '#e8dcc8'));
    const r = rng.range(0.2, 0.45);
    const cap = new THREE.SphereGeometry(r, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    P.add(cap, jitter(rng, sp.palette.leaf[rng.int(0, 2)]), { matrix: mat(new THREE.Vector3(0, h * 0.95, 0), null, new THREE.Vector3(1, 0.6, 1)) });
    const under = new THREE.CircleGeometry(r * 0.95, 10);
    P.add(under, sp.palette.glow, { matrix: mat(new THREE.Vector3(0, h * 0.95, 0), new THREE.Euler(Math.PI / 2, 0, 0)), glow: 1.2 * sp.glow });
    return h + r;
  },

  bigmushroom(rng, sp, P) {
    const h = rng.range(3, 6);
    const t = trunk(rng, h, 0.35, 0.25, rng.range(0.2, 1.0), 8);
    P.add(t.geo, jitter(rng, '#d8ccb8'), { sway: 0.2 });
    const r = rng.range(2.0, 3.4);
    const cap = new THREE.SphereGeometry(r, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    P.add(cap, jitter(rng, sp.palette.leaf[0]), { matrix: mat(t.top.clone().add(new THREE.Vector3(0, -0.2, 0)), null, new THREE.Vector3(1, 0.45, 1)), color2: jitter(rng, sp.palette.leaf[1]), sway: 0.3 });
    const under = new THREE.CircleGeometry(r * 0.97, 16);
    P.add(under, sp.palette.glow, { matrix: mat(t.top.clone().add(new THREE.Vector3(0, -0.22, 0)), new THREE.Euler(Math.PI / 2, 0, 0)), glow: 1.4, sway: 0.3 });
    for (let i = 0; i < 6; i++) {
      const a = rng.range(0, Math.PI * 2);
      const rr = rng.range(0.3, 0.8) * r;
      P.add(new THREE.IcosahedronGeometry(rng.range(0.12, 0.25), 0), '#ffffff', { matrix: mat(t.top.clone().add(new THREE.Vector3(Math.cos(a) * rr, 0.45 * Math.sqrt(1 - (rr / r) ** 2) * r - 0.1, Math.sin(a) * rr))), glow: 0.4, sway: 0.3 });
    }
    return h + 1;
  },

  pod(rng, sp, P) {
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) {
      const h = rng.range(0.3, 0.9);
      const off = new THREE.Vector3(rng.range(-0.3, 0.3), 0, rng.range(-0.3, 0.3));
      const stalk = new THREE.CylinderGeometry(0.03, 0.05, h, 4);
      stalk.translate(0, h / 2, 0);
      P.add(stalk, jitter(rng, sp.palette.veg || sp.palette.trunk), { matrix: mat(off) });
      const r = rng.range(0.15, 0.3);
      P.add(new THREE.IcosahedronGeometry(r, 1), sp.palette.glow, { matrix: mat(off.clone().add(new THREE.Vector3(0, h + r * 0.7, 0)), null, new THREE.Vector3(1, 1.3, 1)), glow: 1.5 });
    }
    return 1;
  },

  tendril(rng, sp, P) {
    const n = rng.int(3, 6);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const h = rng.range(0.8, 2.0);
      const curl = rng.range(0.3, 0.8);
      const pts = [];
      for (let k = 0; k <= 4; k++) {
        const t = k / 4;
        pts.push(new THREE.Vector3(Math.cos(a) * (0.1 + curl * t * t), h * t, Math.sin(a) * (0.1 + curl * t * t) + Math.sin(t * 3) * 0.1));
      }
      P.add(tube(pts, 0.06, 4, 6, 0.2), jitter(rng, sp.palette.leaf[i % 3]));
      if (sp.glow > 0.3) P.add(new THREE.IcosahedronGeometry(0.07, 0), sp.palette.glow, { matrix: mat(pts[4]), glow: 2 });
    }
    return 2;
  },

  cactus(rng, sp, P) {
    const h = rng.range(1.8, 4);
    const r = rng.range(0.22, 0.35);
    const col = jitter(rng, sp.palette.leaf[rng.int(0, 2)], 0.05);
    const body = new THREE.CylinderGeometry(r, r * 1.05, h, 10, 2);
    body.translate(0, h / 2, 0);
    P.add(body, col, { sway: 0.1 });
    P.add(new THREE.SphereGeometry(r, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), col, { matrix: mat(new THREE.Vector3(0, h, 0)), sway: 0.1 });
    const arms = rng.int(0, 3);
    for (let i = 0; i < arms; i++) {
      const a = rng.range(0, Math.PI * 2);
      const y = rng.range(h * 0.3, h * 0.65);
      const out = rng.range(0.45, 0.8);
      const up = rng.range(0.5, 1.2);
      const pts = [new THREE.Vector3(0, y, 0), new THREE.Vector3(Math.cos(a) * out, y + 0.1, Math.sin(a) * out), new THREE.Vector3(Math.cos(a) * out, y + up, Math.sin(a) * out)];
      P.add(tube(pts, r * 0.65, 8, 8, 0.9), col, { sway: 0.1 });
    }
    if (rng.chance(0.5)) P.add(new THREE.IcosahedronGeometry(r * 0.5, 1), sp.palette.glow, { matrix: mat(new THREE.Vector3(0, h + r * 0.6, 0)), glow: 1.2 });
    return h;
  },

  vent(rng, sp, P) {
    const h = rng.range(1.2, 2.6);
    const cone = new THREE.CylinderGeometry(0.35, 1.1, h, 9, 2, true);
    cone.translate(0, h / 2, 0);
    P.add(lumpy(rng, 1, 0, 0.25, new THREE.Vector3(1.1, 0.5, 1.1)), jitter(rng, sp.palette.cliff), { sway: 0 });
    P.add(cone, jitter(rng, sp.palette.cliff), { sway: 0 });
    const lava = new THREE.CircleGeometry(0.34, 9);
    P.add(lava, '#ff7a2a', { matrix: mat(new THREE.Vector3(0, h - 0.05, 0), new THREE.Euler(-Math.PI / 2, 0, 0)), glow: 3, sway: 0 });
    return h;
  },

  rock(rng, sp, P) {
    const r = rng.range(0.35, 0.8);
    const g = lumpy(rng, r, 1, 0.3, new THREE.Vector3(rng.range(0.9, 1.4), rng.range(0.5, 0.9), rng.range(0.9, 1.3)));
    P.add(g, jitter(rng, rng.chance(0.5) ? sp.palette.cliff : sp.palette.high, 0.1), { sway: 0 });
    return 1;
  },

  boulder(rng, sp, P) {
    const r = rng.range(1.2, 2.2);
    const g = lumpy(rng, r, 1, 0.28, new THREE.Vector3(rng.range(0.9, 1.4), rng.range(0.6, 1.0), rng.range(0.9, 1.3)));
    P.add(g, jitter(rng, sp.palette.cliff, 0.1), { sway: 0, color2: jitter(rng, sp.palette.high, 0.1) });
    return 2;
  },

  obsidian(rng, sp, P) {
    const n = rng.int(2, 5);
    for (let i = 0; i < n; i++) {
      const g = new THREE.OctahedronGeometry(rng.range(0.4, 0.9), 0);
      const a = rng.range(0, Math.PI * 2);
      P.add(g, jitter(rng, '#1c1820', 0.05), { matrix: mat(new THREE.Vector3(Math.cos(a) * 0.4, rng.range(0.3, 0.8), Math.sin(a) * 0.4), new THREE.Euler(rng.range(-0.5, 0.5), a, rng.range(-0.5, 0.5)), new THREE.Vector3(0.6, rng.range(1.2, 2.2), 0.6)), sway: 0 });
    }
    return 1.5;
  },

  crystal(rng, sp, P) {
    const n = rng.int(4, 8);
    const col = sp.crystalColor;
    for (let i = 0; i < n; i++) {
      const hh = rng.range(0.5, 1.6) * (i === 0 ? 1.5 : 1);
      const g = prism(rng.range(0.1, 0.22), hh, 6);
      const a = rng.range(0, Math.PI * 2);
      const tilt = i === 0 ? 0 : rng.range(0.25, 0.8);
      P.add(g, jitter(rng, col, 0.05), { matrix: mat(new THREE.Vector3(Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15), new THREE.Euler(Math.cos(a) * tilt, 0, Math.sin(a) * tilt)), glow: 1.1, sway: 0 });
    }
    P.add(lumpy(rng, 0.45, 0, 0.3, new THREE.Vector3(1.2, 0.4, 1.2)), jitter(rng, sp.palette.cliff), { sway: 0 });
    return 1.5;
  },

  iceshard(rng, sp, P) {
    const n = rng.int(2, 5);
    for (let i = 0; i < n; i++) {
      const hh = rng.range(1.2, 3.5) * (i === 0 ? 1.3 : 1);
      const g = new THREE.ConeGeometry(rng.range(0.2, 0.45), hh, 5, 1);
      g.translate(0, hh / 2, 0);
      const a = rng.range(0, Math.PI * 2);
      const tilt = rng.range(0, 0.45);
      P.add(g, jitter(rng, i % 2 ? '#dff4ff' : '#9fd6ff', 0.05), { matrix: mat(new THREE.Vector3(Math.cos(a) * 0.3, -0.1, Math.sin(a) * 0.3), new THREE.Euler(Math.cos(a) * tilt, 0, Math.sin(a) * tilt)), glow: 0.35, sway: 0 });
    }
    return 3;
  },

  floater(rng, sp, P) {
    const r = rng.range(1.2, 2.2);
    const g = lumpy(rng, r, 1, 0.3, new THREE.Vector3(1.2, 0.7, 1.1));
    P.add(g, jitter(rng, sp.palette.cliff, 0.1), { sway: 0, color2: jitter(rng, sp.palette.veg || sp.palette.high) });
    // hanging roots
    for (let i = 0; i < 4; i++) {
      const a = rng.range(0, Math.PI * 2);
      const len = rng.range(1, 2.5);
      const root = new THREE.CylinderGeometry(0.03, 0.08, len, 3);
      root.translate(0, -len / 2, 0);
      P.add(root, jitter(rng, sp.palette.leaf[0]), { matrix: mat(new THREE.Vector3(Math.cos(a) * r * 0.5, -r * 0.4, Math.sin(a) * r * 0.5)), sway: 0 });
    }
    if (sp.palette.glow) P.add(new THREE.IcosahedronGeometry(0.2, 0), sp.palette.glow, { matrix: mat(new THREE.Vector3(0, -r * 0.6 - 2, 0)), glow: 2, sway: 0 });
    return 3;
  },

  spire(rng, sp, P) {
    const h = rng.range(8, 16);
    const segs = rng.int(3, 5);
    let y = 0;
    let r = rng.range(1.2, 1.8);
    let x = 0, z = 0;
    for (let i = 0; i < segs; i++) {
      const sh = h / segs;
      const r2 = r * rng.range(0.6, 0.85);
      const g = new THREE.CylinderGeometry(r2, r, sh, 7, 1);
      g.translate(x, y + sh / 2, z);
      P.add(g, jitter(rng, i % 2 ? sp.palette.cliff : sp.palette.high, 0.08), { sway: 0 });
      y += sh;
      r = r2;
      x += rng.range(-0.3, 0.3);
      z += rng.range(-0.3, 0.3);
    }
    return h;
  },
};

export function buildSpeciesGeometry(sp, resourceColor) {
  const rng = new RNG(sp.seed * 7 + 3);
  const P = new Parts();
  sp.crystalColor = resourceColor || '#6fd6ff';
  const fn = BUILDERS[sp.kind] || BUILDERS.rock;
  const swayH = fn(rng, sp, P);
  const geo = P.build(swayH);
  return geo;
}

export function materialKind(kind) {
  if (kind === 'rock' || kind === 'boulder' || kind === 'floater' || kind === 'spire' || kind === 'vent') return 'rock';
  if (kind === 'crystal' || kind === 'iceshard' || kind === 'obsidian' || kind === 'icetree' || kind === 'frostshrub') return 'crystal';
  return 'plant';
}
