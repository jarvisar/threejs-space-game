import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { RNG } from '../core/rng.js';
import { createNoise3D } from '../core/noise.js';
import { smoothstep } from '../core/math.js';

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

// Helpers for the small plants, rocks and minerals below.

function qmat(pos, quat, s = 1) {
  return new THREE.Matrix4().compose(pos, quat, typeof s === 'number' ? new THREE.Vector3(s, s, s) : s);
}

function aim(dir, spin = 0) {
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
  return spin ? q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, spin)) : q;
}

// Points for a chunky stone. They start on a squashed sphere and get pushed
// flat against a few random cut planes, so the hull ends up with some big
// chipped facets instead of even noise. The bottom is clipped flat at floor
// (fraction of the half height below the center) and moved to y = 0.
function rockPoints(rng, r, sx, sy, sz, cuts = 3, count = 22, floor = 0.35) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const k = Math.sqrt(1 - y * y);
    const a = i * 2.39996 + rng.range(-0.4, 0.4);
    const rr = r * rng.range(0.85, 1.1);
    pts.push(new THREE.Vector3(Math.cos(a) * k * rr * sx, y * rr * sy, Math.sin(a) * k * rr * sz));
  }
  const n = new THREE.Vector3();
  for (let c = 0; c < cuts; c++) {
    const a = rng.range(0, Math.PI * 2);
    const e = rng.range(-0.15, 1.1);
    n.set(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e));
    let m = 0;
    for (const p of pts) m = Math.max(m, p.dot(n));
    const d = m * rng.range(0.6, 0.85);
    for (const p of pts) {
      const o = p.dot(n) - d;
      if (o > 0) p.addScaledVector(n, -o);
    }
  }
  const fy = -floor * r * sy;
  for (const p of pts) {
    p.y = Math.max(p.y, fy) - fy;
  }
  return pts;
}

function hullRock(rng, r, sx, sy, sz, cuts, count, floor) {
  const points = rockPoints(rng, r, sx, sy, sz, cuts, count, floor);
  return count >= 22 ? chippedHull(points, 0.1) : new ConvexGeometry(points);
}

// Inset each planar face, then hull the insets to leave narrow chipped edges.
// Coplanar triangles share an inset so triangulation doesn't carve extra seams.
function chippedHull(points, bevel = 0.1) {
  const hull = new ConvexGeometry(points);
  const pos = hull.attributes.position;
  const normal = hull.attributes.normal;
  const faces = new Map();
  for (let i = 0; i < pos.count; i += 3) {
    const n = new THREE.Vector3().fromBufferAttribute(normal, i);
    const a = new THREE.Vector3().fromBufferAttribute(pos, i);
    const key = [n.x, n.y, n.z, n.dot(a)].map((v) => Math.round(v * 1e4)).join(',');
    if (!faces.has(key)) faces.set(key, new Map());
    const face = faces.get(key);
    for (let j = 0; j < 3; j++) {
      const p = new THREE.Vector3().fromBufferAttribute(pos, i + j);
      face.set(p.toArray().map((v) => Math.round(v * 1e5)).join(','), p);
    }
  }
  const inset = [];
  for (const face of faces.values()) {
    const center = new THREE.Vector3();
    for (const p of face.values()) center.add(p);
    center.divideScalar(face.size);
    for (const p of face.values()) inset.push(p.clone().lerp(center, bevel));
  }
  hull.dispose();
  return new ConvexGeometry(inset);
}

// What grows on top of rocks, by planet type
function rockCover(sp) {
  const p = sp.palette;
  switch (sp.planetType) {
    case 'lush':
    case 'ocean':
      return { color: p.veg, at: 0.6, k: 0.85 };
    case 'toxic':
      return { color: p.veg, at: 0.62, k: 0.85 };
    case 'exotic':
      return { color: p.veg, at: 0.65, k: 0.85, glow: 0.2 };
    case 'frozen':
      return { color: p.peak, at: 0.62, k: 0.8 };
    case 'desert':
    case 'barren':
      return { color: p.sand, at: 0.7, k: 0.7 };
    // faintly glowing lichen
    case 'radioactive':
      return { color: p.veg, at: 0.65, k: 0.8, glow: 0.3 };
    case 'volcanic':
      return { color: new THREE.Color(p.high).lerp(new THREE.Color('#cfc6bc'), 0.35), at: 0.72, k: 0.7 };
    default:
      return null;
  }
}

function hash01(k) {
  const s = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// Rock vertex colors: lo to hi from y0 up over h, darker near the ground
// (baked AO), optional strata bands (per face, by height) and a cover color
// on faces that point up. occ is a list of [center, radius] for neighbouring
// chunks, vertices tucked against them get darker too.
function paintRock(g, o) {
  const pos = g.attributes.position.array;
  const col = g.attributes.color.array;
  const glow = g.attributes.aGlow.array;
  const lo = new THREE.Color(o.lo);
  const hi = new THREE.Color(o.hi);
  const cov = o.cover ? new THREE.Color(o.cover.color) : null;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), P = new THREE.Vector3();
  const ao = o.ao ?? 0.4;
  for (let i = 0; i < pos.length; i += 9) {
    A.fromArray(pos, i);
    B.fromArray(pos, i + 3).sub(A);
    C.fromArray(pos, i + 6).sub(A);
    const ny = B.cross(C).normalize().y;
    const cy = (pos[i + 1] + pos[i + 4] + pos[i + 7]) / 3;
    const band = o.strata ? 1 + (hash01(Math.floor((cy - o.y0) / o.strata) + (o.seed || 0)) - 0.5) * (o.band ?? 0.2) : 1;
    const ck = cov ? (o.cover.k ?? 1) * THREE.MathUtils.smoothstep(ny, o.cover.at, o.cover.at + 0.2) * THREE.MathUtils.smoothstep(cy, o.y0 + o.h * 0.15, o.y0 + o.h * 0.45) : 0;
    for (let v = 0; v < 3; v++) {
      const j = i + v * 3;
      const t = Math.min(1, Math.max(0, (pos[j + 1] - o.y0) / o.h));
      let k = band * (1 - ao * (1 - THREE.MathUtils.smoothstep(t, 0, 0.45)));
      if (o.occ) {
        P.fromArray(pos, j);
        for (const [c, r] of o.occ) k *= 1 - 0.35 * (1 - THREE.MathUtils.smoothstep(P.distanceTo(c) / r, 0.85, 1.35));
      }
      let r = (lo.r + (hi.r - lo.r) * t) * k;
      let gg = (lo.g + (hi.g - lo.g) * t) * k;
      let b = (lo.b + (hi.b - lo.b) * t) * k;
      if (ck > 0) {
        const s = 0.8 + 0.2 * k;
        r += (cov.r * s - r) * ck;
        gg += (cov.g * s - gg) * ck;
        b += (cov.b * s - b) * ck;
        if (o.cover.glow) glow[j / 3] = Math.max(glow[j / 3], o.cover.glow * ck);
      }
      col[j] = r;
      col[j + 1] = gg;
      col[j + 2] = b;
    }
  }
}

// Paints a group of chunks as one rock, each one shaded by the others
function paintChunks(list, o) {
  let y0 = Infinity, y1 = -Infinity;
  const spheres = [];
  for (const g of list) {
    g.computeBoundingBox();
    g.computeBoundingSphere();
    y0 = Math.min(y0, g.boundingBox.min.y);
    y1 = Math.max(y1, g.boundingBox.max.y);
    spheres.push([g.boundingSphere.center.clone(), g.boundingSphere.radius]);
  }
  list.forEach((g, i) => paintRock(g, { ...o, y0: o.y0 ?? y0, h: o.h ?? Math.max(0.05, y1 - y0), occ: spheres.filter((s, j) => j !== i) }));
}

// Color (and glow) stops along aT, or along height when a part has no aT.
// Drops aT afterwards so every part keeps the same attributes for merging.
function ramp(g, stops) {
  const col = g.attributes.color.array;
  const glow = g.attributes.aGlow.array;
  const pos = g.attributes.position.array;
  const at = g.attributes.aT ? g.attributes.aT.array : null;
  const n = pos.length / 3;
  let y0 = Infinity, y1 = -Infinity;
  if (!at) for (let i = 0; i < n; i++) { y0 = Math.min(y0, pos[i * 3 + 1]); y1 = Math.max(y1, pos[i * 3 + 1]); }
  const cs = stops.map((s) => new THREE.Color(s[1]));
  for (let i = 0; i < n; i++) {
    const t = at ? at[i] : (pos[i * 3 + 1] - y0) / Math.max(1e-4, y1 - y0);
    let j = 0;
    while (j < stops.length - 2 && t > stops[j + 1][0]) j++;
    const s0 = stops[j], s1 = stops[j + 1];
    const f = Math.min(1, Math.max(0, (t - s0[0]) / Math.max(1e-4, s1[0] - s0[0])));
    col[i * 3] = cs[j].r + (cs[j + 1].r - cs[j].r) * f;
    col[i * 3 + 1] = cs[j].g + (cs[j + 1].g - cs[j].g) * f;
    col[i * 3 + 2] = cs[j].b + (cs[j + 1].b - cs[j].b) * f;
    if (s0[2] != null) glow[i] = s0[2] + (s1[2] - s0[2]) * f;
  }
  if (at) g.deleteAttribute('aT');
  return g;
}

// Tube along a polyline with parallel transport frames. Cheaper than
// TubeGeometry and the radius can be a function of t. tip closes the end
// in a point. aT runs 0 to 1 along the length, use ramp() on it.
function sweepTube(pts, r0, r1, sides = 3, tip = false) {
  const rad = typeof r0 === 'function' ? r0 : (t) => r0 + (r1 - r0) * t;
  const n = pts.length;
  const pos = [], at = [], idx = [];
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), prev = new THREE.Vector3();
  const q = new THREE.Quaternion();
  for (let i = 0; i < n; i++) {
    T.subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
    if (i === 0) {
      N.set(0, 0, 1);
      if (Math.abs(T.z) > 0.9) N.set(1, 0, 0);
      N.cross(T).normalize();
    } else {
      N.applyQuaternion(q.setFromUnitVectors(prev, T));
    }
    B.crossVectors(T, N);
    prev.copy(T);
    const t = i / (n - 1);
    const r = rad(t);
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const c = Math.cos(a) * r, d = Math.sin(a) * r;
      pos.push(pts[i].x + N.x * c + B.x * d, pts[i].y + N.y * c + B.y * d, pts[i].z + N.z * c + B.z * d);
      at.push(t);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let s = 0; s < sides; s++) {
      const a = i * sides + s, b = i * sides + ((s + 1) % sides);
      idx.push(a, b, a + sides, b, b + sides, a + sides);
    }
  }
  if (tip) {
    const e = pts[n - 1].clone().addScaledVector(T, rad(1) * 2.5 + 0.01);
    const k = pos.length / 3;
    pos.push(e.x, e.y, e.z);
    at.push(1);
    for (let s = 0; s < sides; s++) idx.push((n - 1) * sides + s, (n - 1) * sides + ((s + 1) % sides), k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(at, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Surface of revolution from a profile of [radius, y, rib, twist] rows,
// bottom to top. A radius of 0 is a single pole vertex. rib pulls every
// other sample inward, for gills and pod ribs. aT is the row, 0 to 1.
function ringsGeo(prof, count) {
  const pos = [], at = [], idx = [], start = [];
  prof.forEach((p, j) => {
    start.push(pos.length / 3);
    const t = j / (prof.length - 1);
    if (p[0] === 0) {
      pos.push(0, p[1], 0);
      at.push(t);
      return;
    }
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + (p[3] || 0);
      const r = p[0] * (k % 2 ? 1 - (p[2] || 0) : 1);
      pos.push(Math.cos(a) * r, p[1], Math.sin(a) * r);
      at.push(t);
    }
  });
  for (let j = 0; j < prof.length - 1; j++) {
    const a = start[j], b = start[j + 1];
    for (let k = 0; k < count; k++) {
      const k1 = (k + 1) % count;
      if (prof[j][0] === 0) idx.push(a, b + k, b + k1);
      else if (prof[j + 1][0] === 0) idx.push(a + k, b, a + k1);
      else idx.push(a + k, b + k, a + k1, a + k1, b + k, b + k1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(at, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Leaf along +X that rises and droops, tapering to a point. fold lifts the
// midrib so it reads as a shallow V. lobes > 0 notches the edge like a fern.
function leafStrip(len, w, rise, droop, segs = 3, fold = 0.3, lobes = 0) {
  const pos = [], at = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const x = len * t;
    const y = len * (rise * t - droop * t * t);
    if (i === segs) {
      pos.push(x, y, 0);
      at.push(1);
      break;
    }
    let ww = w * (0.25 + 0.75 * Math.sin(Math.PI * t)) * (1 - t * t * t);
    if (lobes && i % 2 && i < segs) ww *= 1 - lobes;
    pos.push(x, y, -ww, x, y + fold * ww, 0, x, y, ww);
    at.push(t, t, t);
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 3;
    if (i === segs - 1) idx.push(a, a + 1, a + 3, a + 1, a + 2, a + 3);
    else idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3, a + 1, a + 2, a + 4, a + 2, a + 5, a + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(at, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Flower head facing +Y. Each petal is a cosine lobe raised to fat (under 1
// gives round petals, over 1 pointed ones) and notch sets how deep the gaps
// between petals go. Started from the superformula, but at this vertex count
// it mostly gave spiky stars. cup lifts the petal tips. aT is 0 at the heart
// and 1 at the petal tips.
function bloomDisc(R, m, fat, notch, cup, rings = 2) {
  const seg = 4;
  const N = m * seg;
  const rs = [];
  for (let k = 0; k < N; k++) rs.push(notch + (1 - notch) * Math.pow(Math.abs(Math.cos((Math.PI * (k % seg)) / seg)), fat));
  const pos = [0, 0, 0], at = [0], idx = [];
  for (let j = 1; j <= rings; j++) {
    const f = j / rings;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const r = R * f * (j < rings ? 0.6 + 0.4 * rs[k] : rs[k]);
      const crease = Math.sin((k % seg) / seg * Math.PI) ** 2;
      const curl = R * 0.15 * crease * f * f + R * 0.045 * Math.sin(a * 3) * f;
      pos.push(Math.cos(a) * r, cup * (r / R) * (r / R) + curl, Math.sin(a) * r);
      at.push(j < rings ? f * 0.6 : rs[k]);
    }
  }
  for (let k = 0; k < N; k++) idx.push(0, 1 + ((k + 1) % N), 1 + k);
  for (let j = 1; j < rings; j++) {
    const a = 1 + (j - 1) * N, b = a + N;
    for (let k = 0; k < N; k++) {
      const k1 = (k + 1) % N;
      idx.push(a + k, b + k1, b + k, a + k, a + k1, b + k1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(at, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Crystal with a slightly tapered body and a pointed, off center tip. Open
// at the bottom since it grows out of rock or ground. aT runs up the length.
function crystalPrism(r, h, sides, tipH, taper = 0.85, skew = 0, cap = false) {
  const pos = [], at = [];
  const L = h + tipH;
  const ring = (y, rr) => {
    const out = [];
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      if (r >= 0.13) {
        // Narrow bevels leave broad gem faces that catch a different light.
        const b = ((s - 1) / sides) * Math.PI * 2;
        const c = ((s + 1) / sides) * Math.PI * 2;
        out.push([(Math.cos(a) * 0.84 + Math.cos(b) * 0.16) * rr, y, (Math.sin(a) * 0.84 + Math.sin(b) * 0.16) * rr]);
        out.push([(Math.cos(a) * 0.84 + Math.cos(c) * 0.16) * rr, y, (Math.sin(a) * 0.84 + Math.sin(c) * 0.16) * rr]);
      } else out.push([Math.cos(a) * rr, y, Math.sin(a) * rr]);
    }
    return out;
  };
  const b = ring(0, r), t = ring(h, r * taper);
  const shoulder = r >= 0.13 ? ring(h * 0.84, r * (taper + 0.065)) : null;
  const apex = [skew * r, L, 0];
  const tri = (p, q, s) => {
    pos.push(...p, ...q, ...s);
    at.push(p[1] / L, q[1] / L, s[1] / L);
  };
  for (let s = 0; s < b.length; s++) {
    const s1 = (s + 1) % b.length;
    const mid = shoulder || t;
    tri(b[s], mid[s], b[s1]);
    tri(b[s1], mid[s], mid[s1]);
    if (shoulder) {
      tri(mid[s], t[s], mid[s1]);
      tri(mid[s1], t[s], t[s1]);
    }
    tri(t[s], apex, t[s1]);
    if (cap) tri([0, 0, 0], b[s], b[s1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(at, 1));
  g.computeVertexNormals();
  return g;
}

// Blends face normals toward the direction from a center, so blobby leaf
// clumps shade softly while keeping a hint of their facets
function softenNormals(g, center, k) {
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).sub(center).normalize();
    n.fromBufferAttribute(nrm, i).lerp(p, k).normalize();
    nrm.setXYZ(i, n.x, n.y, n.z);
  }
}

// Planar polyline that turns more and more toward the end, for fronds,
// fiddlehead curls and drooping stems. Lies in the plane of dir and up.
function curlPath(dir, len, segs, start, turn, power = 2, twist = 0) {
  const pts = [new THREE.Vector3()];
  let u = 0, v = 0, ang = start;
  const step = len / segs;
  let w = 0;
  for (let k = 1; k <= segs; k++) w += Math.pow(k / segs, power);
  for (let k = 1; k <= segs; k++) {
    ang -= (turn * Math.pow(k / segs, power)) / w;
    u += Math.cos(ang) * step;
    v += Math.sin(ang) * step;
    const side = twist * Math.sin((k / segs) * Math.PI) * len * 0.15;
    pts.push(new THREE.Vector3(dir.x * u - dir.z * side, v, dir.z * u + dir.x * side));
  }
  return pts;
}

// Helpers for the big trees. The plant material uses vertex normals as they
// are, so canopies get normals bent toward the middle of the clump (it then
// shades like one soft mass) and shading is baked into vertex colors: darker
// and cooler underneath and near the ground, lighter and warmer on top.

const _c = new THREE.Color();
const _n = new THREE.Vector3();
const _ax = new THREE.Vector3(1, 0, 0);
const _hsl = {};
// hues that shadows and highlights lean toward
const COOL = 0.62;
const WARM = 0.13;

// Copy of a color with lightness and saturation scaled and the hue pulled
// toward `hue` by amt.
// Brightening eases off for colors that are already light, otherwise pastel
// palettes wash out to white.
function tint(color, light, hue = 0, amt = 0, sat = 1) {
  const c = new THREE.Color(color);
  c.getHSL(_hsl);
  let d = hue - _hsl.h;
  d -= Math.round(d);
  const h = _hsl.h + d * amt;
  const l = light > 1 ? Math.min(_hsl.l * light, _hsl.l + (1 - _hsl.l) * (light - 1)) : _hsl.l * light;
  c.setHSL(h - Math.floor(h), Math.min(1, _hsl.s * sat), Math.min(1, l));
  return c;
}

// Stitches rings of points into a surface. A ring is an array of points, or a
// single point for a pole. Rings run counterclockwise around the direction of
// travel (for a lathe: top down along the outside) so the front faces out.
// Points can carry u/v, which opts.tag keeps in an aTag attribute for paint().
function stitch(rings, opts = {}) {
  const pos = [];
  const tag = [];
  const idx = [];
  const start = [];
  for (const ring of rings) {
    start.push(pos.length / 3);
    for (const p of Array.isArray(ring) ? ring : [ring]) {
      pos.push(p.x, p.y, p.z);
      tag.push(p.u || 0, p.v || 0);
    }
  }
  for (let k = 0; k < rings.length - 1; k++) {
    const A = rings[k], B = rings[k + 1];
    const n = Array.isArray(A) ? A.length : B.length;
    for (let j = 0; j < (opts.open ? n - 1 : n); j++) {
      const j1 = (j + 1) % n;
      const u0 = Array.isArray(A) ? start[k] + j : start[k];
      const u1 = Array.isArray(A) ? start[k] + j1 : start[k];
      const l0 = Array.isArray(B) ? start[k + 1] + j : start[k + 1];
      const l1 = Array.isArray(B) ? start[k + 1] + j1 : start[k + 1];
      if (u0 !== u1) idx.push(u0, u1, l1);
      if (l0 !== l1) idx.push(u0, l1, l0);
    }
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (opts.tag) g.setAttribute('aTag', new THREE.Float32BufferAttribute(tag, 2));
  g.setIndex(idx);
  if (opts.flat) g = g.toNonIndexed();
  g.computeVertexNormals();
  return g;
}

// Tube along a curve. radius is a number or radius(t). opts.shape(t, j)
// scales single vertices (ribs), ease > 1 bunches rings toward the start (or
// ts lists the ring positions), tip closes the end with a point that many
// radii out. Rings don't repeat the seam vertex, so smooth normals have no
// crease.
function limb(points, radius, sides = 6, segs = 6, opts = {}) {
  const curve = points instanceof THREE.Curve ? points : new THREE.CatmullRomCurve3(points);
  // the default 200 arc length samples per curve dominated build time
  curve.arcLengthDivisions = 32;
  const rad = typeof radius === 'function' ? radius : () => radius;
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3();
  curve.getTangentAt(0, T);
  N.crossVectors(T, Math.abs(T.y) < 0.9 ? UP : _ax).normalize();
  const rings = [];
  for (let i = 0; i <= segs; i++) {
    const t = opts.ts ? opts.ts[i] : Math.pow(i / segs, opts.ease || 1);
    const c = curve.getPointAt(t);
    curve.getTangentAt(t, T);
    // parallel transport keeps the rings from twisting on bends
    N.addScaledVector(T, -N.dot(T)).normalize();
    B.crossVectors(T, N);
    const r = rad(t);
    const ring = [];
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2 + (opts.twist || 0) * t;
      const m = opts.shape ? r * opts.shape(t, j) : r;
      const p = c.clone().addScaledVector(N, Math.cos(a) * m).addScaledVector(B, Math.sin(a) * m);
      p.u = t;
      p.v = j / sides;
      ring.push(p);
    }
    rings.push(ring);
  }
  if (opts.tip) {
    const p = curve.getPointAt(1).addScaledVector(curve.getTangentAt(1, T), rad(1) * opts.tip);
    p.u = 1;
    rings.push(p);
  }
  return stitch(rings, opts);
}

// Surface of revolution around y. profile is [radius, y] pairs from the top
// down the outside, radius 0 makes a pole. u is the profile position (0-1).
function lathe(profile, sides, opts = {}) {
  const last = profile.length - 1;
  const rings = profile.map(([r, y], i) => {
    if (r <= 0) return Object.assign(new THREE.Vector3(0, y, 0), { u: i / last, v: 0 });
    const ring = [];
    for (let j = 0; j < sides; j++) {
      const a = (opts.rot || 0) + (j / sides) * Math.PI * 2;
      const m = opts.shape ? r * opts.shape(i, j) : r;
      ring.push(Object.assign(new THREE.Vector3(Math.cos(a) * m, y, Math.sin(a) * m), { u: i / last, v: j / sides }));
    }
    return ring;
  });
  return stitch(rings, opts);
}

// Strip along a curve with a V fold down the middle, so it catches light like
// a leaf. face is the direction the front (and the fold's ridge) points.
function ribbon(points, width, segs, fold, face, opts = {}) {
  const curve = points instanceof THREE.Curve ? points : new THREE.CatmullRomCurve3(points);
  curve.arcLengthDivisions = 32;
  const T = new THREE.Vector3(), F = new THREE.Vector3(), S = new THREE.Vector3();
  const rings = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const c = curve.getPointAt(t);
    curve.getTangentAt(t, T);
    F.copy(face).addScaledVector(T, -face.dot(T)).normalize();
    S.crossVectors(T, F);
    const w = Math.max(0.01, width(t, i) / 2);
    const l = c.clone().addScaledVector(S, -w).addScaledVector(F, -fold * w);
    const r = c.clone().addScaledVector(S, w).addScaledVector(F, -fold * w);
    rings.push([Object.assign(l, { u: t, v: 0 }), Object.assign(c, { u: t, v: 0.5 }), Object.assign(r, { u: t, v: 1 })]);
  }
  return stitch(rings, { open: true, flat: true, tag: opts.tag });
}

function foldedLeaf(base, tip, width, face = UP) {
  const dir = tip.clone().sub(base).normalize();
  const side = new THREE.Vector3().crossVectors(dir, face).normalize();
  const mid = base.clone().lerp(tip, 0.46).addScaledVector(face, width * 0.2);
  const left = mid.clone().addScaledVector(side, -width);
  const right = mid.clone().addScaledVector(side, width);
  mid.addScaledVector(face, width * 0.42);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([base, left, mid, right, tip].flatMap((p) => p.toArray()), 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute([0, 0.5, 0.5, 0.5, 1], 1));
  g.setIndex([0, 1, 2, 0, 2, 3, 1, 4, 2, 2, 4, 3]);
  g.computeVertexNormals();
  return g;
}

// Sixty triangles per lobe, with a rounder 96-triangle center for big crowns.
function crown(rng, radius, stretch, main = false) {
  const sides = main ? 12 : 10;
  const tiers = main ? 4 : 3;
  const phase = rng.range(0, Math.PI * 2);
  const lean = new THREE.Vector3(rng.range(-0.12, 0.12), 0, rng.range(-0.12, 0.12));
  const rings = [new THREE.Vector3(lean.x * radius, radius, lean.z * radius)];
  for (let i = 1; i <= tiers; i++) {
    const phi = i / (tiers + 1) * Math.PI;
    const ring = [];
    for (let j = 0; j < sides; j++) {
      const a = j / sides * Math.PI * 2;
      const scallop = 1 + 0.14 * Math.cos(a * (sides / 2) + phase) * Math.sin(phi) + 0.055 * Math.sin(a * 3 - phi + phase);
      const r = radius * Math.sin(phi) * scallop;
      const y = radius * (Math.cos(phi) + 0.075 * Math.sin(a * 3 + phase) * Math.sin(phi));
      ring.push(new THREE.Vector3(Math.cos(a) * r + lean.x * radius * Math.cos(phi), y, Math.sin(a) * r + lean.z * radius * Math.cos(phi)));
    }
    rings.push(ring);
  }
  rings.push(new THREE.Vector3(0, -radius * 0.82, 0));
  const g = stitch(rings, { flat: true });
  if (stretch) g.scale(stretch.x, stretch.y, stretch.z);
  return g;
}

// Pulls normals toward the direction away from center. k 0 keeps the facets,
// 1 is fully round. scale turns the sphere into an ellipsoid.
function bendNormals(g, center, k, scale) {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    _p.fromBufferAttribute(p, i).sub(center);
    if (scale) _p.divide(scale).divide(scale);
    _p.normalize();
    _n.fromBufferAttribute(n, i).lerp(_p, k).normalize();
    n.setXYZ(i, _n.x, _n.y, _n.z);
  }
  return g;
}

// Per-vertex colors on a part returned by P.add. fn(color, x, y, z, ny, u, v)
// sets the color and can return a glow value. The aTag attribute is dropped
// here, every part needs the same attributes to merge.
function paint(g, fn) {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const col = g.attributes.color;
  const glow = g.attributes.aGlow;
  const tag = g.attributes.aTag;
  for (let i = 0; i < p.count; i++) {
    const gl = fn(_c, p.getX(i), p.getY(i), p.getZ(i), n.getY(i), tag ? tag.getX(i) : 0, tag ? tag.getY(i) : 0);
    col.setXYZ(i, _c.r, _c.g, _c.b);
    if (gl !== undefined) glow.setX(i, gl);
  }
  if (tag) g.deleteAttribute('aTag');
  return g;
}

// dark where it meets the ground, a bit lighter toward the top
function bark(g, col, h) {
  const low = tint(col, 0.5, COOL, 0.1);
  const high = tint(col, 1.3, WARM, 0.08);
  return paint(g, (c, x, y) => {
    c.copy(low).lerp(col, smoothstep(-0.4, 1.2, y)).lerp(high, smoothstep(1, h, y) * 0.6);
  });
}

// canopy shading around a clump center, Ry is the clump's half height
function foliage(g, center, R, Ry, base, glow) {
  const dark = tint(base, 0.55, COOL, 0.12);
  const light = tint(base, 1.18, WARM, 0.1, 1.12);
  return paint(g, (c, x, y, z, ny) => {
    const dx = (x - center.x) / R, dy = (y - center.y) / Ry, dz = (z - center.z) / R;
    const d = Math.min(1, Math.sqrt(dx * dx + dy * dy + dz * dz));
    c.copy(dark).lerp(light, smoothstep(-0.9, 0.9, dy * 0.7 + ny * 0.45)).multiplyScalar(0.72 + 0.28 * d);
    return glow;
  });
}

// Parts.build scales sway by height, parts hanging from y0 should swing more
// toward their tips instead
function hangSway(g, H, y0, len) {
  const p = g.attributes.position;
  const m = g.attributes.aSwayMul;
  const base = Math.min(1.5, (y0 / H) ** 2);
  for (let i = 0; i < p.count; i++) {
    const y = Math.max(0.05, p.getY(i));
    m.setX(i, (base + 0.8 * Math.max(0, (y0 - y) / len)) / Math.max(0.002, Math.min(1.5, (y / H) ** 2)));
  }
}

// Trunk from a bit under the ground up to h, so slopes don't show a gap,
// flared at the base. The curve is returned so branches can start on it.
function stem(rng, h, r0, r1, bend, opts = {}) {
  const dir = rng.range(0, Math.PI * 2);
  const wob = opts.wobble ?? 0.12;
  const pts = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const w = i > 0 && i < 4 ? wob : 0;
    pts.push(new THREE.Vector3(Math.cos(dir) * bend * t * t + rng.range(-w, w), -0.4 + (h + 0.4) * t, Math.sin(dir) * bend * t * t + rng.range(-w, w)));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const flare = opts.flare ?? 0.8;
  const geo = limb(curve, (t) => (r0 + (r1 - r0) * t) * (1 + flare * Math.max(0, 1 - t / 0.2) ** 2), opts.sides || 6, opts.segs || 7, {
    ease: 1.5, tip: opts.tip ?? 0.6, tag: opts.tag,
    shape: (t, j) => 1 + 0.085 * Math.cos(j * 2.4 + t * 1.6) * (1 - t * 0.5),
  });
  return { geo, curve, top: pts[4] };
}

// buttress roots that dive into the ground, so they still touch it on a slope
function roots(rng, P, n, r0, col, painter) {
  const a0 = rng.range(0, Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const len = r0 * rng.range(2.6, 3.8);
    const x = Math.cos(a), z = Math.sin(a);
    const pts = [new THREE.Vector3(x * r0 * 0.3, r0 * 2.4, z * r0 * 0.3), new THREE.Vector3(x * len * 0.55, r0 * 0.45, z * len * 0.55), new THREE.Vector3(x * len, -0.3, z * len)];
    const g = P.add(limb(pts, (t) => r0 * 0.55 * (1 - 0.7 * t), 4, 2, { tip: 0.8, tag: true }), col, { sway: 0 });
    if (painter) painter(g);
    else bark(g, col, 3);
  }
}

// blossoms on top of the canopy or glowing fruit hanging under it, rolled per
// species. blobs are [center, radius, stretch?]
function treeExtras(rng, sp, P, blobs) {
  const roll = rng.next();
  if (roll > 0.55) return;
  const fruit = roll > 0.3;
  const col = jitter(rng, sp.palette.glow, 0.05);
  const n = fruit ? rng.int(5, 7) : rng.int(6, 8);
  for (let i = 0; i < n; i++) {
    const [pos, r, st] = blobs[i % blobs.length];
    const off = new THREE.Vector3(rng.range(-1, 1), fruit ? rng.range(-1, -0.35) : rng.range(0.15, 1), rng.range(-1, 1)).normalize().multiplyScalar(r * (fruit ? 0.86 : 0.94));
    if (st) off.multiply(st);
    const p = pos.clone().add(off);
    const size = fruit ? rng.range(0.15, 0.2) : rng.range(0.2, 0.3);
    if (!fruit) {
      const facing = off.clone().normalize();
      const g = P.add(bloomDisc(size, 5, 0.5, 0.3, size * 0.25, 1), col, { matrix: qmat(p, aim(facing, i)), sway: 1 });
      ramp(g, [[0, tint(col, 1.5), 0.5], [1, col, 0.15]]);
      continue;
    }
    const g = new THREE.OctahedronGeometry(size, 0);
    g.scale(1, 1.3, 1);
    p.y -= size * 0.7;
    g.translate(p.x, p.y, p.z);
    bendNormals(g, p, 0.8);
    P.add(g, col, { glow: 0.9, sway: 1 });
  }
}

function treeBroad(rng, sp, P, col, leafCol) {
  const h = rng.range(3.4, 5.2);
  const r0 = rng.range(0.26, 0.36);
  const s = stem(rng, h, r0, r0 * 0.55, rng.range(0.2, 0.9));
  bark(P.add(s.geo, col, { sway: 0.4 }), col, h);
  roots(rng, P, rng.int(3, 4), r0, col);
  const R = rng.range(2.1, 2.9);
  const C = s.top.clone();
  C.y += R * 0.5;
  const alt = rng.chance(0.4) ? jitter(rng, sp.palette.leaf[rng.int(0, 2)]) : leafCol;
  const blobs = [];
  const nb = rng.int(2, 4);
  const a0 = rng.range(0, Math.PI * 2);
  for (let i = 0; i < nb; i++) {
    const a = a0 + (i / nb) * Math.PI * 2 + rng.range(-0.35, 0.35);
    const out = R * rng.range(0.5, 0.7);
    const end = C.clone().add(new THREE.Vector3(Math.cos(a) * out, R * rng.range(-0.3, 0.1), Math.sin(a) * out));
    const start = s.curve.getPointAt(rng.range(0.72, 0.9));
    const mid = start.clone().lerp(end, 0.5);
    mid.y += 0.4;
    bark(P.add(limb([start, mid, end], (t) => r0 * 0.5 * (1 - t * 0.5), 5, 3), col, { sway: 0.6 }), col, h);
    blobs.push([end, R * rng.range(0.48, 0.6)]);
  }
  blobs.push([C.clone().add(new THREE.Vector3(rng.range(-0.3, 0.3), R * 0.3, rng.range(-0.3, 0.3))), R * rng.range(0.62, 0.75)]);
  if (nb < 4) {
    const a = rng.range(0, Math.PI * 2);
    blobs.push([C.clone().add(new THREE.Vector3(Math.cos(a) * R * 0.4, R * 0.05, Math.sin(a) * R * 0.4)), R * rng.range(0.45, 0.58)]);
  }
  blobs.forEach(([pos, r], i) => {
    const g = crown(rng, r, null, i === nb);
    g.translate(pos.x, pos.y, pos.z);
    bendNormals(g, pos, 0.65);
    const c = i % 2 ? alt : leafCol;
    foliage(P.add(g, c, { sway: 1 }), C, R, R * 0.8, c);
  });
  treeExtras(rng, sp, P, blobs);
  return C.y + R * 0.8;
}

// stacked star-shaped tiers with drooping (or upturned) tips
function treeFir(rng, sp, P, col, leafCol) {
  const h = rng.range(5, 8);
  const r0 = rng.range(0.2, 0.28);
  const s = stem(rng, h, r0, r0 * 0.35, rng.range(0, 0.4));
  bark(P.add(s.geo, col, { sway: 0.4 }), col, h);
  const tiers = rng.int(4, 6);
  const lobes = rng.int(5, 8);
  const droop = rng.range(-0.1, 0.45);
  const notch = rng.range(0.62, 0.85);
  const R0 = rng.range(1.6, 2.4);
  const y0 = h * rng.range(0.2, 0.3);
  const spin = rng.range(0.3, 1.2);
  const dark = tint(leafCol, 0.5, COOL, 0.15);
  const light = tint(leafCol, 1.2, WARM, 0.1, 1.1);
  const glowTips = rng.chance(0.25);
  const glowCol = new THREE.Color(sp.palette.glow);
  let apex = 0;
  for (let i = 0; i < tiers; i++) {
    const k = i / (tiers - 1);
    const r = R0 * (1 - k * 0.7);
    const th = r * rng.range(0.8, 1.05);
    // tiers bunch up toward the top where they get small
    const y = y0 + (h - 0.4 - y0) * Math.pow(k, 0.75);
    const c = s.curve.getPointAt(Math.min(1, (y + 0.4) / (h + 0.4)));
    const mid = [], rim = [];
    for (let j = 0; j < lobes * 2; j++) {
      const a = i * spin + (j / (lobes * 2)) * Math.PI * 2;
      const rr = j % 2 ? r * notch : r;
      mid.push(new THREE.Vector3(Math.cos(a) * rr * 0.55, th * 0.42, Math.sin(a) * rr * 0.55));
      rim.push(new THREE.Vector3(Math.cos(a) * rr, j % 2 ? -droop * r * 0.12 : -droop * r * 0.5, Math.sin(a) * rr));
    }
    const g = stitch([new THREE.Vector3(0, th, 0), mid, rim, new THREE.Vector3(0, th * 0.2, 0)], { flat: true });
    g.translate(c.x, y, c.z);
    bendNormals(g, new THREE.Vector3(c.x, y - r * 0.5, c.z), 0.5);
    paint(P.add(g, leafCol, { sway: 0.9 }), (cc, x, yy, z, ny) => {
      const out = Math.hypot(x - c.x, z - c.z) / r;
      cc.copy(dark).lerp(light, smoothstep(-0.3, 0.9, ny) * (0.5 + 0.35 * out) + k * 0.2);
      if (!glowTips) return;
      const t = smoothstep(0.85, 1, out);
      cc.lerp(glowCol, t * 0.55);
      return t * 0.7;
    });
    apex = new THREE.Vector3(c.x, y + th, c.z);
  }
  const tip = new THREE.ConeGeometry(0.3, 0.8, 5);
  tip.translate(apex.x, apex.y + 0.2, apex.z);
  bendNormals(tip, apex.clone().add(new THREE.Vector3(0, -0.5, 0)), 0.5);
  P.add(tip, light, { sway: 1 });
  return apex.y + 0.6;
}

// wide flat canopy on forked branches, sometimes with a second layer on top
function treeUmbrella(rng, sp, P, col, leafCol) {
  const h = rng.range(3, 4.6);
  const r0 = rng.range(0.24, 0.34);
  const s = stem(rng, h, r0, r0 * 0.7, rng.range(0.3, 1.3));
  bark(P.add(s.geo, col, { sway: 0.4 }), col, h + 2);
  const R = rng.range(2.8, 3.9);
  const flat = rng.range(0.26, 0.36);
  const st = new THREE.Vector3(1, flat * 1.3, 1);
  const C = s.top.clone();
  C.y += rng.range(1.5, 2.3);
  const pads = [[C.clone().add(new THREE.Vector3(0, R * flat * 0.4, 0)), R * 0.7, st]];
  const nb = rng.int(3, 4);
  const a0 = rng.range(0, Math.PI * 2);
  const fork = s.top.clone().add(new THREE.Vector3(0, -0.3, 0));
  for (let i = 0; i < nb; i++) {
    const a = a0 + (i / nb) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const out = R * rng.range(0.48, 0.62);
    const end = C.clone().add(new THREE.Vector3(Math.cos(a) * out, -R * flat * 0.3, Math.sin(a) * out));
    const mid = fork.clone().lerp(end, 0.4);
    mid.y += 0.5;
    bark(P.add(limb([fork, mid, end], (t) => r0 * 0.62 * (1 - t * 0.45), 4, 3), col, { sway: 0.6 }), col, h + 2);
    pads.push([end.clone().add(new THREE.Vector3(0, R * flat * 0.3, 0)), R * rng.range(0.42, 0.54), st]);
  }
  if (rng.chance(0.35)) {
    const top = C.clone().add(new THREE.Vector3(rng.range(-0.3, 0.3), R * rng.range(0.55, 0.75), rng.range(-0.3, 0.3)));
    bark(P.add(limb([fork, C, top], (t) => r0 * 0.5 * (1 - t * 0.4), 4, 3), col, { sway: 0.6 }), col, h + 2);
    pads.push([top, R * rng.range(0.4, 0.5), st]);
  }
  const sq = new THREE.Vector3(1, flat * 1.6, 1);
  pads.forEach(([pos, r], i) => {
    const g = crown(rng, r, st, i === 0);
    g.translate(pos.x, pos.y, pos.z);
    bendNormals(g, pos, 0.7, sq);
    foliage(P.add(g, leafCol, { sway: 1 }), C, R, R * flat * 1.6, leafCol);
  });
  treeExtras(rng, sp, P, pads);
  return C.y + R * flat;
}

// dome with long hanging strands, sometimes with glowing drops at the ends
function treeWeeping(rng, sp, P, col, leafCol) {
  const h = rng.range(3.8, 5.8);
  const r0 = rng.range(0.2, 0.28);
  const s = stem(rng, h, r0, r0 * 0.5, rng.range(0.5, 1.4));
  bark(P.add(s.geo, col, { sway: 0.4 }), col, h);
  const R = rng.range(1.7, 2.4);
  const sq = rng.range(0.55, 0.75);
  const st = new THREE.Vector3(1, sq, 1);
  const C = s.top.clone();
  C.y += R * 0.2;
  const H = C.y + R * sq;
  const dome = crown(rng, R, st, true);
  dome.translate(C.x, C.y, C.z);
  bendNormals(dome, C, 0.7, st);
  foliage(P.add(dome, leafCol, { sway: 1 }), C, R, R * sq, leafCol);
  const strandCol = jitter(rng, sp.palette.leaf[rng.int(0, 2)]);
  const dark = tint(leafCol, 0.75, COOL, 0.12);
  const light = tint(strandCol, 1.25, WARM, 0.1);
  const glowCol = jitter(rng, sp.palette.glow, 0.05);
  const drops = rng.chance(0.45);
  const n = rng.int(10, 14);
  const reach = rng.range(0.55, 0.85);
  const width = rng.range(0.36, 0.52);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.15, 0.15);
    const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const start = C.clone().addScaledVector(d, R * 0.8);
    start.y -= R * sq * 0.35;
    const len = Math.min(start.y - 0.6, H * reach * rng.range(0.8, 1.1));
    const pts = [
      start,
      start.clone().addScaledVector(d, 0.35).add(new THREE.Vector3(0, -len * 0.2, 0)),
      start.clone().addScaledVector(d, 0.55).add(new THREE.Vector3(0, -len * 0.6, 0)),
      start.clone().addScaledVector(d, 0.6).add(new THREE.Vector3(0, -len, 0)),
    ];
    const g = ribbon(pts, (t) => width * (1 - t * 0.6), 5, 0.3, d);
    bendNormals(g, C, 0.35);
    const part = P.add(g, leafCol, { sway: 1 });
    paint(part, (c, x, y) => {
      c.copy(dark).lerp(light, smoothstep(start.y, start.y - len, y));
    });
    hangSway(part, H, start.y, len);
    if (drops && i % 2 === 0) {
      const p = pts[3].clone();
      p.y -= 0.18;
      const drop = new THREE.IcosahedronGeometry(0.15, 0);
      drop.scale(1, 1.35, 1);
      drop.translate(p.x, p.y, p.z);
      bendNormals(drop, p, 0.8);
      hangSway(P.add(drop, glowCol, { glow: 1 }), H, start.y, len);
    }
  }
  return H;
}

function palmOne(rng, P, o) {
  const pts = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    pts.push(new THREE.Vector3(Math.cos(o.dir) * o.bend * t ** 1.7, -0.4 + (o.h + 0.4) * t, Math.sin(o.dir) * o.bend * t ** 1.7));
  }
  const rings = o.rings;
  const trunk = limb(pts, (t) => o.r0 * (1 - 0.4 * t) * (1 + 1.1 * Math.max(0, 1 - t / 0.1) ** 2), 6, rings, {
    shape: (t) => (Math.round(t * rings) % 2 ? 1.08 : 0.95),
    tag: true,
  });
  const low = tint(o.col, 0.55, COOL, 0.1);
  const hi = tint(o.col, 1.4, WARM, 0.1);
  // alternating light and dark rings like old frond scars
  paint(P.add(trunk, o.col, { sway: 0.5 }), (c, x, y, z, ny, u) => {
    c.copy(low).lerp(o.col, smoothstep(-0.4, 1.5, y)).lerp(hi, Math.round(u * rings) % 2 ? 0.45 : 0);
  });
  const top = pts[4];
  const crown = lumpy(rng, o.r0 * 1.5, 0, 0.1);
  crown.translate(top.x, top.y, top.z);
  P.add(crown, tint(o.leafCol, 0.5, COOL, 0.1), { sway: 1 });
  const fDark = tint(o.leafCol, 0.6, COOL, 0.1);
  const fLight = tint(o.leafCol, 1.3, WARM, 0.15);
  for (let i = 0; i < o.fronds; i++) {
    const a = (i / o.fronds) * Math.PI * 2 + rng.range(-0.25, 0.25);
    const len = o.len * rng.range(0.85, 1.1);
    const lift = o.lift * rng.range(0.6, 1.4);
    const droop = o.droop * rng.range(0.75, 1.2);
    const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const fp = [0, 0.25, 0.5, 0.75, 1].map((t) => top.clone().addScaledVector(d, len * t + 0.1).add(new THREE.Vector3(0, lift * t - droop * t * t + 0.1, 0)));
    if (o.serr > 0.2) {
      const curve = new THREE.CatmullRomCurve3(fp);
      curve.arcLengthDivisions = 20;
      const rib = P.add(ribbon(curve, (t) => 0.1 * (1 - t) + 0.018, 3, 0.35, UP, { tag: true }), o.leafCol, { sway: 1.25 });
      paint(rib, (c, x, y, z, ny, u) => { c.copy(fDark).lerp(fLight, 0.25 + u * 0.55); });
      const side = new THREE.Vector3(-d.z, 0, d.x);
      const pairs = o.segs > 7 ? 6 : 5;
      for (let k = 0; k < pairs; k++) {
        const t = 0.15 + k / pairs * 0.75;
        for (const sign of [-1, 1]) {
          const at = curve.getPointAt(Math.min(0.96, t + sign * 0.015));
          const reach = o.width * 1.02 * Math.sin(Math.PI * (0.12 + t * 0.83)) ** 0.8;
          const tip = at.clone().addScaledVector(side, sign * reach).addScaledVector(d, len * (0.14 + 0.065 * t));
          tip.y -= reach * (0.18 + t * 0.32);
          const part = P.add(foldedLeaf(at, tip, reach * 0.34), o.leafCol, { sway: 1.3 });
          ramp(part, [[0, fDark], [0.45, o.leafCol], [1, fLight]]);
        }
      }
      continue;
    }
    const g = ribbon(fp, (t, j) => o.width * Math.sin(Math.PI * Math.min(1, 0.1 + t * 0.95)) ** 0.8 * (j % 2 ? 1 : 1 - o.serr), o.segs, 0.35, UP, { tag: true });
    bendNormals(g, top.clone().add(new THREE.Vector3(0, -1, 0)), 0.25);
    paint(P.add(g, o.leafCol, { sway: 1.3 }), (c, x, y, z, ny, u, v) => {
      c.copy(fDark).lerp(fLight, u * 0.8 + (1 - Math.abs(v - 0.5) * 2) * 0.2);
    });
  }
  const m = rng.int(2, 4);
  const b0 = rng.range(0, Math.PI * 2);
  for (let i = 0; i < m; i++) {
    const b = b0 + (i / m) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const p = top.clone().add(new THREE.Vector3(Math.cos(b) * o.r0 * 1.4, -0.25 - rng.range(0, 0.2), Math.sin(b) * o.r0 * 1.4));
    const g = new THREE.IcosahedronGeometry(rng.range(0.17, 0.22), 0);
    g.translate(p.x, p.y, p.z);
    bendNormals(g, p, 0.8);
    P.add(g, o.nutCol || tint(o.col, 1.2, WARM, 0.2), { glow: o.nutCol ? 0.9 : 0, sway: 0.5 });
  }
}

// ribbed column for cacti, the top rounds off over about one radius whatever
// the column's length
function ribbed(pts, r, ribs, segs, depth) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const cap = Math.min(0.35, (r * 1.3) / curve.getLength());
  const ts = [];
  for (let i = 0; i <= segs - 2; i++) ts.push(((1 - cap) * i) / (segs - 2));
  ts.push(1 - cap * 0.45, 1 - cap * 0.1);
  return limb(curve, (t) => r * Math.sqrt(Math.max(0.05, 1 - Math.max(0, (t - 1 + cap) / cap) ** 2)) * (1 + 0.25 * Math.max(0, 1 - t / 0.1)), ribs * 2, segs, {
    shape: (t, j) => (j % 2 ? 1 - depth : 1),
    tip: 0.35,
    tag: true,
    ts,
  });
}

// ridges lighter than the grooves, fresh growth at the top a bit yellower
function cactusPaint(g, col, ribs) {
  const low = tint(col, 0.55, COOL, 0.1);
  const top = tint(col, 1.3, WARM, 0.25);
  return paint(g, (c, x, y, z, ny, u, v) => {
    c.copy(low).lerp(col, smoothstep(-0.3, 1.2, y)).lerp(top, smoothstep(0.75, 1, u) * 0.7);
    c.multiplyScalar(Math.round(v * ribs * 2) % 2 ? 0.8 : 1.12);
  });
}

function cactusFlower(P, p, size, col) {
  const ring = [];
  for (let j = 0; j < 10; j++) {
    const a = (j / 10) * Math.PI * 2;
    const r = j % 2 ? size * 0.45 : size;
    ring.push(new THREE.Vector3(p.x + Math.cos(a) * r, p.y + (j % 2 ? 0 : size * 0.3), p.z + Math.sin(a) * r));
  }
  const g = stitch([new THREE.Vector3(p.x, p.y + size * 0.15, p.z), ring], { flat: true });
  bendNormals(g, p.clone().add(new THREE.Vector3(0, -size, 0)), 0.5);
  P.add(g, col, { glow: 0.8, sway: 0.2 });
}

// flat oval pads that sprout more pads from their top edge
function pricklyPear(rng, P, col, fruitCol) {
  const dark = tint(col, 0.6, COOL, 0.1);
  const light = tint(col, 1.25, WARM, 0.15);
  const tops = [];
  let count = 0;
  const pad = (base, yaw, tilt, size, depth) => {
    if (count++ > 8) return;
    const w = size * 0.7, hp = size, tk = size * 0.16;
    const ring = [];
    for (let j = 0; j < 12; j++) {
      const a = (j / 12) * Math.PI * 2;
      ring.push(new THREE.Vector3(Math.cos(a) * w, hp - Math.sin(a) * hp, 0));
    }
    const g = stitch([new THREE.Vector3(0, hp, tk), ring, new THREE.Vector3(0, hp, -tk)]);
    bendNormals(g, new THREE.Vector3(0, hp, 0), 0.5, new THREE.Vector3(w, hp, tk * 3));
    const m = mat(base, new THREE.Euler(0, yaw, tilt));
    g.applyMatrix4(m);
    const center = new THREE.Vector3(0, hp, 0).applyMatrix4(m);
    paint(P.add(g, col, { sway: 0.15 }), (c, x, y, z) => {
      c.copy(dark).lerp(light, smoothstep(-hp, hp * 1.2, y - center.y + (depth ? 0.3 : 0)));
    });
    const kids = depth < 2 ? rng.int(1, 2) : 0;
    for (let k = 0; k < kids; k++) {
      const a = rng.range(0.25, 0.75) * Math.PI;
      const at = new THREE.Vector3(Math.cos(a) * w * 0.8, hp + Math.sin(a) * hp * 0.8, 0).applyMatrix4(m);
      // lean away from the parent's middle
      pad(at, yaw + rng.range(-1, 1), tilt + rng.range(0.1, 0.5) * (Math.cos(a) > 0 ? -1 : 1), size * rng.range(0.7, 0.85), depth + 1);
    }
    if (!kids) tops.push(new THREE.Vector3(0, hp * 2, 0).applyMatrix4(m));
  };
  const n = rng.int(1, 2);
  for (let i = 0; i < n; i++) pad(new THREE.Vector3(rng.range(-0.3, 0.3), -0.15, rng.range(-0.3, 0.3)), rng.range(0, Math.PI * 2), rng.range(-0.3, 0.3), rng.range(0.55, 0.75), 0);
  for (const t of tops) {
    const k = rng.int(1, 3);
    for (let i = 0; i < k; i++) {
      const g = new THREE.IcosahedronGeometry(0.09, 0);
      g.scale(1, 1.35, 1);
      const p = t.clone().add(new THREE.Vector3(rng.range(-0.15, 0.15), rng.range(-0.1, 0.02), rng.range(-0.15, 0.15)));
      g.translate(p.x, p.y, p.z);
      bendNormals(g, p, 0.8);
      P.add(g, fruitCol, { glow: 0.4, sway: 0.15 });
    }
  }
  return tops;
}

// ribbed lantern hanging below p, with a leafy cap
function lantern(P, p, lr, ribs, drop, glowCol, capCol, glow) {
  const sides = ribs * 2;
  const g = lathe([[0, 0], [lr * 0.5, -lr * 0.12], [lr * 0.95, -lr * 0.7], [lr * 0.88, -lr * (1.3 + 0.2 * drop)], [lr * 0.42, -lr * (1.75 + 0.45 * drop)], [0, -lr * (1.95 + 0.6 * drop)]], sides, {
    shape: (i, j) => (i > 0 && i < 5 && j % 2 ? 0.84 : 1),
    tag: true,
  });
  g.translate(p.x, p.y - lr * 0.15, p.z);
  const bright = tint(glowCol, 1.15);
  const deep = tint(glowCol, 0.7, COOL, 0.1);
  paint(P.add(g, glowCol, { sway: 1 }), (c, x, y, z, ny, u, v) => {
    const rib = Math.round(v * sides) % 2 === 0;
    const mid = Math.sin(Math.PI * u);
    c.copy(deep).lerp(bright, (rib ? 0.85 : 0.4) * mid + 0.1);
    return glow * (rib ? 1.8 : 1.3) * (0.6 + 0.4 * mid);
  });
  const cap = lathe([[0, lr * 0.3], [lr * 0.5, lr * 0.02], [lr * 0.78, -lr * 0.38]], ribs, { shape: (i, j) => (i === 2 && j % 2 ? 0.6 : 1), rot: 0.3 });
  cap.translate(p.x, p.y - lr * 0.12, p.z);
  P.add(cap, capCol, { sway: 1 });
}

// One mushroom: stalk, cap by style (0 parasol, 1 dome, 2 bell, 3 funnel),
// glowing gills underneath, spots or bands on top. Built at the origin and
// moved to o.at.
function fungus(rng, P, o) {
  const { R, h, r0, style } = o;
  const add = (g, col, opts) => {
    g.translate(o.at.x, o.at.y, o.at.z);
    return P.add(g, col, opts);
  };
  const s = stem(rng, h, r0, r0 * 0.75, o.bend, { sides: 8, segs: 6, flare: 1.3 });
  bark(add(s.geo, o.stalkCol, { sway: 0.2 }), o.stalkCol, h);
  const rs = r0 * 0.78;
  const prof =
    style === 2 ? [[0, R * 1.05], [R * 0.3, R * 0.92], [R * 0.68, R * 0.45], [R * 0.95, R * 0.02], [R, -R * 0.1], [R * 0.82, -R * 0.08], [rs, R * 0.25]]
    : style === 3 ? [[0, R * 0.08], [R * 0.4, R * 0.16], [R * 0.78, R * 0.34], [R, R * 0.5], [R * 0.94, R * 0.42], [R * 0.55, R * 0.08], [rs, -R * 0.06]]
    : style === 1 ? [[0, R * 0.62], [R * 0.45, R * 0.55], [R * 0.8, R * 0.32], [R, R * 0.04], [R * 0.9, -R * 0.08], [R * 0.5, -R * 0.05], [rs, 0]]
    : [[0, R * 0.4], [R * 0.22, R * 0.36], [R * 0.6, R * 0.24], [R * 0.93, R * 0.06], [R, -R * 0.03], [R * 0.9, -R * 0.07], [rs, 0]];
  // the cap follows the stalk's lean a little
  const T = s.curve.getTangentAt(1);
  const M = mat(s.top.clone().addScaledVector(T, -0.1), null, 1);
  M.multiply(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, UP.clone().lerp(T, 0.6).normalize())));
  const wavy = style === 0 || style === 3 ? rng.range(0.065, 0.11) : 0.035;
  const rotation = rng.range(0, 1);
  const cap = lathe(prof, 16, { tag: true, rot: rotation, shape: (i, j) => {
    const a = j / 16 * Math.PI * 2 + rotation;
    return 1 + Math.sin(a * 5 + 0.4) * wavy * (i >= 3 && i <= 5 ? 1 : 0.35);
  } });
  cap.applyMatrix4(M);
  const c0 = tint(o.capCol, 0.72, COOL, 0.05);
  const c1 = tint(o.capCol2, 1.02, WARM, 0.08);
  const under = tint(o.glowCol, 0.8, COOL, 0.1).lerp(o.stalkCol, 0.2);
  const bands = o.bands;
  paint(add(cap, o.capCol, { sway: 0.3 }), (c, x, y, z, ny, u, v) => {
    if (u > 0.7) {
      c.copy(under);
      return o.glow;
    }
    // the lip glows too, so the cap reads as a lit ring from the side at night
    if (u > 0.6) {
      c.copy(c1).lerp(o.glowCol, 0.6);
      return o.glow * 0.9;
    }
    const t = u / 0.667;
    c.copy(c0).lerp(c1, bands ? Math.round(u * 6) % 2 : t);
    c.multiplyScalar((0.85 + 0.15 * smoothstep(-0.5, 1, ny)) * (0.94 + 0.06 * Math.cos(v * Math.PI * 16)));
    return 0;
  });
  // gills: one fin per wedge, from the stalk out to the rim
  const [ri, yi] = prof[6];
  const [ro, yo] = prof[5];
  const gills = [];
  const nG = 20;
  for (let j = 0; j < nG; j++) {
    const a = (j / nG) * Math.PI * 2;
    const x = Math.cos(a), z = Math.sin(a);
    const scallop = 1 + Math.sin(a * 5 + 0.4) * wavy;
    const rm = ri + (ro - ri) * 0.55, ym = yi + (yo - yi) * 0.55 - R * (j % 2 ? 0.07 : 0.13);
    const edge = ro * 0.97 * scallop;
    gills.push(x * ri, yi - 0.02, z * ri, x * edge, yo - 0.02, z * edge, x * rm, ym, z * rm);
  }
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(gills, 3));
  gg.computeVertexNormals();
  bendNormals(gg, new THREE.Vector3(0, 50, 0), 0.7);
  gg.applyMatrix4(M);
  add(gg, o.glowCol, { glow: 1.8 * o.glow, sway: 0.3 });
  if (o.spots) {
    const n = rng.int(6, 10);
    const spotCol = o.spotGlow ? o.glowCol : tint(o.capCol2, 1.7);
    for (let i = 0; i < n; i++) {
      const f = rng.range(0.3, 3.3);
      const i0 = Math.floor(f);
      const k = f - i0;
      const [ra, ya] = prof[i0];
      const [rb, yb] = prof[i0 + 1];
      const r = ra + (rb - ra) * k, y = ya + (yb - ya) * k;
      const nl = Math.hypot(rb - ra, yb - ya);
      const a = rng.range(0, Math.PI * 2);
      const nrm = new THREE.Vector3(Math.cos(a) * (ya - yb) / nl, (rb - ra) / nl, Math.sin(a) * (ya - yb) / nl);
      const sr = R * rng.range(0.09, 0.15);
      const g = new THREE.IcosahedronGeometry(sr, 0);
      g.scale(1, 0.35, 1);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, nrm));
      g.translate(Math.cos(a) * r, y, Math.sin(a) * r);
      bendNormals(g, new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r).addScaledVector(nrm, -sr), 0.6);
      g.applyMatrix4(M);
      add(g, spotCol, { glow: o.spotGlow ? 1.2 * o.glow : 0.1, sway: 0.3 });
    }
  }
  if (o.veil) {
    // lacy skirt hanging from under the cap, glows faintly at night
    const g = lathe([[rs * 1.3, yi - 0.05], [R * 0.36, yi - h * 0.3], [R * 0.46, yi - h * 0.55]], 12, { shape: (i, j) => (i === 2 ? (j % 2 ? 1.12 : 0.9) : 1) });
    g.applyMatrix4(M);
    add(g, tint(o.glowCol, 1.2).lerp(new THREE.Color('#ffffff'), 0.4), { glow: 0.6 * o.glow, sway: 0.3 });
  } else if (o.ring) {
    const at = s.curve.getPointAt(0.72);
    const r = r0 * 0.85;
    const g = lathe([[r, 0], [r * 1.8, -0.22], [r * 1.7, -0.3]], 10);
    g.translate(at.x, at.y, at.z);
    add(g, tint(o.stalkCol, 1.05), { sway: 0.2 });
  }
  return h + R * (style === 2 ? 1 : 0.6);
}

const BUILDERS = {
  tree(rng, sp, P) {
    const col = jitter(rng, sp.palette.trunk);
    const leafCol = jitter(rng, sp.palette.leaf[rng.int(0, 2)]);
    if (sp.style === 1) return treeFir(rng, sp, P, col, leafCol);
    if (sp.style === 2) return treeUmbrella(rng, sp, P, col, leafCol);
    if (sp.style === 3) return treeWeeping(rng, sp, P, col, leafCol);
    return treeBroad(rng, sp, P, col, leafCol);
  },

  palm(rng, sp, P) {
    const o = {
      h: rng.range(5, 8),
      bend: rng.range(0.8, 2.4),
      dir: rng.range(0, Math.PI * 2),
      r0: rng.range(0.19, 0.26),
      col: jitter(rng, sp.palette.trunk),
      leafCol: jitter(rng, sp.palette.leaf[rng.int(0, 2)]),
      fronds: rng.int(8, 10),
      len: rng.range(3.0, 4.2),
      droop: rng.range(1.3, 2.3),
      lift: rng.range(0.5, 1.1),
      width: rng.range(0.6, 0.85),
      // style 2 gets broad smooth leaves, the rest are cut into leaflets
      serr: sp.style === 2 ? 0.12 : rng.range(0.3, 0.55),
      nutCol: rng.chance(0.35) ? jitter(rng, sp.palette.glow, 0.04) : null,
      rings: 11,
      segs: 9,
    };
    palmOne(rng, P, o);
    // style 3 is a pair leaning apart, the second one smaller and plainer
    if (sp.style === 3) palmOne(rng, P, { ...o, h: o.h * rng.range(0.6, 0.78), dir: o.dir + Math.PI + rng.range(-0.6, 0.6), bend: o.bend * rng.range(0.9, 1.3), fronds: 6, rings: 9, segs: 7 });
    return o.h;
  },

  icetree(rng, sp, P) {
    const h = rng.range(4, 6.5);
    const r0 = rng.range(0.2, 0.3);
    const deep = tint(jitter(rng, sp.palette.trunk, 0.05), 1.2);
    const ice = jitter(rng, sp.palette.leaf[rng.int(0, 2)], 0.05);
    const frost = tint(ice, 1.4);
    const glow = rng.range(0.35, 0.8);
    // deep at the root of each crystal, frosty and glowing toward the tip
    const crystal = (g, from, to, gk = 1) =>
      paint(g, (c, x, y, z, ny, u) => {
        c.copy(from).lerp(to, u);
        return glow * gk * u * u;
      });
    const spike = (a, b, r, sides = 5) => limb([a, a.clone().lerp(b, 0.5), b], (t) => r * (1 - 0.25 * t), sides, 1, { flat: true, tip: 2.4, tag: true });
    const lean = new THREE.Vector3(rng.range(-0.3, 0.3), 0, rng.range(-0.3, 0.3));
    const axis = (y) => new THREE.Vector3(lean.x * (y / h) ** 2, y, lean.z * (y / h) ** 2);
    crystal(P.add(limb([axis(-0.4), axis(h * 0.5), axis(h)], (t) => r0 * (1 - 0.6 * t), 6, 3, { flat: true, twist: rng.range(-0.6, 0.6), tip: 2.5, tag: true }), ice, { sway: 0.2 }), deep, ice, 0.4);
    const top = axis(h);
    crystal(P.add(spike(top.clone().add(new THREE.Vector3(0, -0.4, 0)), top.clone().add(new THREE.Vector3(lean.x * 0.3, rng.range(0.8, 1.2), lean.z * 0.3)), 0.24, 6), ice, { sway: 0.3 }), ice, frost);
    const style = sp.style;
    if (style === 2) {
      // coral: forking crystal limbs
      const grow = (a, d, len, r, depth) => {
        const b = a.clone().addScaledVector(d, len);
        crystal(P.add(spike(a, b, r), ice, { sway: 0.2 + depth * 0.1 }), tint(ice, 0.75), frost);
        if (depth >= 2) return;
        const kids = rng.int(2, 3);
        for (let k = 0; k < kids; k++) {
          const nd = d.clone().add(new THREE.Vector3(rng.range(-0.8, 0.8), rng.range(0, 0.5), rng.range(-0.8, 0.8))).normalize();
          grow(a.clone().lerp(b, rng.range(0.55, 0.85)), nd, len * rng.range(0.55, 0.7), r * 0.7, depth + 1);
        }
      };
      const n = rng.int(2, 3);
      const a0 = rng.range(0, Math.PI * 2);
      for (let i = 0; i < n; i++) {
        const a = a0 + (i / n) * Math.PI * 2;
        grow(axis(h * rng.range(0.45, 0.65)), new THREE.Vector3(Math.cos(a), rng.range(0.8, 1.4), Math.sin(a)).normalize(), rng.range(1.5, 2.2), 0.14, 0);
      }
    } else if (style === 3) {
      // frozen parasol: a crystal plate with icicles hanging off the rim
      const R = rng.range(1.5, 2.2);
      const plate = lathe([[0, 0.45], [R * 0.6, 0.25], [R, 0], [R * 0.85, -0.2], [0, -0.1]], 6, { flat: true, tag: true, rot: rng.range(0, 1) });
      plate.translate(top.x, top.y - 0.3, top.z);
      crystal(P.add(plate, ice, { sway: 0.3 }), ice, frost, 0.6);
      const n = rng.int(8, 11);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng.range(-0.2, 0.2);
        const rr = R * rng.range(0.55, 0.85);
        const a0 = top.clone().add(new THREE.Vector3(Math.cos(a) * rr, -0.3, Math.sin(a) * rr));
        crystal(P.add(spike(a0, a0.clone().add(new THREE.Vector3(0, -rng.range(0.6, 1.5), 0)), 0.08 + rng.range(0, 0.05), 4), ice, { sway: 0.3 }), ice, frost, 1.2);
      }
    } else {
      // crystal fir: whorls of spikes angled up
      const whorls = rng.int(4, 5);
      const per = rng.int(5, 7);
      const L0 = rng.range(1.4, 2.2);
      const rise = rng.range(0.35, 0.85);
      for (let w = 0; w < whorls; w++) {
        const k = w / whorls;
        const y = h * (0.3 + 0.62 * k);
        const len = L0 * (1 - 0.6 * k);
        for (let i = 0; i < per; i++) {
          const a = w * 0.7 + (i / per) * Math.PI * 2 + rng.range(-0.2, 0.2);
          const el = rise + rng.range(-0.15, 0.15);
          const a0 = axis(y);
          const d = new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
          crystal(P.add(spike(a0, a0.clone().addScaledVector(d, len), 0.1 + 0.08 * (1 - k)), ice, { sway: 0.2 }), tint(ice, 0.6, COOL, 0.1), frost);
        }
      }
    }
    const nb = rng.int(2, 4);
    for (let i = 0; i < nb; i++) {
      const a = rng.range(0, Math.PI * 2);
      const b = new THREE.Vector3(Math.cos(a) * r0 * 1.5, -0.3, Math.sin(a) * r0 * 1.5);
      const tip = b.clone().add(new THREE.Vector3(Math.cos(a) * 0.4, rng.range(0.5, 0.9), Math.sin(a) * 0.4));
      crystal(P.add(spike(b, tip, rng.range(0.08, 0.13), 4), ice, { sway: 0 }), deep, frost, 0.6);
    }
    return h + 1;
  },

  deadtree(rng, sp, P) {
    const burnt = sp.planetType === 'volcanic';
    const h = rng.range(3.2, 5.8);
    const r0 = rng.range(0.2, 0.3);
    const base = jitter(rng, sp.palette.trunk, 0.05);
    // desert husks are sun bleached, volcanic ones charred with embers in the cracks
    const col = burnt ? base : base.clone().lerp(new THREE.Color(sp.palette.sand), 0.5);
    const ember = jitter(rng, sp.palette.glow, 0.03);
    const seed = rng.range(0, 100);
    const low = tint(col, 0.5, COOL, 0.1);
    const high = tint(col, burnt ? 1.5 : 1.25, WARM, 0.08);
    const husk = (g, tips) =>
      paint(g, (c, x, y, z, ny, u, v) => {
        c.copy(low).lerp(col, smoothstep(-0.4, 1.2, y)).lerp(high, smoothstep(1, h, y) * 0.5);
        if (!burnt) return;
        const n = Math.sin(u * 23.7 + v * 61.3 + seed) * 43758.5453;
        const hot = Math.max(smoothstep(0.82, 0.96, n - Math.floor(n)), tips ? smoothstep(0.75, 1, u) : 0);
        c.lerp(ember, hot * 0.85);
        return hot * 1.4;
      });
    const s = stem(rng, h, r0, r0 * 0.3, rng.range(0.2, 0.9), { wobble: 0.28, tip: 1.5, tag: true, flare: 1 });
    husk(P.add(s.geo, col, { sway: 0.2 }), true);
    roots(rng, P, rng.int(3, 5), r0, col, (g) => husk(g, false));
    const twig = (start, dir, len, r, depth) => {
      const side = new THREE.Vector3(rng.range(-1, 1), rng.range(-0.3, 0.5), rng.range(-1, 1)).multiplyScalar(len * 0.25);
      const mid = start.clone().addScaledVector(dir, len * 0.5).addScaledVector(side, 0.5);
      const end = start.clone().addScaledVector(dir, len).add(side);
      const curve = new THREE.CatmullRomCurve3([start, mid, end]);
      husk(P.add(limb(curve, (t) => r * (1 - 0.6 * t), depth ? 4 : 5, depth ? 2 : 3, { tip: 1.5, tag: true }), col, { sway: 0.4 + depth * 0.3 }), true);
      if (depth >= 2) return;
      const kids = rng.int(depth ? 0 : 1, 2);
      for (let k = 0; k < kids; k++) {
        const t = rng.range(0.45, 0.8);
        const nd = dir.clone().add(new THREE.Vector3(rng.range(-0.9, 0.9), rng.range(0.1, 0.6), rng.range(-0.9, 0.9))).normalize();
        twig(curve.getPointAt(t), nd, len * rng.range(0.45, 0.65), r * (1 - 0.6 * t) * 0.75, depth + 1);
      }
    };
    const nb = rng.int(2, 4);
    const a0 = rng.range(0, Math.PI * 2);
    for (let i = 0; i < nb; i++) {
      const a = a0 + (i / nb) * Math.PI * 2 + rng.range(-0.4, 0.4);
      const t = rng.range(0.45, 0.85);
      const dir = new THREE.Vector3(Math.cos(a), rng.range(0.5, 1.3), Math.sin(a)).normalize();
      twig(s.curve.getPointAt(t), dir, rng.range(1.2, 2.2), r0 * (1 - 0.7 * t) * 0.8, 0);
    }
    return h;
  },

  twisttree(rng, sp, P) {
    const style = sp.style;
    const col = jitter(rng, sp.palette.trunk);
    const leafCol = jitter(rng, sp.palette.leaf[rng.int(0, 2)]);
    const glowCol = jitter(rng, sp.palette.glow, 0.04);
    const h = rng.range(4, 6.2);
    const k = rng.int(2, 3);
    const turns = rng.range(0.6, 1.3) * (rng.chance(0.5) ? 1 : -1);
    const rh = rng.range(0.14, 0.24);
    const rs = rng.range(0.11, 0.15);
    // style 2 bows the strands out into a cage around a glowing core
    const cage = style === 2;
    const splay = cage ? rng.range(0.8, 1.15) : rng.range(0.9, 1.6);
    const lean = new THREE.Vector3(rng.range(-0.6, 0.6), 0, rng.range(-0.6, 0.6));
    const curves = [];
    const ends = [];
    for (let s = 0; s < k; s++) {
      const pts = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const a = (s / k) * Math.PI * 2 + t * turns * Math.PI * 2;
        const bulge = cage ? splay * Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.55) / 0.45))) : splay * Math.max(0, (t - 0.65) / 0.35) ** 2;
        const rad = rh * (1 + 1.4 * Math.max(0, 1 - t / 0.15)) + bulge;
        pts.push(new THREE.Vector3(Math.cos(a) * rad + lean.x * t * t, -0.4 + (h + 0.4) * t, Math.sin(a) * rad + lean.z * t * t));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      bark(P.add(limb(curve, (t) => rs * (1 - 0.45 * t) * (1 + 0.6 * Math.max(0, 1 - t / 0.12)), 5, 9), col, { sway: 0.5 }), col, h);
      curves.push(curve);
      ends.push(pts[8]);
    }
    const C = new THREE.Vector3();
    for (const e of ends) C.add(e);
    C.divideScalar(k);
    if (cage) {
      const core = new THREE.Vector3(lean.x * 0.6, -0.4 + (h + 0.4) * 0.78, lean.z * 0.6);
      const g = lumpy(rng, splay * 0.55, 1, 0.12);
      g.translate(core.x, core.y, core.z);
      bendNormals(g, core, 0.8);
      paint(P.add(g, glowCol, { sway: 0.6 }), (c, x, y) => {
        c.copy(glowCol).multiplyScalar(0.8 + 0.3 * smoothstep(core.y - splay * 0.5, core.y + splay * 0.5, y));
        return 1.3;
      });
      const cap = lumpy(rng, 0.55, 1, 0.15, new THREE.Vector3(1, 0.7, 1));
      cap.translate(C.x, C.y + 0.2, C.z);
      bendNormals(cap, C, 0.6);
      foliage(P.add(cap, leafCol, { sway: 1 }), C, 0.6, 0.45, leafCol);
    } else {
      // style 3 ends in flat bonsai pads, the others in round puffs
      const flat = style === 3;
      const st = flat ? new THREE.Vector3(1, 0.42, 1) : null;
      const R = splay + 0.9;
      const Cc = C.clone().add(new THREE.Vector3(0, 0.3, 0));
      const puffs = ends.map((e) => {
        const out = e.clone().sub(C).setY(0).normalize();
        return [e.clone().addScaledVector(out, 0.25).add(new THREE.Vector3(0, flat ? 0.15 : 0.35, 0)), rng.range(0.75, 1.05) * (flat ? 1.3 : 1)];
      });
      if (k === 2 && !flat) puffs.push([Cc.clone().add(new THREE.Vector3(0, 0.45, 0)), rng.range(0.7, 0.9)]);
      puffs.forEach(([pos, r], i) => {
        const g = crown(rng, r, st, i === 0);
        g.translate(pos.x, pos.y, pos.z);
        bendNormals(g, pos, 0.6, flat ? new THREE.Vector3(1, 0.5, 1) : null);
        foliage(P.add(g, leafCol, { sway: 1 }), Cc, R, flat ? R * 0.5 : R, leafCol);
      });
    }
    const m = rng.int(3, 6);
    for (let i = 0; i < m; i++) {
      const p = curves[i % k].getPointAt(rng.range(0.15, 0.85));
      p.add(new THREE.Vector3(rng.range(-1, 1), rng.range(-0.3, 0.3), rng.range(-1, 1)).normalize().multiplyScalar(rs * 0.8));
      const g = new THREE.OctahedronGeometry(rng.range(0.09, 0.15), 0);
      g.translate(p.x, p.y, p.z);
      bendNormals(g, p, 0.8);
      P.add(g, glowCol, { glow: 1.1, sway: 0.5 });
    }
    return h + 1.2;
  },

  spiraltree(rng, sp, P) {
    const col = jitter(rng, sp.palette.trunk);
    const cols = [0, 1, 2].map((i) => jitter(rng, sp.palette.leaf[i]));
    const glowCol = jitter(rng, sp.palette.glow, 0.04);
    const glowy = rng.chance(0.55);
    const h = rng.range(4.5, 7.5);
    const r0 = rng.range(0.17, 0.24);
    const a = rng.range(0, Math.PI * 2);
    const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const o1 = new THREE.Vector3(rng.range(-0.4, 0.4), 0, rng.range(-0.4, 0.4));
    const o2 = new THREE.Vector3(rng.range(-0.4, 0.4), 0, rng.range(-0.4, 0.4));
    const rise = [new THREE.Vector3(0, -0.4, 0), new THREE.Vector3(o1.x, h * 0.35, o1.z), new THREE.Vector3(o2.x, h * 0.7, o2.z), new THREE.Vector3(o2.x * 0.5, h, o2.z * 0.5)];
    // the top curls over into a fiddlehead
    const cr = rng.range(0.35, 0.6);
    const Q = rise[3].clone().addScaledVector(d, cr);
    const curl = [];
    for (let i = 1; i <= 6; i++) {
      const s = i / 6;
      const phi = Math.PI - s * 2.2 * Math.PI;
      const rr = cr * (1 - 0.65 * s);
      curl.push(Q.clone().addScaledVector(d, Math.cos(phi) * rr).add(new THREE.Vector3(0, Math.sin(phi) * rr, 0)));
    }
    const curve = new THREE.CatmullRomCurve3([...rise, ...curl]);
    bark(P.add(limb(curve, (t) => r0 * (1 - 0.75 * t) * (1 + 0.8 * Math.max(0, 1 - t / 0.1) ** 2), 5, 14, { tip: 1.5 }), col, { sway: 0.5 }), col, h);
    if (glowy) {
      const p = curl[5];
      const g = new THREE.IcosahedronGeometry(0.14, 0);
      g.translate(p.x, p.y, p.z);
      bendNormals(g, p, 0.8);
      P.add(g, glowCol, { glow: 1.3 });
    }
    // pads spaced on the golden angle
    const trunkCurve = new THREE.CatmullRomCurve3(rise);
    const n = rng.int(8, 12);
    const Rp = rng.range(1.2, 1.7);
    // bowls or little parasols
    const cup = rng.chance(0.5) ? rng.range(0.2, 0.4) : rng.range(-0.35, -0.2);
    const tilt = rng.range(-0.3, 0.2);
    const a0 = rng.range(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const rp = Rp * (1 - 0.55 * k);
      const b = a0 + i * 2.39996;
      const at = trunkCurve.getPointAt(0.25 + 0.68 * k);
      const pad = lathe([[0, rp * (0.12 + Math.max(0, -cup) * 0.6)], [rp * 0.55, rp * (0.13 + cup * 0.35)], [rp, rp * cup], [0, -rp * 0.12]], 10, { flat: true, tag: true, shape: (j, q) => (j === 2 && q % 2 ? 0.88 : 1) });
      pad.rotateZ(tilt);
      pad.rotateY(-b);
      const c = at.clone().add(new THREE.Vector3(Math.cos(b) * rp * 0.95, 0, Math.sin(b) * rp * 0.95));
      pad.translate(c.x, c.y, c.z);
      bendNormals(pad, c.clone().add(new THREE.Vector3(0, -rp, 0)), 0.5);
      const base = cols[i % 3];
      const dark = tint(base, 0.6, COOL, 0.12);
      const light = tint(base, 1.25, WARM, 0.08);
      paint(P.add(pad, base, { sway: 1 }), (cc, x, y, z, ny, u) => {
        // u runs top pole, inner ring, rim, bottom pole
        const rim = u > 0.9 ? 0 : u * 1.5;
        cc.copy(dark).lerp(light, rim * 0.75 + smoothstep(-0.5, 1, ny) * 0.25);
        if (!glowy) return;
        const g = smoothstep(0.8, 1, rim);
        cc.lerp(glowCol, g * 0.7);
        return g * 0.9;
      });
    }
    return h + cr * 2;
  },

  bulbtree(rng, sp, P) {
    const col = jitter(rng, sp.palette.trunk);
    const leafCol = jitter(rng, sp.palette.leaf[rng.int(0, 2)]);
    const glowCol = jitter(rng, sp.palette.glow, 0.04);
    // style 0 is one big lantern on an arching trunk, the rest branch out
    const n = sp.style === 0 ? 1 : rng.int(2, 4);
    const ribs = n > 2 ? 5 : rng.int(5, 6);
    const drop = rng.range(0.4, 1.2);
    const r0 = rng.range(0.15, 0.2);
    const hangs = [];
    let h;
    if (n === 1) {
      h = rng.range(3.6, 5);
      const reach = rng.range(1.2, 1.9);
      const a = rng.range(0, Math.PI * 2);
      const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const at = (out, y) => d.clone().multiplyScalar(out).setY(y);
      const pts = [at(0, -0.4), at(0.1, h * 0.4), at(reach * 0.35, h * 0.85), at(reach * 0.8, h + 0.35), at(reach * 1.15, h - 0.15)];
      bark(P.add(limb(pts, (t) => r0 * 1.2 * (1 - 0.55 * t) * (1 + 0.8 * Math.max(0, 1 - t / 0.15) ** 2), 6, 9, { ease: 1.2 }), col, { sway: 0.5 }), col, h);
      hangs.push([pts[4], rng.range(0.8, 1.0)]);
    } else {
      h = rng.range(3.8, 5);
      const s = stem(rng, h, r0 * 1.1, r0 * 0.6, rng.range(0.1, 0.6));
      bark(P.add(s.geo, col, { sway: 0.5 }), col, h);
      const a0 = rng.range(0, Math.PI * 2);
      for (let i = 0; i < n; i++) {
        const a = a0 + (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
        const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        const L = rng.range(1.0, 1.7);
        const start = s.curve.getPointAt(rng.range(0.65, 0.95));
        const pts = [start, start.clone().addScaledVector(d, 0.35 * L).setY(start.y + 0.55 * L), start.clone().addScaledVector(d, 0.85 * L).setY(start.y + 0.65 * L), start.clone().addScaledVector(d, 1.1 * L).setY(start.y + 0.35 * L)];
        bark(P.add(limb(pts, (t) => r0 * 0.6 * (1 - 0.45 * t), 5, 5), col, { sway: 0.7 }), col, h);
        hangs.push([pts[3], rng.range(0.5, 0.65)]);
      }
      const bud = new THREE.IcosahedronGeometry(0.16, 0);
      bud.translate(s.top.x, s.top.y + 0.1, s.top.z);
      bendNormals(bud, s.top, 0.8);
      P.add(bud, glowCol, { glow: 1.2 * sp.glow });
    }
    for (const [p, lr] of hangs) lantern(P, p, lr, ribs, drop, glowCol, tint(leafCol, 0.9), sp.glow);
    const leaves = rng.int(3, 5);
    const b0 = rng.range(0, Math.PI * 2);
    const dark = tint(leafCol, 0.55, COOL, 0.1);
    const light = tint(leafCol, 1.25, WARM, 0.1);
    for (let i = 0; i < leaves; i++) {
      const b = b0 + (i / leaves) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const d = new THREE.Vector3(Math.cos(b), 0, Math.sin(b));
      const L = rng.range(0.9, 1.4);
      const pts = [d.clone().multiplyScalar(0.1).setY(0.05), d.clone().multiplyScalar(0.45 * L).setY(0.45 * L), d.clone().multiplyScalar(0.95 * L).setY(0.4 * L), d.clone().multiplyScalar(1.3 * L).setY(0)];
      const g = ribbon(pts, (t) => 0.55 * L * Math.sin(Math.PI * Math.min(1, 0.08 + t)) ** 0.7, 4, 0.3, UP);
      paint(P.add(g, leafCol, { sway: 0.3 }), (c, x, y) => {
        c.copy(dark).lerp(light, smoothstep(0, 0.5 * L, y));
      });
    }
    return h + 0.6;
  },

  shrub(rng, sp, P) {
    const leaf = sp.palette.leaf;
    const glow = sp.glow > 0.5;
    const style = sp.style;
    const dark = jitter(rng, leaf[0]).multiplyScalar(0.75);
    const light = jitter(rng, leaf[2]).lerp(new THREE.Color('#ffffff'), 0.15);
    // Shrubs are the first carbon players go looking for, so every style
    // covers about as much ground and stands as tall as the leafy dome.
    if (style === 1) {
      // rosette, two whorls of broad folded leaves, the inner ones more upright
      const n = rng.int(12, 14);
      for (let i = 0; i < n; i++) {
        const inner = i >= n * 0.5;
        const a = i * 2.39996 + rng.range(-0.2, 0.2);
        const len = rng.range(1.0, 1.3) * (inner ? 0.85 : 1);
        const g = P.add(leafStrip(len, rng.range(0.26, 0.33), inner ? rng.range(2.4, 3.0) : rng.range(1.3, 1.7), inner ? rng.range(1.3, 1.6) : rng.range(1.1, 1.4), 3, 0.35), leaf[i % 3], { matrix: qmat(new THREE.Vector3(0, 0.04, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a, rng.range(-0.1, 0.15)))) });
        const tip = glow ? new THREE.Color(sp.palette.glow).lerp(light, 0.3) : light;
        ramp(g, [[0, dark, 0], [0.5, jitter(rng, leaf[i % 3]), 0], [1, tip, glow ? 0.9 : 0]]);
      }
      P.add(new THREE.OctahedronGeometry(0.1, 0), glow ? sp.palette.glow : light, { matrix: mat(new THREE.Vector3(0, 0.25, 0), null, new THREE.Vector3(1, 1.6, 1)), glow: glow ? 2 : 0 });
      return 1;
    }
    if (style === 2) {
      // fern, arching fronds with notched edges around a few young upright ones
      const n = rng.int(9, 10);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
        const g = P.add(leafStrip(rng.range(1.15, 1.5), rng.range(0.27, 0.33), rng.range(2.1, 2.6), rng.range(1.8, 2.3), 5, 0.15, 0.5), leaf[i % 3], { matrix: qmat(new THREE.Vector3(0, 0.02, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a, 0))), sway: 1.2 });
        ramp(g, [[0, dark, 0], [0.55, jitter(rng, leaf[i % 3]), 0], [1, glow ? new THREE.Color(sp.palette.glow) : light, glow ? 0.8 : 0]]);
      }
      for (let i = 0; i < 3; i++) {
        const g = P.add(leafStrip(rng.range(0.6, 0.8), 0.16, rng.range(2.8, 3.4), rng.range(1.6, 2.0), 3, 0.3), leaf[2], { matrix: qmat(new THREE.Vector3(0, 0.02, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (i / 3) * Math.PI * 2 + rng.range(-0.4, 0.4), 0))) });
        ramp(g, [[0, dark, 0], [1, light, glow ? 0.5 : 0]]);
      }
      return 1;
    }
    if (style === 3) {
      // puff shrub, soft balls on thin stems
      const n = 6;
      for (let i = 0; i < n; i++) {
        const a = i * 2.39996 + rng.range(-0.3, 0.3);
        const out = rng.range(0.2, 0.55);
        const h = rng.range(0.55, 1.05);
        const end = new THREE.Vector3(Math.cos(a) * out, h, Math.sin(a) * out);
        const stem = sweepTube([new THREE.Vector3(), new THREE.Vector3(Math.cos(a) * out * 0.3, h * 0.5, Math.sin(a) * out * 0.3), end], 0.035, 0.018, 3);
        ramp(P.add(stem, sp.palette.trunk), [[0, jitter(rng, sp.palette.trunk).multiplyScalar(0.7)], [1, jitter(rng, sp.palette.trunk)]]);
        const r = rng.range(0.3, 0.4);
        const g = P.add(lumpy(rng, r, 0, 0.12), leaf[i % 3], { matrix: mat(end.clone().add(new THREE.Vector3(0, r * 0.6, 0)), null, new THREE.Vector3(1, 0.85, 1)) });
        softenNormals(g, end.clone().add(new THREE.Vector3(0, r * 0.4, 0)), 0.65);
        ramp(g, [[0, jitter(rng, leaf[i % 3]).multiplyScalar(0.8), glow ? 0.5 : 0], [1, light, glow ? 0.1 : 0]]);
      }
      return 1.1;
    }
    // bush, a dome of soft leaf clumps with berries
    const n = rng.int(7, 9);
    const R = rng.range(0.65, 0.85);
    const blobs = [];
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996 + rng.range(-0.3, 0.3);
      const e = i === 0 ? Math.PI / 2 : rng.range(0.1, 1.0);
      const r = rng.range(0.32, 0.45) * (i === 0 ? 1.3 : 1);
      const c = new THREE.Vector3(Math.cos(a) * Math.cos(e) * R, Math.sin(e) * R * 0.85 + 0.12, Math.sin(a) * Math.cos(e) * R);
      blobs.push([c, r]);
      const g = P.add(lumpy(rng, r, 0, 0.15), leaf[i % 3], { matrix: mat(c, new THREE.Euler(rng.range(0, 3), rng.range(0, 3), 0)) });
      softenNormals(g, c, 0.9);
      // clumps low in the dome are darker, they sit in the bush's own shade
      const shade = 0.85 + 0.15 * Math.min(1, e);
      ramp(g, [[0, dark.clone().multiplyScalar(shade * 1.2), 0], [1, jitter(rng, leaf[i % 3]).lerp(light, 0.5).multiplyScalar(shade), 0]]);
      for (let j = 0; j < 2; j++) {
        const d = new THREE.Vector3(Math.cos(a + j * 1.4), 0.38, Math.sin(a + j * 1.4)).normalize();
        const at = c.clone().addScaledVector(d, r * 0.6);
        const tip = c.clone().addScaledVector(d, r * 1.6);
        tip.y += r * 0.2;
        ramp(P.add(foldedLeaf(at, tip, r * 0.22), leaf[i % 3]), [[0, dark], [0.45, leaf[i % 3]], [1, light]]);
      }
    }
    const berries = rng.int(4, 6);
    const bc = glow ? sp.palette.glow : jitter(rng, leaf[2]).lerp(new THREE.Color('#fff4e0'), 0.6);
    for (let i = 0; i < berries; i++) {
      const [c, r] = blobs[1 + (i % (blobs.length - 1))];
      const a = rng.range(0, Math.PI * 2), e = rng.range(0.2, 1.1);
      const p = c.clone().add(new THREE.Vector3(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)).multiplyScalar(r * 0.95));
      P.add(new THREE.OctahedronGeometry(rng.range(0.05, 0.07), 0), bc, { matrix: mat(p, new THREE.Euler(rng.range(0, 3), rng.range(0, 3), 0)), glow: glow ? 2 : 0.1 });
    }
    return 1.2;
  },

  dryshrub(rng, sp, P) {
    const style = sp.style;
    const pal = sp.palette;
    const base = jitter(rng, pal.trunk).lerp(new THREE.Color(pal.veg2 || pal.trunk), 0.25);
    const pale = jitter(rng, pal.veg2 || pal.sand || pal.trunk).lerp(new THREE.Color(pal.sand || '#d8c8a0'), 0.4);
    const twig = (pts, r0, t0, t1) => ramp(P.add(sweepTube(pts, r0, r0 * 0.3, 3), base), [[0, base.clone().lerp(pale, t0)], [1, base.clone().lerp(pale, t1)]]);
    if (style === 1) {
      // spinifex, a dome of stiff spikes with a few seed stalks
      const n = rng.int(16, 20);
      for (let i = 0; i < n; i++) {
        const a = i * 2.39996;
        const e = rng.range(0.3, 1.45);
        const len = rng.range(0.55, 0.95) * (0.6 + 0.4 * Math.sin(e));
        const dir = new THREE.Vector3(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e));
        const g = new THREE.ConeGeometry(0.04, len, 3, 1, true);
        g.translate(0, len / 2, 0);
        ramp(P.add(g, base, { matrix: qmat(new THREE.Vector3(Math.cos(a) * 0.06, 0, Math.sin(a) * 0.06), aim(dir)) }), [[0, base], [1, pale]]);
      }
      const seeds = rng.int(3, 5);
      for (let i = 0; i < seeds; i++) {
        const a = rng.range(0, Math.PI * 2);
        const top = new THREE.Vector3(Math.cos(a) * rng.range(0.15, 0.35), rng.range(0.85, 1.2), Math.sin(a) * rng.range(0.15, 0.35));
        twig([new THREE.Vector3(), top.clone().multiplyScalar(0.5).add(new THREE.Vector3(0, 0.05, 0)), top], 0.016, 0.4, 1);
        P.add(new THREE.OctahedronGeometry(0.045, 0), pale.clone().lerp(new THREE.Color(pal.glow), sp.glow > 0.5 ? 0.5 : 0.1), { matrix: mat(top, null, new THREE.Vector3(1, 2.2, 1)), glow: sp.glow > 0.5 ? 0.8 : 0 });
      }
      return 1;
    }
    if (style === 2) {
      // wiry whips with tiny leaves and a bud at each tip
      const n = rng.int(5, 7);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
        const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        const pts = curlPath(dir, rng.range(0.9, 1.4), 3, Math.PI / 2 - rng.range(0.2, 0.5), rng.range(-0.3, 0.4));
        twig(pts, 0.028, 0, 0.8);
        for (let k = 1; k < 3; k++) {
          const p = pts[k].clone().lerp(pts[k + 1], rng.range(0.2, 0.8));
          P.add(new THREE.TetrahedronGeometry(0.045, 0), jitter(rng, pal.leaf[k % 3]), { matrix: mat(p, new THREE.Euler(rng.range(0, 3), rng.range(0, 3), 0), new THREE.Vector3(1.8, 0.5, 1)) });
        }
        P.add(new THREE.OctahedronGeometry(0.055, 0), pal.glow, { matrix: mat(pts[3], null, new THREE.Vector3(1, 1.8, 1)), glow: sp.glow > 0.5 ? 1.6 : 0.3 });
      }
      return 1.2;
    }
    if (style === 3) {
      // coral brush, branches split twice and end in knobs
      const knob = pale.clone().lerp(new THREE.Color(pal.glow), 0.25);
      const grow = (from, dir, len, r, depth) => {
        const end = from.clone().addScaledVector(dir, len);
        twig(depth === 2 ? [from, end] : [from, from.clone().lerp(end, 0.5).add(new THREE.Vector3(0, len * 0.08, 0)), end], r, depth * 0.3, depth * 0.3 + 0.3);
        if (depth === 2) {
          P.add(new THREE.TetrahedronGeometry(r * 2, 0), knob, { matrix: mat(end), glow: sp.glow > 0.5 ? 0.9 : 0 });
          return;
        }
        for (let k = 0; k < 2; k++) {
          const d = dir.clone().add(new THREE.Vector3(rng.range(-0.7, 0.7), rng.range(0, 0.3), rng.range(-0.7, 0.7))).normalize();
          grow(end, d, len * rng.range(0.65, 0.85), r * 0.7, depth + 1);
        }
      };
      const n = 3;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng.range(-0.4, 0.4);
        grow(new THREE.Vector3(), new THREE.Vector3(Math.cos(a) * 0.55, 1, Math.sin(a) * 0.55).normalize(), rng.range(0.42, 0.55), 0.045, 0);
      }
      return 1;
    }
    // tumble brush, forked twigs
    const n = rng.int(6, 7);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.range(-0.4, 0.4);
      const e = rng.range(0.45, 1.15);
      const len = rng.range(0.65, 1.15);
      const dir = new THREE.Vector3(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e));
      const end = dir.clone().multiplyScalar(len);
      const mid = end.clone().multiplyScalar(0.5).add(new THREE.Vector3(0, len * 0.06, 0));
      twig([new THREE.Vector3(), mid, end], 0.038, 0, 0.9);
      const forks = rng.int(1, 2);
      for (let k = 0; k < forks; k++) {
        const from = mid.clone().lerp(end, rng.range(0, 0.6));
        const d = dir.clone().add(new THREE.Vector3(rng.range(-0.8, 0.8), rng.range(0, 0.5), rng.range(-0.8, 0.8))).normalize();
        const fe = from.clone().addScaledVector(d, len * rng.range(0.35, 0.55));
        twig([from, fe], 0.02, 0.5, 1);
        if (rng.chance(0.6)) P.add(new THREE.TetrahedronGeometry(0.05, 0), pale, { matrix: mat(fe, new THREE.Euler(rng.range(0, 3), rng.range(0, 3), 0)) });
      }
    }
    return 1;
  },

  frostshrub(rng, sp, P) {
    const leaf = sp.palette.leaf;
    const style = sp.style;
    const deep = jitter(rng, leaf[0]).multiplyScalar(0.7);
    const pale = jitter(rng, leaf[2]).lerp(new THREE.Color('#ffffff'), 0.45);
    const ice = (g, glow = 0.45) => ramp(g, [[0, deep, 0.05], [1, pale, glow]]);
    const petal = (len, w) => new ConvexGeometry([new THREE.Vector3(0, 0, 0), new THREE.Vector3(-w, len * 0.5, 0), new THREE.Vector3(w, len * 0.5, 0), new THREE.Vector3(0, len, 0), new THREE.Vector3(0, len * 0.45, w * 0.35), new THREE.Vector3(0, len * 0.45, -w * 0.35)]);
    if (style === 1) {
      // ice bloom, two rings of flat shard petals around a glowing core
      const n = rng.int(7, 9);
      for (let i = 0; i < n + 5; i++) {
        const inner = i >= n;
        const a = inner ? ((i - n) / 5) * Math.PI * 2 + 0.6 : (i / n) * Math.PI * 2;
        const len = rng.range(0.55, 0.8) * (inner ? 0.7 : 1);
        const tilt = inner ? rng.range(0.2, 0.4) : rng.range(0.55, 0.9);
        ice(P.add(petal(len, len * 0.32), leaf[i % 3], { matrix: qmat(new THREE.Vector3(Math.cos(a) * 0.06, 0.05, Math.sin(a) * 0.06), aim(new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt)), -a + Math.PI / 2)) }));
      }
      P.add(new THREE.OctahedronGeometry(0.12, 0), sp.palette.glow, { matrix: mat(new THREE.Vector3(0, 0.2, 0), null, new THREE.Vector3(1, 1.5, 1)), glow: 1.5 });
      return 0.8;
    }
    if (style === 0) {
      // frost fern, stems with side spikes like a snowflake arm
      const n = rng.int(4, 5);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
        const tilt = rng.range(0.3, 0.75);
        const dir = new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt));
        const h = rng.range(0.65, 1.0);
        const q = aim(dir, rng.range(0, Math.PI));
        ice(P.add(crystalPrism(0.05, h * 0.8, 4, h * 0.2, 0.8), leaf[i % 3], { matrix: qmat(new THREE.Vector3(), q) }));
        const side = rng.int(2, 3);
        for (let k = 0; k < side; k++) {
          const along = h * (0.35 + 0.2 * k);
          const sa = rng.range(0, Math.PI * 2);
          const sd = new THREE.Vector3(Math.cos(sa) * 0.8, 0.6, Math.sin(sa) * 0.8).normalize().applyQuaternion(q);
          const sl = h * rng.range(0.3, 0.45) * (1 - k * 0.2);
          ice(P.add(crystalPrism(0.03, sl * 0.8, 4, sl * 0.2, 0.7), leaf[(i + k) % 3], { matrix: qmat(dir.clone().multiplyScalar(along), aim(sd)) }), 0.5);
        }
      }
      return 0.9;
    }
    // icicle tuft or urchin, the urchin spreads its spikes much wider
    const n = rng.int(8, 11);
    const spread = style === 3 ? 1.35 : 0.55;
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996;
      const tilt = i === 0 ? 0 : rng.range(0.1, spread);
      const h = rng.range(0.45, 0.9) * (i === 0 ? 1.3 : 1);
      const dir = new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt));
      ice(P.add(crystalPrism(rng.range(0.045, 0.07), h * 0.7, 4, h * 0.3, 0.75, rng.range(-0.3, 0.3)), leaf[i % 3], { matrix: qmat(new THREE.Vector3(Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05), aim(dir, rng.range(0, 3))) }));
    }
    const mound = P.add(hullRock(rng, 0.28, 1.3, 0.5, 1.3, 1, 10, 0.2), '#ffffff', { matrix: mat(new THREE.Vector3(0, -0.04, 0)), sway: 0 });
    ramp(mound, [[0, pale.clone().multiplyScalar(0.8), 0], [1, '#ffffff', 0]]);
    return 0.9;
  },

  grass(rng, sp, P) {
    const style = sp.style;
    const n = style === 2 ? rng.int(6, 7) : rng.int(5, 7);
    const base = jitter(rng, sp.palette.veg || sp.palette.leaf[0], 0.06);
    const tip = jitter(rng, sp.palette.veg2 || sp.palette.leaf[1], 0.06).lerp(new THREE.Color('#ffffff'), 0.08);
    const root = base.clone().multiplyScalar(0.6);
    const pos = [], cols = [];
    const put = (x, y, z, c) => {
      pos.push(x, y, z);
      cols.push(c.r, c.g, c.b);
    };
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.range(-0.5, 0.5);
      const r = rng.range(0.02, 0.2);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = rng.range(0.4, 0.8) * (style === 1 ? 1.3 : style === 2 ? 0.7 : 1);
      const w = rng.range(0.04, 0.065) * (style === 2 ? 1.4 : 1);
      // blades lean outward and bend at a knee, more so above it
      const la = a + rng.range(-0.6, 0.6);
      const lean = rng.range(0.25, 0.6) * (style === 1 ? 0.45 : style === 3 ? 1.5 : 1);
      const kn = rng.range(0.42, 0.58);
      const cx = Math.cos(la), cz = Math.sin(la);
      const kx = x + cx * lean * 0.22 * h, ky = h * kn, kz = z + cz * lean * 0.22 * h;
      const tx = x + cx * lean * 1.1 * h, ty = h * (1 - lean * 0.45), tz = z + cz * lean * 1.1 * h;
      const px = -cz * w, pz = cx * w;
      const kc = base.clone().lerp(tip, 0.35);
      const tc = tip.clone().offsetHSL(0, 0, rng.range(-0.04, 0.04));
      put(x - px, 0, z - pz, root);
      put(x + px, 0, z + pz, root);
      put(kx + px * 0.85, ky, kz + pz * 0.85, kc);
      put(x - px, 0, z - pz, root);
      put(kx + px * 0.85, ky, kz + pz * 0.85, kc);
      put(kx - px * 0.85, ky, kz - pz * 0.85, kc);
      put(kx - px * 0.85, ky, kz - pz * 0.85, kc);
      put(kx + px * 0.85, ky, kz + pz * 0.85, kc);
      put(tx, ty, tz, tc);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    // grass normals point up so it shades like the ground under it
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(pos.length).map((v, i) => (i % 3 === 1 ? 1 : 0)), 3));
    P.add(g, base).attributes.color.array.set(cols);
    return 0.8;
  },

  flower(rng, sp, P) {
    const pal = sp.palette;
    const style = sp.style;
    const stemCol = jitter(rng, pal.veg || pal.leaf[0]);
    // petals take the palette's accent color so they stand out from the leaves
    const petal = jitter(rng, pal.glow).lerp(new THREE.Color(pal.leaf[rng.int(0, 2)]), rng.range(0.05, 0.2));
    const petal2 = petal.clone().lerp(new THREE.Color('#ffffff'), 0.45);
    const heart = new THREE.Color(pal.glow).lerp(new THREE.Color('#ffffff'), 0.35);
    // petal shape is per species
    const m = rng.int(4, 7);
    const fat = rng.range(0.35, 1.2), notch = rng.range(0.2, 0.5);
    const heads = style === 1 ? 3 : 1;
    let top = 0.5;
    for (let i = 0; i < heads; i++) {
      const a = rng.range(0, Math.PI * 2);
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const h = [rng.range(0.45, 0.85), rng.range(0.35, 0.7), rng.range(0.5, 0.9), rng.range(0.6, 0.95)][style];
      const off = heads > 1 ? rng.range(0.04, 0.16) : 0;
      // the nodding style arcs its stem over so the bloom hangs like a bell
      const pts = curlPath(dir, h * (style === 3 ? 1.25 : 1), 4, Math.PI / 2 - rng.range(0.02, 0.15), style === 3 ? rng.range(2.0, 2.4) : rng.range(-0.1, 0.35), style === 3 ? 2.5 : 1);
      for (const p of pts) p.addScaledVector(dir, off);
      const stem = P.add(sweepTube(pts, 0.024, 0.014, 3), stemCol);
      ramp(stem, [[0, stemCol.clone().multiplyScalar(0.6)], [1, stemCol]]);
      const end = pts[pts.length - 1];
      const facing = end.clone().sub(pts[pts.length - 2]).normalize();
      top = Math.max(top, end.y);
      const R = [0.3, 0.16, 0.2, 0.2][style] * rng.range(0.85, 1.15);
      const cup = style >= 2 ? R * rng.range(0.9, 1.3) : R * rng.range(0.08, 0.4);
      const q = aim(facing, rng.range(0, Math.PI));
      const outer = P.add(bloomDisc(R, m, fat, notch, cup, style === 1 ? 1 : 2), petal, { matrix: qmat(end, q), glow: 0.3 });
      ramp(outer, [[0, heart.clone().lerp(petal, 0.25), 1.6], [0.45, petal.clone().lerp(petal2, 0.5), 0.6], [1, petal, 0.3]]);
      if (style !== 1) {
        const inner = P.add(bloomDisc(R * 0.58, m, fat, notch, cup * 1.4, 1), petal2, { matrix: qmat(end.clone().addScaledVector(facing, 0.012), q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / m))) });
        ramp(inner, [[0, heart, 2], [1, petal2, 0.7]]);
      }
      const calyx = lathe([[R * 0.14, 0], [R * 0.48, -R * 0.06], [R * 0.1, -R * 0.22]], m, { shape: (row, j) => row === 1 && j % 2 ? 0.7 : 1 });
      P.add(calyx, tint(stemCol, 0.8), { matrix: qmat(end, q), sway: 0.8 });
      P.add(style === 1 ? new THREE.OctahedronGeometry(R * 0.24, 0) : new THREE.IcosahedronGeometry(R * 0.24, 0), heart, { matrix: qmat(end.clone().addScaledVector(facing, R * 0.12), q, new THREE.Vector3(1, 0.7, 1)), glow: 2.5 });
      if (style === 0 || style === 2) {
        for (let j = 0; j < m; j++) {
          const a = j / m * Math.PI * 2;
          const p = new THREE.Vector3(Math.cos(a) * R * 0.2, R * 0.28, Math.sin(a) * R * 0.2).applyQuaternion(q).add(end);
          const pollen = new THREE.OctahedronGeometry(R * 0.055);
          P.add(pollen, heart, { matrix: qmat(p, q, new THREE.Vector3(1, 2.4, 1)), glow: 1.8 });
        }
      }
    }
    const leaves = style === 1 ? 3 : 2;
    for (let i = 0; i < leaves; i++) {
      const g = P.add(leafStrip(rng.range(0.2, 0.32), rng.range(0.05, 0.08), rng.range(0.5, 0.9), rng.range(0.6, 1.0), 2, 0.4), stemCol, { matrix: qmat(new THREE.Vector3(0, 0.02, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (i / leaves) * Math.PI * 2 + rng.range(-0.4, 0.4), 0))) });
      ramp(g, [[0, stemCol.clone().multiplyScalar(0.6)], [1, stemCol.clone().lerp(new THREE.Color(pal.leaf[1]), 0.4)]]);
    }
    return top;
  },

  mushroom(rng, sp, P) {
    const pal = sp.palette;
    const style = sp.style;
    const stalkCol = jitter(rng, '#e8dcc8').lerp(new THREE.Color(pal.leaf[2]), 0.12);
    // mixing a leaf color with a complementary accent lands on gray, so pick one
    const capCol = rng.chance(0.55) ? jitter(rng, pal.glow).multiplyScalar(0.8) : jitter(rng, pal.leaf[rng.int(0, 2)]);
    const capTop = capCol.clone().lerp(new THREE.Color(pal.leaf[rng.int(0, 2)]), 0.5).offsetHSL(0, 0, 0.08);
    const gill = new THREE.Color(pal.glow);
    const spotCol = rng.chance(0.5) ? new THREE.Color('#fff6ea') : gill.clone().lerp(new THREE.Color('#ffffff'), 0.4);
    const g0 = 1.2 * sp.glow;
    const count = style === 2 ? 3 : style === 3 ? rng.int(3, 5) : style === 1 ? rng.int(1, 2) : rng.int(2, 3);
    let top = 0.3;
    for (let i = 0; i < count; i++) {
      const big = i === 0;
      const a = i * 2.39996 + rng.range(-0.3, 0.3);
      const d = big ? 0 : rng.range(0.15, 0.3);
      const s = big ? 1 : rng.range(0.45, 0.7);
      let h = rng.range(0.35, 0.8) * s, r = rng.range(0.22, 0.4) * s, capH = r * 0.6;
      if (style === 1) { h *= 1.5; r *= 1.3; capH = r * 0.22; }
      if (style === 2) { r *= 0.7; capH = r * 1.3; }
      if (style === 3) { h *= 0.35; r *= 0.75; capH = r * 1.1; }
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const lean = big ? 0.04 : rng.range(0.05, 0.15);
      const topP = new THREE.Vector3(x + Math.cos(a) * lean, h, z + Math.sin(a) * lean);
      const sr = Math.max(0.035, r * (style === 1 ? 0.14 : 0.24));
      const sides = big ? 5 : 4;
      const stalk = P.add(sweepTube([new THREE.Vector3(x, 0, z), new THREE.Vector3(x, h * 0.5, z).lerp(topP, 0.3), topP], (t) => sr * (1 + 0.5 * (1 - t) ** 3), 0, sides), stalkCol);
      ramp(stalk, [[0, stalkCol.clone().multiplyScalar(0.7), 0], [1, stalkCol, 0]]);
      // cap: gills from the stalk out to the rim, a rolled lip, then the dome
      const dome = style === 3 ? [[r * 0.95, capH * 0.35], [r * 0.85, capH * 0.8], [r * 0.45, capH * 1.1], [0, capH * 1.2]] : [[r, capH * 0.28], [r * 0.62, capH * 0.82], [0, capH]];
      const under = style === 3 ? [[sr * 1.2, -capH * 0.1, 0.25]] : big ? [[sr * 1.15, -capH * 0.04], [r * 0.8, capH * 0.02, 0.18], [r * 0.97, -capH * 0.05, 0.1]] : [[sr * 1.15, -capH * 0.04], [r * 0.97, -capH * 0.05, 0.14]];
      const N = big ? (style === 2 ? 8 : 9) : 6;
      const capGeo = ringsGeo([...under, ...dome], N);
      const capPos = capGeo.attributes.position;
      for (let j = 0; j < capPos.count; j++) {
        const x = capPos.getX(j), z = capPos.getZ(j);
        const radial = Math.hypot(x, z) / r;
        const wave = Math.sin(Math.atan2(z, x) * 3 + 0.5);
        capPos.setXYZ(j, x * (1 + 0.055 * wave), capPos.getY(j) + wave * r * 0.035 * radial, z * (1 + 0.055 * wave));
      }
      capGeo.computeVertexNormals();
      const cap = P.add(capGeo, capCol, { matrix: mat(topP) });
      const glowUnder = style === 3 ? 0.4 * g0 : g0;
      // gills glow brightest by the stalk, the rolled lip keeps a faint glow so
      // the cap edge still reads at night from the side
      const rows = under.length + dome.length - 1;
      const lipT = (under.length - 1) / rows, rimT = under.length / rows;
      ramp(cap, style === 3 ? [[0, capCol, 0], [1, capTop, 0]] : [[0, gill, glowUnder], [lipT * 0.6, gill.clone().lerp(capCol, 0.5), glowUnder * 0.6], [lipT, capCol.clone().lerp(gill, 0.35), glowUnder * 0.4], [rimT, capCol, 0], [1, capTop, 0]]);
      if (style === 1 || style === 2) {
        top = Math.max(top, h + capH);
        continue;
      }
      // spots sit on the dome, placed along its profile
      const spots = big ? rng.int(3, 5) : rng.int(1, 2);
      for (let k = 0; k < spots; k++) {
        const sa = rng.range(0, Math.PI * 2);
        const u = rng.range(0.12, 0.8) * dome[0][0];
        let j = 0;
        while (j < dome.length - 2 && dome[j + 1][0] > u) j++;
        const [r0, y0] = dome[j], [r1, y1] = dome[j + 1];
        const f = (r0 - u) / Math.max(1e-4, r0 - r1);
        const len = Math.hypot(r1 - r0, y1 - y0);
        const nr = (y1 - y0) / len, ny = (r0 - r1) / len;
        const nrm = new THREE.Vector3(Math.cos(sa) * nr, ny, Math.sin(sa) * nr);
        const p = new THREE.Vector3(Math.cos(sa) * u, y0 + (y1 - y0) * f, Math.sin(sa) * u).addScaledVector(nrm, 0.012).add(topP);
        const spot = new THREE.CircleGeometry(r * rng.range(0.1, 0.16), 5);
        spot.rotateX(-Math.PI / 2);
        P.add(spot, spotCol, { matrix: qmat(p, aim(nrm)), glow: sp.glow > 0.5 ? 1.2 : 0.2 });
      }
      top = Math.max(top, h + capH);
    }
    return top;
  },

  bigmushroom(rng, sp, P) {
    const style = sp.style;
    const o = {
      style,
      h: rng.range(2.8, 5),
      r0: rng.range(0.28, 0.4),
      bend: rng.range(0.2, 1.0),
      at: new THREE.Vector3(),
      stalkCol: jitter(rng, '#e4d8c4', 0.05).lerp(new THREE.Color(sp.palette.leaf[2]), 0.12),
      capCol: jitter(rng, sp.palette.leaf[rng.int(0, 2)]),
      capCol2: jitter(rng, sp.palette.leaf[rng.int(0, 2)]),
      glowCol: jitter(rng, sp.palette.glow, 0.04),
      glow: sp.glow,
    };
    o.R = style === 2 ? rng.range(1.4, 1.9) : rng.range(1.9, 3);
    o.spots = style !== 3 && rng.chance(0.6);
    o.spotGlow = rng.chance(0.4);
    o.bands = !o.spots && rng.chance(0.5);
    o.veil = style !== 3 && sp.glow > 0.5 && rng.chance(0.3);
    o.ring = rng.chance(0.5);
    const h = fungus(rng, P, o);
    if (style === 1 || rng.chance(0.35)) {
      const a = rng.range(0, Math.PI * 2);
      const d = o.r0 * 2.2 + rng.range(0.3, 0.7);
      fungus(rng, P, { ...o, style: 1, h: o.h * rng.range(0.25, 0.4), R: o.R * rng.range(0.3, 0.4), r0: o.r0 * 0.5, bend: 0.3, at: new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d), spots: false, veil: false, ring: false });
    }
    return h;
  },

  pod(rng, sp, P) {
    const pal = sp.palette;
    const style = sp.style;
    const leafCol = jitter(rng, pal.veg || pal.leaf[0]);
    const stalkCol = jitter(rng, pal.veg || pal.trunk);
    const glowCol = new THREE.Color(pal.glow);
    const hot = glowCol.clone().lerp(new THREE.Color('#ffffff'), 0.45);
    // ribbed teardrop, the pole at aT 1 is where it hangs from
    const podGeo = (R) => ringsGeo([[0, -R * 1.05], [R * 0.55, -R * 0.78, 0.12], [R, -R * 0.1, 0.14], [R * 0.78, R * 0.5, 0.12], [R * 0.3, R * 0.92], [0, R * 1.05]], 6);
    const lightPod = (g) => ramp(g, [[0, hot, 2], [0.45, glowCol, 1.6], [0.85, glowCol.clone().lerp(leafCol, 0.5), 0.5], [1, leafCol, 0]]);
    const sepals = (at, q, R) => {
      for (let k = 0; k < 3; k++) {
        const g = P.add(leafStrip(R * 0.9, R * 0.35, -0.6, 0.3, 1, 0.3), leafCol, { matrix: qmat(at, q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (k / 3) * Math.PI * 2, 0)))) });
        ramp(g, [[0, leafCol.clone().multiplyScalar(0.7)], [1, leafCol]]);
      }
    };
    // fleshy rosette at the base
    const leaves = rng.int(3, 5);
    for (let i = 0; i < leaves; i++) {
      const g = P.add(leafStrip(rng.range(0.3, 0.45), rng.range(0.09, 0.13), rng.range(0.5, 0.9), rng.range(0.8, 1.2), 2, 0.5), leafCol, { matrix: qmat(new THREE.Vector3(0, 0.02, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (i / leaves) * Math.PI * 2 + rng.range(-0.3, 0.3), 0))) });
      ramp(g, [[0, leafCol.clone().multiplyScalar(0.55), 0], [1, leafCol.clone().lerp(glowCol, 0.25), 0.2]]);
    }
    if (style === 2) {
      // a clutch of glowing eggs nestled in the rosette
      const n = rng.int(3, 4);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
        const R = rng.range(0.12, 0.18) * (i === 0 ? 1.3 : 1);
        const d = i === 0 ? 0 : rng.range(0.12, 0.2);
        const q = aim(new THREE.Vector3(Math.cos(a) * 0.4 * (d ? 1 : 0), 1, Math.sin(a) * 0.4 * (d ? 1 : 0)), a);
        lightPod(P.add(podGeo(R), glowCol, { matrix: qmat(new THREE.Vector3(Math.cos(a) * d, R * 0.95, Math.sin(a) * d), q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI))) }));
      }
      return 0.6;
    }
    const n = style === 3 ? 1 : style === 0 ? 2 : rng.int(2, 3);
    let top = 0.5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.range(-0.4, 0.4);
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const R = rng.range(0.15, 0.24) * (style === 3 ? 1.35 : 1);
      if (style === 0) {
        // lantern, the stalk arcs over and the pod hangs from its tip
        const h = rng.range(0.6, 1.1);
        const pts = curlPath(dir, h * 1.3, 5, Math.PI / 2 - rng.range(0, 0.15), rng.range(2.3, 2.8), 2.2);
        ramp(P.add(sweepTube(pts, 0.03, 0.016, 3), stalkCol), [[0, stalkCol.clone().multiplyScalar(0.6)], [1, stalkCol]]);
        const end = pts[pts.length - 1];
        const at = end.clone().add(new THREE.Vector3(0, -0.02, 0));
        sepals(at, new THREE.Quaternion(), R);
        lightPod(P.add(podGeo(R), glowCol, { matrix: mat(at.clone().add(new THREE.Vector3(0, -R * 1.05, 0))), sway: 1.3 }));
        top = Math.max(top, pts.reduce((m, p) => Math.max(m, p.y), 0));
      } else {
        // upright bulb on a straight stalk, cupped by sepals
        const h = rng.range(0.4, 0.9) * (style === 3 ? 1.5 : 1);
        const lean = rng.range(0.05, 0.25);
        const end = new THREE.Vector3(Math.cos(a) * lean, h, Math.sin(a) * lean);
        ramp(P.add(sweepTube([new THREE.Vector3(), new THREE.Vector3(Math.cos(a) * lean * 0.3, h * 0.5, Math.sin(a) * lean * 0.3), end], 0.035, 0.02, 3), stalkCol), [[0, stalkCol.clone().multiplyScalar(0.6)], [1, stalkCol]]);
        const flip = aim(end.clone().normalize()).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI));
        sepals(end, flip, R);
        lightPod(P.add(podGeo(R), glowCol, { matrix: qmat(end.clone().addScaledVector(end.clone().normalize(), R * 1.0), flip) }));
        top = Math.max(top, h + R * 2);
        if (style === 3) {
          // a few small side buds
          for (let k = 0; k < 3; k++) {
            const y = h * rng.range(0.3, 0.7);
            const sa = rng.range(0, Math.PI * 2);
            const p = end.clone().multiplyScalar(y / h).add(new THREE.Vector3(Math.cos(sa) * 0.06, 0, Math.sin(sa) * 0.06));
            P.add(new THREE.OctahedronGeometry(0.045, 0), hot, { matrix: mat(p, null, new THREE.Vector3(1, 1.4, 1)), glow: 1.6 });
          }
        }
      }
    }
    return top;
  },

  tendril(rng, sp, P) {
    const pal = sp.palette;
    const style = sp.style;
    const glowCol = new THREE.Color(pal.glow);
    const dark = jitter(rng, pal.trunk).lerp(new THREE.Color(pal.leaf[0]), 0.3);
    const lit = sp.glow > 0.3;
    // a squat bulb the tendrils grow from
    const bulb = P.add(lumpy(rng, 0.22, 0, 0.15, new THREE.Vector3(1.2, 0.6, 1.2)), dark, { matrix: mat(new THREE.Vector3(0, 0.04, 0)), sway: 0.2 });
    softenNormals(bulb, new THREE.Vector3(), 0.6);
    ramp(bulb, [[0, dark.clone().multiplyScalar(0.6), 0], [1, dark.clone().lerp(new THREE.Color(pal.leaf[1]), 0.3), 0]]);
    const n = style === 2 ? 3 : rng.int(4, 5);
    let top = 1;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.range(-0.35, 0.35);
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const len = rng.range(0.9, 1.9);
      let pts;
      if (style === 2) {
        // corkscrew
        const turns = rng.range(1.5, 2.5), rc = rng.range(0.07, 0.12), h = len * 0.8;
        pts = [];
        for (let k = 0; k <= 10; k++) {
          const t = k / 10;
          const ca = a + t * turns * Math.PI * 2;
          const w = rc * Math.min(1, t * 4);
          pts.push(new THREE.Vector3(Math.cos(a) * (0.12 + t * 0.12) + Math.cos(ca) * w, h * t, Math.sin(a) * (0.12 + t * 0.12) + Math.sin(ca) * w));
        }
      } else {
        // anemone curls at the tip, whips stay nearly straight, the last droops
        const shape = [
          [Math.PI / 2 - rng.range(0.05, 0.25), rng.range(2.4, 3.0), 3],
          [Math.PI / 2 - rng.range(0.02, 0.2), rng.range(-0.3, 0.5), 1],
          null,
          [Math.PI / 2 - rng.range(0.1, 0.3), rng.range(1.2, 1.6), 1],
        ][style];
        pts = curlPath(dir, len * (style === 1 ? 1.1 : 1), 7, shape[0], shape[1], shape[2]);
        for (const p of pts) p.addScaledVector(dir, 0.08);
      }
      const leaf = new THREE.Color(pal.leaf[i % 3]);
      const g = P.add(sweepTube(pts, (t) => 0.075 * (1 - t * 0.7), 0, 3, true), leaf);
      ramp(g, [[0, dark, 0], [0.5, leaf, 0], [1, lit ? leaf.clone().lerp(glowCol, 0.6) : leaf.clone().offsetHSL(0, 0, 0.1), lit ? 1.2 : 0]]);
      if (lit) P.add(new THREE.OctahedronGeometry(0.08, 0), glowCol, { matrix: mat(pts[pts.length - 1]), glow: 2 });
      top = Math.max(top, pts.reduce((m, p) => Math.max(m, p.y), 0));
    }
    return top;
  },

  cactus(rng, sp, P) {
    const col = jitter(rng, sp.palette.leaf[rng.int(0, 2)], 0.05);
    const flowerCol = jitter(rng, sp.palette.glow, 0.05);
    const flowers = rng.chance(0.65);
    const ribs = rng.int(6, 8);
    const depth = rng.range(0.12, 0.2);
    const style = sp.style;
    const tops = [];
    let h = 0;
    if (style === 1) {
      // cluster of round barrels
      const n = rng.int(3, 4);
      for (let i = 0; i < n; i++) {
        const rb = rng.range(0.38, 0.6) * (i ? rng.range(0.55, 0.85) : 1);
        const hb = rb * rng.range(1.0, 1.7);
        const a = rng.range(0, Math.PI * 2);
        const off = i ? rng.range(0.6, 0.9) * (rb + 0.35) : 0;
        const x = Math.cos(a) * off, z = Math.sin(a) * off;
        const pts = [new THREE.Vector3(x, -0.25, z), new THREE.Vector3(x, hb * 0.5, z), new THREE.Vector3(x, hb, z)];
        const round = (t) => rb * (0.8 + 0.3 * Math.sin(Math.PI * Math.min(1, t * 0.85 + 0.1))) * Math.sqrt(Math.max(0.04, 1 - Math.max(0, (t - 0.65) / 0.35) ** 2));
        const g = limb(pts, round, ribs * 2, 4, { shape: (t, j) => (j % 2 ? 1 - depth : 1), tip: 0.3, tag: true, ease: 0.8 });
        cactusPaint(P.add(g, col, { sway: 0.05 }), col, ribs);
        tops.push(new THREE.Vector3(x, hb, z));
        h = Math.max(h, hb);
      }
    } else if (style === 2) {
      h = 2;
      tops.push(...pricklyPear(rng, P, col, flowerCol));
    } else if (style === 3) {
      // organ pipe: several columns from one base
      const n = rng.int(3, 4);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng.range(-0.4, 0.4);
        const off = i ? rng.range(0.25, 0.45) : 0;
        const lean = i ? rng.range(0.15, 0.4) : rng.range(0, 0.1);
        const hc = rng.range(1.8, 3.6) * (i ? rng.range(0.6, 1) : 1);
        const b = new THREE.Vector3(Math.cos(a) * off, -0.3, Math.sin(a) * off);
        const pts = [b, b.clone().add(new THREE.Vector3(Math.cos(a) * lean * 0.5, hc * 0.5, Math.sin(a) * lean * 0.5)), b.clone().add(new THREE.Vector3(Math.cos(a) * lean * 1.4, hc, Math.sin(a) * lean * 1.4))];
        cactusPaint(P.add(ribbed(pts, rng.range(0.18, 0.26), ribs - 1, 6, depth), col, { sway: 0.1 }), col, ribs - 1);
        tops.push(pts[2]);
        h = Math.max(h, hc);
      }
    } else {
      // saguaro with elbowed arms
      h = rng.range(2.4, 4.2);
      const r = rng.range(0.28, 0.38);
      const lx = rng.range(-0.25, 0.25), lz = rng.range(-0.25, 0.25);
      const pts = [new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(lx * 0.3, h * 0.5, lz * 0.3), new THREE.Vector3(lx, h, lz)];
      cactusPaint(P.add(ribbed(pts, r, ribs, 7, depth), col, { sway: 0.1 }), col, ribs);
      tops.push(pts[2]);
      const arms = rng.int(1, 3);
      const a0 = rng.range(0, Math.PI * 2);
      for (let i = 0; i < arms; i++) {
        const a = a0 + (i / arms) * Math.PI * 2 + rng.range(-0.5, 0.5);
        const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        const y = h * rng.range(0.3, 0.6);
        const out = r + rng.range(0.35, 0.6);
        const up = rng.range(0.6, 1.3);
        const base = new THREE.Vector3((lx * y) / h, y, (lz * y) / h);
        const ap = [base, base.clone().addScaledVector(d, out * 0.7).add(new THREE.Vector3(0, 0.05, 0)), base.clone().addScaledVector(d, out).add(new THREE.Vector3(0, 0.45, 0)), base.clone().addScaledVector(d, out).add(new THREE.Vector3(0, 0.45 + up, 0))];
        cactusPaint(P.add(ribbed(ap, r * rng.range(0.6, 0.75), ribs - 1, 6, depth), col, { sway: 0.1 }), col, ribs - 1);
        tops.push(ap[3]);
      }
    }
    if (flowers && style !== 2) {
      for (const t of tops) {
        const k = rng.int(1, 3);
        for (let i = 0; i < k; i++) {
          const a = rng.range(0, Math.PI * 2);
          const p = t.clone().add(new THREE.Vector3(Math.cos(a) * 0.12 * i, 0.02 - 0.05 * i, Math.sin(a) * 0.12 * i));
          cactusFlower(P, p, rng.range(0.12, 0.18), i ? tint(flowerCol, 1.1) : flowerCol);
        }
      }
    }
    return h;
  },

  vent(rng, sp, P) {
    const pal = sp.palette;
    const ground = sp.sink ?? 0.25;
    const h = rng.range(1.2, 2.6);
    const rb = rng.range(1.0, 1.3), rt = rng.range(0.38, 0.5);
    const lavaY = h - rng.range(0.18, 0.26);
    const noise = createNoise3D(rng.seed());
    // the rim breaks down on one side so the lava shows from the ground and
    // spills out down the slope
    const notchA = rng.range(0, Math.PI * 2);
    const notch = (x, z) => {
      let d = Math.atan2(z, x) - notchA;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      return Math.exp(-(d * d) / 0.25);
    };
    const rough = (g) => {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i);
        let y = p.getY(i);
        const k = 1 + noise(x * 1.4, y * 1.4, z * 1.4) * 0.12;
        if (y > h * 0.75) y += noise(x * 3, 5, z * 3) * 0.12;
        if (y > lavaY) y -= (y - lavaY) * 0.8 * notch(x, z);
        p.setXYZ(i, x * k, y, z * k);
      }
      g.computeVertexNormals();
      return g;
    };
    const lava = new THREE.Color('#ff7a2a').lerp(new THREE.Color(pal.glow), 0.25);
    const dark = jitter(rng, pal.cliff, 0.06).multiplyScalar(0.8);
    const crust = jitter(rng, pal.cliff, 0.06).lerp(new THREE.Color(pal.high), 0.55);
    // outer slope, jagged rim, then the inner wall down to the lava
    const slope = [[rb * 1.12, -0.3], [rb, 0.1, 0, 0.15], [rb + (rt - rb) * 0.55, h * 0.5], [rt * 1.08, h * 0.9, 0, 0.2]];
    const slopeR = (y) => {
      let j = 1;
      while (j < slope.length - 2 && slope[j + 1][1] < y) j++;
      const [r0, y0] = slope[j], [r1, y1] = slope[j + 1];
      return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
    };
    // a point on the rough surface at angle a and height y, pushed out a bit
    const onSlope = (a, y, out) => {
      const x = Math.cos(a) * slopeR(y), z = Math.sin(a) * slopeR(y);
      const s = 1 + noise(x * 1.4, y * 1.4, z * 1.4) * 0.12;
      return new THREE.Vector3(x * s, y, z * s).addScaledVector(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), out);
    };
    const cone = P.add(rough(ringsGeo([...slope, [rt, h, 0, 0.35], [rt * 0.74, h - 0.1, 0, 0.2], [rt * 0.6, lavaY, 0, 0.2]], 9)), dark, { sway: 0 });
    ramp(cone, [[0, dark, 0], [0.33, dark.clone().lerp(crust, 0.4), 0], [0.62, crust, 0], [0.7, crust, 0], [0.84, lava.clone().multiplyScalar(0.6), 0.7], [1, lava, 2.2]]);
    const pool = P.add(rough(ringsGeo([[rt * 0.6, lavaY, 0, 0.2], [0, lavaY + 0.05]], 9)), lava, { sway: 0 });
    ramp(pool, [[0, lava, 2.4], [1, '#ffd36a', 3]]);
    // the spill, from the notch down the slope and a little way onto the ground
    const spill = [];
    const top = lavaY + 0.2 * (h - lavaY);
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      const y = top + (ground + 0.05 - top) * t;
      spill.push(onSlope(notchA + Math.sin(t * 4) * 0.08, y, 0.04 + t * t * 0.3));
    }
    const flow = P.add(sweepTube(spill, (t) => 0.16 - 0.06 * t, 0, 3), lava, { sway: 0 });
    ramp(flow, [[0, '#ffc85a', 2.8], [1, lava, 2]]);
    const puddle = spill[4].clone().addScaledVector(new THREE.Vector3(Math.cos(notchA), 0, Math.sin(notchA)), 0.2);
    const pd = P.add(lumpy(rng, 0.4, 0, 0.2, new THREE.Vector3(1.2, 0.18, 0.9)), lava, { matrix: mat(puddle, new THREE.Euler(0, -notchA, 0)), sway: 0 });
    ramp(pd, [[0, lava.clone().multiplyScalar(0.6), 1.2], [1, '#ffb347', 2.6]]);
    // glowing cracks running down from the rim on the other sides
    const cracks = rng.int(1, 2);
    for (let i = 0; i < cracks; i++) {
      const a0 = notchA + ((i + 1) / (cracks + 1)) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const pts = [];
      for (let k = 0; k <= 3; k++) {
        const t = k / 3;
        pts.push(onSlope(a0 + Math.sin(t * 5 + i) * 0.1, h * (0.9 - t * rng.range(0.45, 0.6)), 0));
      }
      const g = P.add(sweepTube(pts, 0.07, 0.03, 3), lava, { sway: 0 });
      ramp(g, [[0, '#ffb347', 2.6], [1, lava.clone().multiplyScalar(0.7), 1.2]]);
    }
    // loose rocks around the foot
    const rocks = [];
    const n = rng.int(2, 3);
    for (let i = 0; i < n; i++) {
      const a = notchA + rng.range(0.8, 5.5), d = rb * rng.range(1.05, 1.35);
      rocks.push(P.add(hullRock(rng, rng.range(0.15, 0.3), 1, 0.7, 1, 2, 12, 0.3), dark, { matrix: mat(new THREE.Vector3(Math.cos(a) * d, ground - 0.06, Math.sin(a) * d), new THREE.Euler(0, rng.range(0, 6.3), 0)), sway: 0 }));
    }
    paintChunks(rocks, { lo: dark, hi: crust, cover: rockCover(sp), ao: 0.35 });
    return h;
  },

  rock(rng, sp, P) {
    const pal = sp.palette;
    const lo = jitter(rng, rng.chance(0.7) ? pal.cliff : pal.high, 0.1);
    const hi = lo.clone().lerp(new THREE.Color(pal.high), 0.4).offsetHSL(0, 0, 0.1);
    const style = sp.style;
    const ground = sp.sink ?? 0.25;
    const r = rng.range(0.4, 0.9);
    const parts = [];
    const shape = [[1.25, 0.8, 1.05], [1.5, 0.5, 1.2], [0.8, 1.15, 0.75], [0.9, 0.75, 0.85]][style];
    const place = (g, pos, tilt) => parts.push(P.add(g, lo, { matrix: mat(pos, new THREE.Euler(tilt * rng.range(-1, 1), rng.range(0, 6.3), tilt * rng.range(-1, 1))), sway: 0 }));
    if (style === 3) {
      // a little pile of three stones
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + rng.range(-0.3, 0.3);
        const rr = r * rng.range(0.5, 0.7) * (i === 0 ? 1.25 : 1);
        place(hullRock(rng, rr, ...shape, 2, 16, 0.3), new THREE.Vector3(Math.cos(a) * r * 0.5, ground - rr * shape[1] * 0.3, Math.sin(a) * r * 0.5), 0.25);
      }
    } else {
      place(hullRock(rng, r, ...shape, 3, 24, 0.3), new THREE.Vector3(0, ground - r * shape[1] * 0.3, 0), style === 2 ? 0.3 : 0.08);
      if (style !== 1 || rng.chance(0.5)) {
        const a = rng.range(0, Math.PI * 2);
        const rr = r * rng.range(0.4, 0.55);
        place(hullRock(rng, rr, 1, 0.85, 0.9, 2, 14, 0.3), new THREE.Vector3(Math.cos(a) * r * shape[0] * 0.85, ground - rr * 0.25, Math.sin(a) * r * shape[2] * 0.85), 0.4);
      }
    }
    const pebbles = rng.int(1, 3);
    for (let i = 0; i < pebbles; i++) {
      const a = rng.range(0, Math.PI * 2), d = r * rng.range(1.25, 1.8);
      place(hullRock(rng, r * rng.range(0.12, 0.2), 1, 0.7, 1, 1, 9, 0.3), new THREE.Vector3(Math.cos(a) * d, ground - 0.03, Math.sin(a) * d), 0.3);
    }
    paintChunks(parts, { lo, hi, cover: rockCover(sp), ao: 0.35 });
    return 1;
  },

  boulder(rng, sp, P) {
    const pal = sp.palette;
    const lo = jitter(rng, pal.cliff, 0.1);
    const hi = jitter(rng, pal.high, 0.1).offsetHSL(0, 0, 0.06);
    const style = sp.style;
    const ground = sp.sink ?? 0.25;
    const r = rng.range(1.5, 2.6);
    const sx = rng.range(1.0, 1.35), sy = rng.range(0.65, 0.95), sz = rng.range(0.9, 1.2);
    const parts = [];
    const add = (pts, pos, rot) => parts.push(P.add(pts.length >= 20 ? chippedHull(pts, 0.12) : new ConvexGeometry(pts), lo, { matrix: mat(pos, rot), sway: 0 }));
    const top = (pts) => pts.reduce((m, p) => Math.max(m, p.y), 0);
    // half sunk into the ground
    const sunk = ground - r * sy * 0.22;
    if (style === 1) {
      // split boulder, one stone cracked in two with the halves leaning apart
      const pts = rockPoints(rng, r, sx, sy, sz, 2, 36, 0.3);
      const a = rng.range(0, Math.PI);
      const n = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const gap = r * 0.05;
      for (const side of [1, -1]) {
        const half = pts.map((p) => {
          const o = p.dot(n) * side;
          return o < gap ? p.clone().addScaledVector(n, (gap - o) * side) : p.clone();
        });
        const lean = side * rng.range(0.06, 0.14);
        add(half, new THREE.Vector3(n.x * side * gap * 0.5, sunk, n.z * side * gap * 0.5), new THREE.Euler(n.z * lean, 0, -n.x * lean));
      }
    } else if (style === 2) {
      // a smaller stone balanced on top
      const pts = rockPoints(rng, r, sx, sy, sz, 3, 34, 0.3);
      add(pts, new THREE.Vector3(0, sunk, 0), new THREE.Euler(0, rng.range(0, 6.3), 0));
      const rr = r * rng.range(0.4, 0.55);
      const up = rockPoints(rng, rr, 1.1, 0.8, 1, 2, 20, 0.35);
      add(up, new THREE.Vector3(rng.range(-0.2, 0.2) * r, sunk + top(pts) - rr * 0.12, rng.range(-0.2, 0.2) * r), new THREE.Euler(rng.range(-0.2, 0.2), rng.range(0, 6.3), rng.range(-0.2, 0.2)));
    } else if (style === 3) {
      // a cluster of three
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + rng.range(-0.3, 0.3);
        const rr = r * (i === 0 ? 0.75 : rng.range(0.45, 0.6));
        add(rockPoints(rng, rr, sx, sy, sz, 2, 24, 0.3), new THREE.Vector3(Math.cos(a) * r * 0.55 * (i ? 1 : 0.3), ground - rr * sy * 0.35, Math.sin(a) * r * 0.55 * (i ? 1 : 0.3)), new THREE.Euler(0, rng.range(0, 6.3), rng.range(-0.15, 0.15)));
      }
    } else {
      add(rockPoints(rng, r, sx, sy, sz, 3, 36, 0.3), new THREE.Vector3(0, sunk, 0), new THREE.Euler(0, rng.range(0, 6.3), 0));
      const a = rng.range(0, Math.PI * 2);
      const rr = r * rng.range(0.45, 0.6);
      add(rockPoints(rng, rr, 1, 0.8, 1, 2, 20, 0.3), new THREE.Vector3(Math.cos(a) * r * sx * 0.75, ground - rr * 0.3, Math.sin(a) * r * sz * 0.75), new THREE.Euler(rng.range(-0.3, 0.3), rng.range(0, 6.3), rng.range(-0.3, 0.3)));
    }
    // rubble that broke off
    const bits = rng.int(3, 5);
    for (let i = 0; i < bits; i++) {
      const a = rng.range(0, Math.PI * 2), d = r * rng.range(1.15, 1.6);
      add(rockPoints(rng, r * rng.range(0.08, 0.16), 1, 0.7, 1, 1, 10, 0.3), new THREE.Vector3(Math.cos(a) * d * sx, ground - 0.04, Math.sin(a) * d * sz), new THREE.Euler(rng.range(-0.3, 0.3), rng.range(0, 6.3), 0));
    }
    paintChunks(parts, { lo, hi, cover: rockCover(sp), ao: 0.3, strata: r * 0.3, seed: sp.seed });
    return 2;
  },

  obsidian(rng, sp, P) {
    const ground = sp.sink ?? 0.25;
    const glass = jitter(rng, '#1c1820', 0.05);
    const sheen = glass.clone().lerp(new THREE.Color(sp.palette.glow), 0.25).offsetHSL(0, 0, 0.12);
    const shine = (g) => ramp(g, [[0, glass.clone().multiplyScalar(0.6)], [0.65, glass], [1, sheen]]);
    const n = rng.int(3, 6);
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996 + rng.range(-0.3, 0.3);
      const hh = rng.range(0.8, 1.7) * (i === 0 ? 1.3 : 1 - i * 0.08);
      const w = rng.range(0.22, 0.38) * (i === 0 ? 1.2 : 1), th = w * rng.range(0.35, 0.55);
      // blade: a lens shaped base, pinched above the middle, sharp tip
      const pts = [];
      for (let k = 0; k < 5; k++) {
        const b = (k / 5) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(b) * w, rng.range(0, 0.05), Math.sin(b) * th));
      }
      for (let k = 0; k < 4; k++) {
        const b = (k / 4) * Math.PI * 2 + 0.4;
        pts.push(new THREE.Vector3(Math.cos(b) * w * 0.7, hh * rng.range(0.45, 0.6), Math.sin(b) * th * 0.7));
      }
      pts.push(new THREE.Vector3(w * rng.range(-0.4, 0.4), hh, 0));
      const tilt = i === 0 ? rng.range(0, 0.15) : rng.range(0.25, 0.7);
      const dir = new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt));
      shine(P.add(new ConvexGeometry(pts), glass, { matrix: qmat(new THREE.Vector3(Math.cos(a) * 0.18, ground - 0.15, Math.sin(a) * 0.18), aim(dir, rng.range(0, 3))), sway: 0 }));
    }
    const bits = rng.int(2, 3);
    for (let i = 0; i < bits; i++) {
      const a = rng.range(0, Math.PI * 2), d = rng.range(0.45, 0.85);
      shine(P.add(hullRock(rng, rng.range(0.08, 0.16), 1, 0.7, 1, 1, 8, 0.2), glass, { matrix: mat(new THREE.Vector3(Math.cos(a) * d, ground - 0.03, Math.sin(a) * d), new THREE.Euler(rng.range(-0.4, 0.4), rng.range(0, 6.3), 0)), sway: 0 }));
    }
    return 1.5;
  },

  crystal(rng, sp, P) {
    const pal = sp.palette;
    const style = sp.style;
    const ground = sp.sink ?? 0.25;
    const col = new THREE.Color(sp.crystalColor);
    const deep = col.clone().multiplyScalar(0.58);
    const pale = col.clone().lerp(new THREE.Color('#ffffff'), 0.27);
    // glow builds toward the tips so the node reads from a distance and at night
    const shine = (g) => {
      ramp(g, [[0, deep, 0.7], [0.5, col, 1.0], [1, pale, 1.6]]);
      const normal = g.attributes.normal;
      const color = g.attributes.color;
      for (let i = 0; i < normal.count; i++) {
        const facet = 0.84 + Math.max(0, normal.getY(i)) * 0.12 + normal.getX(i) * 0.07 - normal.getZ(i) * 0.035;
        color.setXYZ(i, color.getX(i) * facet, color.getY(i) * facet, color.getZ(i) * facet);
      }
      return g;
    };
    // the rock the crystals grow out of
    const base = P.add(hullRock(rng, 0.55, 1.3, 0.55, 1.15, 2, 18, 0.3), pal.cliff, { matrix: mat(new THREE.Vector3(0, ground - 0.12, 0), new THREE.Euler(0, rng.range(0, 6.3), 0)), sway: 0 });
    paintChunks([base], { lo: jitter(rng, pal.cliff, 0.08).multiplyScalar(0.8), hi: jitter(rng, pal.high, 0.08), cover: rockCover(sp), ao: 0.3 });
    // Sunburst, fat tower, two clumps side by side, or twins. This is the
    // resource players hunt for, so every style stays at least as chunky and
    // wide as a plain cluster.
    const clumps = style === 2 ? [[-0.32, 0, 1], [0.38, 0.12, 0.8]] : [[0, 0, 1]];
    for (const [cx, cz, s] of clumps) {
      const n = style === 2 ? 5 : style === 1 ? 7 : 8;
      for (let i = 0; i < n; i++) {
        const main = i === 0 || (style === 3 && i === 1);
        const a = i * 2.39996 + rng.range(-0.3, 0.3);
        let hh = (main ? rng.range(1.5, 2.0) : rng.range(0.85, 1.35) * (1 - i / (n * 3))) * s;
        let rr = (main ? rng.range(0.28, 0.35) : rng.range(0.15, 0.22)) * s;
        const tilt = main ? rng.range(0, 0.12) + (style === 3 && i === 1 ? 0.3 : 0) : rng.range(0.25, 0.6);
        if (style === 1 && main) {
          hh *= 1.2;
          rr *= 1.25;
        }
        const dir = new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt));
        const off = i === 0 ? 0 : rng.range(0.08, 0.2);
        shine(P.add(crystalPrism(rr, hh * 0.78, 6, hh * 0.22 + rr * 0.8, rng.range(0.88, 0.97), rng.range(-0.4, 0.4)), col, { matrix: qmat(new THREE.Vector3(cx + Math.cos(a) * off, ground - 0.2, cz + Math.sin(a) * off), aim(dir, rng.range(0, Math.PI))), sway: 0 }));
      }
    }
    // loose shards on the ground so the node reads wider from a distance
    const shards = rng.int(3, 4);
    for (let i = 0; i < shards; i++) {
      const a = rng.range(0, Math.PI * 2), d = rng.range(0.65, 1.0);
      const hh = rng.range(0.28, 0.42), tilt = rng.range(0.9, 1.25);
      const dir = new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt));
      shine(P.add(crystalPrism(rng.range(0.06, 0.09), hh * 0.7, 4, hh * 0.3, 0.85, 0), col, { matrix: qmat(new THREE.Vector3(Math.cos(a) * d, ground - 0.03, Math.sin(a) * d), aim(dir, rng.range(0, 3))), sway: 0 }));
    }
    return 1.5;
  },

  iceshard(rng, sp, P) {
    const ground = sp.sink ?? 0.25;
    const deep = new THREE.Color('#4f9ee0').lerp(new THREE.Color(sp.palette.glow || '#80d8ff'), 0.3);
    const mid = new THREE.Color('#a8dcff'), pale = new THREE.Color('#f2fbff');
    const n = rng.int(3, 6);
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996 + rng.range(-0.3, 0.3);
      const hh = rng.range(1.2, 3.2) * (i === 0 ? 1.3 : 1);
      const rr = rng.range(0.2, 0.36) * (i === 0 ? 1.2 : 1);
      const tilt = i === 0 ? rng.range(0, 0.12) : rng.range(0.15, 0.5);
      const dir = new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt));
      const d = i === 0 ? 0.05 : rng.range(0.2, 0.4);
      const g = P.add(crystalPrism(rr, hh * 0.45, 5, hh * 0.55, 0.72, rng.range(-0.3, 0.3)), mid, { matrix: qmat(new THREE.Vector3(Math.cos(a) * d, ground - 0.15, Math.sin(a) * d), aim(dir, rng.range(0, 3))), sway: 0 });
      ramp(g, [[0, deep, 0.15], [0.5, mid, 0.3], [1, pale, 0.6]]);
    }
    // snow drifted up around the base, plus a couple of broken chunks
    const drift = P.add(hullRock(rng, 0.65, 1.3, 0.35, 1.2, 1, 16, 0.25), '#ffffff', { matrix: mat(new THREE.Vector3(0, ground - 0.1, 0)), sway: 0 });
    ramp(drift, [[0, '#c4d8ee', 0], [1, '#ffffff', 0.05]]);
    const bits = rng.int(1, 3);
    for (let i = 0; i < bits; i++) {
      const a = rng.range(0, Math.PI * 2), d = rng.range(0.7, 1.1);
      const g = P.add(hullRock(rng, rng.range(0.1, 0.18), 1, 0.9, 1, 1, 8, 0.3), mid, { matrix: mat(new THREE.Vector3(Math.cos(a) * d, ground - 0.04, Math.sin(a) * d), new THREE.Euler(rng.range(-0.5, 0.5), rng.range(0, 6.3), 0)), sway: 0 });
      ramp(g, [[0, deep, 0.1], [1, pale, 0.3]]);
    }
    return 3;
  },

  floater(rng, sp, P) {
    const pal = sp.palette;
    const r = rng.range(1.2, 2.2);
    // earthy and fairly light, it's mostly seen from below against the sky
    const sand = new THREE.Color(pal.sand || pal.high);
    const lo = jitter(rng, pal.cliff, 0.1).lerp(new THREE.Color(pal.high), 0.5).lerp(sand, 0.25);
    const hi = jitter(rng, pal.high, 0.1).lerp(sand, 0.5).offsetHSL(0, 0, 0.06);
    const cover = { ...(rockCover(sp) || { color: pal.veg || pal.leaf[0] }), at: 0.35 };
    const glowCol = new THREE.Color(pal.glow || pal.leaf[1]);
    // Island: a grassy top over a squat rocky mass with a few chunks hanging
    // off it, so from the ground it reads as a floating island and not as a
    // clean cone.
    const rows = [[1.0, 0], [0.95, -0.3], [0.78, -0.7], [0.5, -1.05], [0, -1.35]];
    const under = (f) => {
      let j = 0;
      while (j < rows.length - 2 && rows[j + 1][0] > f) j++;
      const k = (rows[j][0] - f) / (rows[j][0] - rows[j + 1][0]);
      return r * (rows[j][1] + (rows[j + 1][1] - rows[j][1]) * k);
    };
    const pts = [];
    for (let j = 0; j < 4; j++) {
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2 + j * 0.4 + rng.range(-0.2, 0.2);
        const d = r * rows[j][0] * rng.range(0.82, 1.08);
        pts.push(new THREE.Vector3(Math.cos(a) * d * 1.15, r * (rows[j][1] + rng.range(-0.1, 0.1)), Math.sin(a) * d));
      }
    }
    for (let k = 0; k < 4; k++) {
      const a = rng.range(0, Math.PI * 2), d = r * rng.range(0, 0.6);
      pts.push(new THREE.Vector3(Math.cos(a) * d, r * rng.range(0.08, 0.2), Math.sin(a) * d));
    }
    pts.push(new THREE.Vector3(r * rng.range(-0.2, 0.2), -r * rng.range(1.25, 1.45), r * rng.range(-0.2, 0.2)));
    const parts = [P.add(new ConvexGeometry(pts), lo, { sway: 0 })];
    // chunks hanging off the underside, each ends in a blunt point
    const lumps = rng.int(2, 3);
    for (let i = 0; i < lumps; i++) {
      const a = (i / lumps) * Math.PI * 2 + rng.range(-0.5, 0.5), f = rng.range(0.3, 0.55);
      const lr = r * rng.range(0.28, 0.4);
      const lp = [];
      for (let k = 0; k < 6; k++) {
        const b = (k / 6) * Math.PI * 2 + rng.range(-0.3, 0.3);
        lp.push(new THREE.Vector3(Math.cos(b) * lr, rng.range(0, 0.1) * lr, Math.sin(b) * lr));
        if (k % 2) lp.push(new THREE.Vector3(Math.cos(b) * lr * 0.65, -lr * rng.range(0.8, 1.1), Math.sin(b) * lr * 0.65));
      }
      lp.push(new THREE.Vector3(lr * rng.range(-0.2, 0.2), -lr * rng.range(1.5, 2.1), lr * rng.range(-0.2, 0.2)));
      parts.push(P.add(new ConvexGeometry(lp), lo, { matrix: mat(new THREE.Vector3(Math.cos(a) * r * f * 1.15, under(f) + lr * 0.4, Math.sin(a) * r * f)), sway: 0 }));
    }
    paintChunks(parts, { lo, hi, cover, ao: 0.1, strata: r * 0.2, band: 0.35, seed: sp.seed });
    // grass spills over the rim, and faces that point down get a lighter tint
    // like bounce light off the ground, otherwise the underside goes black
    const cc = new THREE.Color(cover.color).toArray();
    const bounce = hi.clone().lerp(sand, 0.4).toArray();
    const V = new THREE.Vector3(), W = new THREE.Vector3();
    for (const g of parts) {
      const pa = g.attributes.position.array, ca = g.attributes.color.array;
      for (let i = 0; i < pa.length; i += 9) {
        V.set(pa[i + 3] - pa[i], pa[i + 4] - pa[i + 1], pa[i + 5] - pa[i + 2]);
        W.set(pa[i + 6] - pa[i], pa[i + 7] - pa[i + 1], pa[i + 8] - pa[i + 2]);
        const down = Math.max(0, -V.cross(W).normalize().y) * 0.6;
        for (let j = i; j < i + 9; j += 3) {
          const k = g === parts[0] ? THREE.MathUtils.smoothstep(pa[j + 1], -r * 0.45, -r * 0.05) * 0.85 : 0;
          for (let c = 0; c < 3; c++) {
            const lit = ca[j + c] + (bounce[c] - ca[j + c]) * down;
            ca[j + c] = lit + (cc[c] - lit) * k;
          }
        }
      }
    }
    // pebbles drifting alongside
    for (let i = 0; i < 2; i++) {
      const a = rng.range(0, Math.PI * 2), d = r * rng.range(1.4, 1.9);
      const g = P.add(hullRock(rng, r * rng.range(0.14, 0.24), 1, 0.9, 1, 2, 12, 0.6), lo, { matrix: mat(new THREE.Vector3(Math.cos(a) * d, r * rng.range(-1.0, 0.2), Math.sin(a) * d), new THREE.Euler(rng.range(-0.4, 0.4), rng.range(0, 6.3), rng.range(-0.4, 0.4))), sway: 0 });
      paintChunks([g], { lo, hi, cover, ao: 0.15 });
    }
    // roots hanging off the underside with glowing tips
    const rootCol = jitter(rng, pal.trunk).lerp(new THREE.Color(pal.leaf[0]), 0.3);
    const roots = rng.int(6, 8);
    for (let i = 0; i < roots; i++) {
      const a = rng.range(0, Math.PI * 2), f = rng.range(0.15, 0.75);
      const start = new THREE.Vector3(Math.cos(a) * r * f, under(f) + 0.15, Math.sin(a) * r * f);
      const len = rng.range(1.2, 3.2);
      const pts = [];
      for (let k = 0; k <= 4; k++) {
        const t = k / 4;
        pts.push(start.clone().add(new THREE.Vector3(Math.sin(t * 3 + a) * 0.25 * t, -len * t, Math.cos(t * 2.5 + a) * 0.25 * t)));
      }
      const g = P.add(sweepTube(pts, 0.08, 0.025, 3), rootCol, { sway: 0 });
      ramp(g, [[0, rootCol, 0], [0.6, rootCol.clone().lerp(new THREE.Color(pal.leaf[1]), 0.5), 0.2], [1, glowCol, 1]]);
      P.add(new THREE.OctahedronGeometry(0.12, 0), glowCol, { matrix: mat(pts[4], null, new THREE.Vector3(1, 1.5, 1)), glow: 2, sway: 0 });
    }
    // vines trailing over the rim
    const vines = rng.int(3, 4);
    for (let i = 0; i < vines; i++) {
      const a = rng.range(0, Math.PI * 2);
      const start = new THREE.Vector3(Math.cos(a) * r * 1.05, -r * 0.05, Math.sin(a) * r * 0.92);
      const len = rng.range(0.8, 1.6);
      const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.15);
      const g = P.add(sweepTube([start, start.clone().add(out).add(new THREE.Vector3(0, -len * 0.4, 0)), start.clone().addScaledVector(out, 0.8).add(new THREE.Vector3(0, -len, 0))], 0.05, 0.02, 3), pal.leaf[i % 3], { sway: 0 });
      ramp(g, [[0, jitter(rng, pal.leaf[i % 3]), 0], [1, glowCol.clone().lerp(new THREE.Color(pal.leaf[2]), 0.4), 0.8]]);
    }
    const drips = rng.int(3, 4);
    for (let i = 0; i < drips; i++) {
      const a = rng.range(0, Math.PI * 2), f = rng.range(0.1, 0.45);
      const hh = rng.range(0.5, 1.1);
      const g = P.add(crystalPrism(rng.range(0.09, 0.15), hh * 0.6, 5, hh * 0.4, 0.8), glowCol, { matrix: qmat(new THREE.Vector3(Math.cos(a) * r * f, under(f) + 0.2, Math.sin(a) * r * f), aim(new THREE.Vector3(rng.range(-0.2, 0.2), -1, rng.range(-0.2, 0.2)))), sway: 0 });
      ramp(g, [[0, glowCol.clone().multiplyScalar(0.6), 0.8], [1, glowCol.clone().lerp(new THREE.Color('#ffffff'), 0.3), 2]]);
    }
    // a tiny grove on top
    const trees = rng.int(1, 2);
    for (let i = 0; i < trees; i++) {
      const a = rng.range(0, Math.PI * 2), d = r * rng.range(0, 0.45);
      const b = new THREE.Vector3(Math.cos(a) * d, r * 0.08, Math.sin(a) * d);
      const th = rng.range(0.7, 1.4);
      const lean = new THREE.Vector3(rng.range(-0.15, 0.15), 0, rng.range(-0.15, 0.15));
      const tip = b.clone().add(new THREE.Vector3(0, th, 0)).add(lean);
      ramp(P.add(sweepTube([b, b.clone().add(new THREE.Vector3(0, th * 0.5, 0)).addScaledVector(lean, 0.3), tip], 0.08, 0.04, 4), pal.trunk, { sway: 0.4 }), [[0, jitter(rng, pal.trunk).multiplyScalar(0.7)], [1, jitter(rng, pal.trunk)]]);
      const cr = rng.range(0.4, 0.6);
      const c = P.add(lumpy(rng, cr, 0, 0.2, new THREE.Vector3(1, 0.8, 1)), pal.leaf[i % 3], { matrix: mat(tip.clone().add(new THREE.Vector3(0, cr * 0.5, 0))), sway: 0.6 });
      ramp(c, [[0, jitter(rng, pal.leaf[i % 3]).multiplyScalar(0.65), 0], [1, jitter(rng, pal.leaf[(i + 1) % 3]), 0]]);
    }
    const buds = rng.int(2, 4);
    for (let i = 0; i < buds; i++) {
      const a = rng.range(0, Math.PI * 2), d = r * rng.range(0.2, 0.8);
      P.add(new THREE.OctahedronGeometry(0.07, 0), glowCol, { matrix: mat(new THREE.Vector3(Math.cos(a) * d * 1.1, r * 0.12, Math.sin(a) * d), null, new THREE.Vector3(1, 1.6, 1)), glow: 1.5, sway: 0.3 });
    }
    return 3;
  },

  spire(rng, sp, P) {
    const pal = sp.palette;
    const style = sp.style;
    const ground = sp.sink ?? 0.25;
    const h = rng.range(8, 16);
    const cover = rockCover(sp);
    // stacked strata, each layer its own slab and color band. Tapering spire,
    // hoodoo with a wide cap stone, offset balanced slabs, or a flat topped pillar.
    const bands = [pal.cliff, pal.high, pal.mid || pal.high, pal.cliff, pal.sand || pal.high];
    const layers = rng.int(5, 8);
    const hs = [];
    let sum = 0;
    for (let i = 0; i < layers; i++) {
      const v = rng.range(0.6, 1.4) * (style === 1 && i === layers - 1 ? 0.55 : 1);
      hs.push(v);
      sum += v;
    }
    const r0 = rng.range(1.3, 1.8);
    const bandOff = rng.int(0, 4);
    let y = 0, x = 0, z = 0;
    for (let i = 0; i < layers; i++) {
      const t = i / (layers - 1);
      const last = i === layers - 1;
      const lh = (h * hs[i]) / sum;
      let rr = r0 * (0.9 - 0.12 * t);
      if (style === 0) rr = r0 * (1 - 0.6 * t);
      else if (style === 1) rr = last ? r0 * rng.range(0.85, 1.05) : r0 * (1 - 0.5 * t);
      else if (style === 2) rr = r0 * rng.range(0.6, 1.0) * (1 - 0.3 * t);
      const pts = [];
      const rot = rng.range(0, 1);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + rot;
        const d0 = rr * rng.range(0.88, 1.05);
        const d1 = rr * rng.range(0.78, 0.92) * (style === 0 && last ? 0.4 : 1);
        pts.push(new THREE.Vector3(x + Math.cos(a) * d0, y, z + Math.sin(a) * d0), new THREE.Vector3(x + Math.cos(a + 0.2) * d1, y + lh, z + Math.sin(a + 0.2) * d1));
      }
      if (style === 0 && last) pts.push(new THREE.Vector3(x, y + lh * 1.7, z));
      const col = jitter(rng, style === 1 && last ? pal.cliff : bands[(i + bandOff) % bands.length], 0.06);
      const g = P.add(new ConvexGeometry(pts), col, { sway: 0 });
      paintRock(g, { lo: col.clone().multiplyScalar(0.7), hi: col.clone().offsetHSL(0, 0, 0.04), y0: y, h: lh, cover, ao: 0.25 });
      y += lh * 0.98;
      const drift = style === 2 ? 0.45 : 0.18;
      x += rng.range(-drift, drift) * rr;
      z += rng.range(-drift, drift) * rr;
    }
    const rubble = [];
    const n = rng.int(4, 6);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2), d = r0 * rng.range(1.05, 1.6);
      rubble.push(P.add(hullRock(rng, rng.range(0.2, 0.45), 1, 0.7, 1, 2, 12, 0.3), pal.cliff, { matrix: mat(new THREE.Vector3(Math.cos(a) * d, ground - 0.08, Math.sin(a) * d), new THREE.Euler(0, rng.range(0, 6.3), 0)), sway: 0 }));
    }
    paintChunks(rubble, { lo: jitter(rng, pal.cliff, 0.08).multiplyScalar(0.8), hi: jitter(rng, pal.high, 0.08), cover, ao: 0.3 });
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

// Far version of a species mesh, drawn past the LOD switch in scatter.js.
// Quadric edge collapse (Garland and Heckbert): vertices are welded by
// position, every edge gets the cost of merging its two ends, and the cheapest
// merges run until the next one would move the surface or its colors more
// than maxErr (in meters, roughly an RMS distance). Open edges get extra
// planes so leaves and petals keep their outline, merges that flip a face are
// skipped, and pieces bigger than a few error widths never shrink below a
// thin cone, so branches and fronds stay visible lines. Welded vertices
// average their normals, sway and so on, so far away it shades a bit
// smoother. Corners whose normals differ by more than the crease (a cosine)
// stay apart, or the light top and dark underside of a fir tier would blend
// at the rim. Pass -1 for flat shaded materials, where normals don't matter.
// Returns a non-indexed geometry with the same attributes as the input.
export function simplifyFlora(geo, maxErr, crease = 0.8) {
  const src = geo.attributes;
  const n = src.position.count;
  const ids = new Map();
  const remap = new Int32Array(n);
  const pos = [], nrm = [], col = [], glow = [], sway = [], cnt = [], first = [];
  for (let i = 0; i < n; i++) {
    const x = src.position.getX(i), y = src.position.getY(i), z = src.position.getZ(i);
    const nx = src.normal.getX(i), ny = src.normal.getY(i), nz = src.normal.getZ(i);
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let list = ids.get(key);
    if (!list) ids.set(key, (list = []));
    let v = list.find((u) => first[u * 3] * nx + first[u * 3 + 1] * ny + first[u * 3 + 2] * nz > crease);
    if (v === undefined) {
      v = cnt.length;
      list.push(v);
      first.push(nx, ny, nz);
      pos.push(x, y, z);
      nrm.push(0, 0, 0);
      col.push(0, 0, 0);
      glow.push(0);
      sway.push(0);
      cnt.push(0);
    }
    remap[i] = v;
    nrm[v * 3] += src.normal.getX(i);
    nrm[v * 3 + 1] += src.normal.getY(i);
    nrm[v * 3 + 2] += src.normal.getZ(i);
    col[v * 3] += src.color.getX(i);
    col[v * 3 + 1] += src.color.getY(i);
    col[v * 3 + 2] += src.color.getZ(i);
    glow[v] += src.aGlow.getX(i);
    sway[v] += src.aSway.getX(i);
    cnt[v]++;
  }
  const nv = cnt.length;
  for (let v = 0; v < nv; v++) {
    const k = 1 / cnt[v];
    for (let j = 0; j < 3; j++) col[v * 3 + j] *= k;
    glow[v] *= k;
    sway[v] *= k;
    const l = Math.hypot(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
    if (l > 1e-6) for (let j = 0; j < 3; j++) nrm[v * 3 + j] /= l;
    else nrm[v * 3 + 1] = 1;
  }

  const nf = n / 3;
  const F = new Int32Array(n);
  const faceAlive = new Uint8Array(nf);
  const vf = [];
  for (let v = 0; v < nv; v++) vf.push([]);
  for (let f = 0; f < nf; f++) {
    const a = remap[f * 3], b = remap[f * 3 + 1], c = remap[f * 3 + 2];
    F[f * 3] = a;
    F[f * 3 + 1] = b;
    F[f * 3 + 2] = c;
    if (a === b || b === c || a === c) continue;
    faceAlive[f] = 1;
    vf[a].push(f);
    vf[b].push(f);
    vf[c].push(f);
  }

  // Connected pieces. Pieces bigger than a few error widths, or glowing, keep
  // at least a thin cone or a pair of faces: a branch or frond that thin is
  // still a visible line from far away. Smaller ones may vanish.
  const root = new Int32Array(nv).map((_, i) => i);
  const find = (x) => {
    while (root[x] !== x) x = root[x] = root[root[x]];
    return x;
  };
  for (let f = 0; f < nf; f++) {
    if (!faceAlive[f]) continue;
    root[find(F[f * 3 + 1])] = find(F[f * 3]);
    root[find(F[f * 3 + 2])] = find(F[f * 3]);
  }
  const comp = new Int32Array(nv);
  const box = new Map();
  for (let v = 0; v < nv; v++) {
    comp[v] = find(v);
    let b = box.get(comp[v]);
    if (!b) box.set(comp[v], (b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity, 0]));
    for (let j = 0; j < 3; j++) {
      b[j] = Math.min(b[j], pos[v * 3 + j]);
      b[j + 3] = Math.max(b[j + 3], pos[v * 3 + j]);
    }
    b[6] = Math.max(b[6], glow[v]);
  }
  const keep = new Uint8Array(nv);
  const compFaces = new Int32Array(nv);
  for (const [c, b] of box) keep[c] = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) > maxErr * 4 || b[6] > 0.3 ? 1 : 0;
  for (let f = 0; f < nf; f++) if (faceAlive[f]) compFaces[comp[F[f * 3]]]++;

  // Per vertex quadrics. Faces are planes in position plus color (rgb and
  // glow), the Garland and Heckbert extension for vertex colors: colors carry
  // the shading here, and a merge that smears one across bigger faces (a
  // fir's frosted rim tinting the whole tier) should cost like one that bends
  // the shape. A full color step counts as 2.5 error widths. That part is
  // area weighted and divided by the area, so it's a mean. Open edges add
  // plain position planes that are summed instead, which can't hide one badly
  // moved edge in an average, and count double: an outline is most of what
  // shows of a palm frond a few pixels wide.
  const QN = 36;
  const cs = maxErr * 2.5;
  const QF = new Float64Array(nv * QN);
  const QB = new Float64Array(nv * 10);
  const W = new Float64Array(nv);
  const pt = (v, out) => {
    for (let j = 0; j < 3; j++) {
      out[j] = pos[v * 3 + j];
      out[3 + j] = col[v * 3 + j] * cs;
    }
    out[6] = glow[v] * 0.5 * cs;
  };
  const p1 = new Float64Array(7), p2 = new Float64Array(7), p3 = new Float64Array(7);
  const f1 = new Float64Array(7), f2 = new Float64Array(7);
  const faceQuadric = (a, b, c, w) => {
    pt(a, p1);
    pt(b, p2);
    pt(c, p3);
    let l1 = 0;
    for (let j = 0; j < 7; j++) l1 += (f1[j] = p2[j] - p1[j]) ** 2;
    l1 = Math.sqrt(l1);
    if (l1 < 1e-9) return;
    let d = 0;
    for (let j = 0; j < 7; j++) {
      f1[j] /= l1;
      d += (p3[j] - p1[j]) * f1[j];
    }
    let l2 = 0;
    for (let j = 0; j < 7; j++) l2 += (f2[j] = p3[j] - p1[j] - d * f1[j]) ** 2;
    l2 = Math.sqrt(l2);
    if (l2 < 1e-9) return;
    let s1 = 0, s2 = 0, pp = 0;
    for (let j = 0; j < 7; j++) {
      f2[j] /= l2;
      s1 += p1[j] * f1[j];
      s2 += p1[j] * f2[j];
      pp += p1[j] * p1[j];
    }
    for (const v of [a, b, c]) {
      const q = v * QN;
      let k = 0;
      for (let i = 0; i < 7; i++) for (let j = i; j < 7; j++) QF[q + k++] += w * ((i === j ? 1 : 0) - f1[i] * f1[j] - f2[i] * f2[j]);
      for (let i = 0; i < 7; i++) QF[q + 28 + i] += w * (s1 * f1[i] + s2 * f2[i] - p1[i]);
      QF[q + 35] += w * (pp - s1 * s1 - s2 * s2);
      W[v] += w;
    }
  };
  const edgePlane = (v, nx, ny, nz, d) => {
    const q = v * 10;
    QB[q] += nx * nx;
    QB[q + 1] += nx * ny;
    QB[q + 2] += nx * nz;
    QB[q + 3] += nx * d;
    QB[q + 4] += ny * ny;
    QB[q + 5] += ny * nz;
    QB[q + 6] += ny * d;
    QB[q + 7] += nz * nz;
    QB[q + 8] += nz * d;
    QB[q + 9] += d * d;
  };
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3();
  const faceNormal = (a, b, c, out) => {
    e1.set(pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]);
    e2.set(pos[c * 3] - pos[a * 3], pos[c * 3 + 1] - pos[a * 3 + 1], pos[c * 3 + 2] - pos[a * 3 + 2]);
    return out.crossVectors(e1, e2);
  };
  const edges = new Map();
  for (let f = 0; f < nf; f++) {
    if (!faceAlive[f]) continue;
    const a = F[f * 3], b = F[f * 3 + 1], c = F[f * 3 + 2];
    const area = faceNormal(a, b, c, fn).length() / 2;
    if (area < 1e-10) continue;
    fn.normalize();
    faceQuadric(a, b, c, area);
    for (const [u, w] of [[a, b], [b, c], [c, a]]) {
      const key = Math.min(u, w) * nv + Math.max(u, w);
      const e = edges.get(key);
      if (e) e.n++;
      else edges.set(key, { u, w, n: 1, nx: fn.x, ny: fn.y, nz: fn.z });
    }
  }
  // a plane through each open edge, standing up from its face
  const bn = new THREE.Vector3();
  for (const e of edges.values()) {
    if (e.n !== 1) continue;
    const { u, w } = e;
    e1.set(pos[w * 3] - pos[u * 3], pos[w * 3 + 1] - pos[u * 3 + 1], pos[w * 3 + 2] - pos[u * 3 + 2]);
    if (e1.lengthSq() < 1e-12) continue;
    bn.crossVectors(e1, e2.set(e.nx, e.ny, e.nz)).normalize();
    const d = -(bn.x * pos[u * 3] + bn.y * pos[u * 3 + 1] + bn.z * pos[u * 3 + 2]);
    edgePlane(u, bn.x, bn.y, bn.z, d);
    edgePlane(w, bn.x, bn.y, bn.z, d);
  }

  // min heap of candidate merges, stale ones are skipped when popped
  const limit = maxErr * maxErr;
  const hCost = [], hA = [], hB = [], hT = [], hX = [], hY = [], hZ = [], hSa = [], hSb = [];
  const heap = [];
  const stamp = new Int32Array(nv);
  const vAlive = new Uint8Array(nv).fill(1);
  // which vertex each merged one went into
  const parent = new Int32Array(nv);
  // the quadrics of an edge's two ends, added up
  const qf = new Float64Array(QN), qb = new Float64Array(10), v7 = new Float64Array(7);
  let ea = 0, eb = 0;
  // error at a point on the edge, t along it for the color
  const qerr = (x, y, z, t) => {
    v7[0] = x;
    v7[1] = y;
    v7[2] = z;
    for (let j = 0; j < 3; j++) v7[3 + j] = (col[ea * 3 + j] + (col[eb * 3 + j] - col[ea * 3 + j]) * t) * cs;
    v7[6] = (glow[ea] + (glow[eb] - glow[ea]) * t) * 0.5 * cs;
    let e = qf[35], k = 0;
    for (let i = 0; i < 7; i++) {
      for (let j = i; j < 7; j++) e += (i === j ? 1 : 2) * qf[k++] * v7[i] * v7[j];
      e += 2 * qf[28 + i] * v7[i];
    }
    const eb2 = qb[0] * x * x + 2 * qb[1] * x * y + 2 * qb[2] * x * z + 2 * qb[3] * x + qb[4] * y * y + 2 * qb[5] * y * z + 2 * qb[6] * y + qb[7] * z * z + 2 * qb[8] * z + qb[9];
    return Math.max(0, e) + Math.max(0, eb2);
  };
  const push = (a, b) => {
    const wt = Math.max(1e-9, W[a] + W[b]);
    for (let j = 0; j < QN; j++) qf[j] = (QF[a * QN + j] + QF[b * QN + j]) / wt;
    for (let j = 0; j < 10; j++) qb[j] = (QB[a * 10 + j] + QB[b * 10 + j]) * 2;
    ea = a;
    eb = b;
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const dx = pos[b * 3] - ax, dy = pos[b * 3 + 1] - ay, dz = pos[b * 3 + 2] - az;
    // best of the two ends, the middle, and the point the quadric likes best
    // (keeps thin tubes from shrinking) when it lands near the edge
    let t = 0, e = qerr(ax, ay, az, 0);
    for (const s of [1, 0.5]) {
      const es = qerr(ax + dx * s, ay + dy * s, az + dz * s, s);
      if (es < e) { t = s; e = es; }
    }
    let x = ax + dx * t, y = ay + dy * t, z = az + dz * t;
    // position block of both quadrics, with the color held at the middle
    const q0 = qf[0] + qb[0], q1 = qf[1] + qb[1], q2 = qf[2] + qb[2];
    const q4 = qf[7] + qb[4], q5 = qf[8] + qb[5], q7 = qf[13] + qb[7];
    let r0 = qf[28] + qb[3], r1 = qf[29] + qb[6], r2 = qf[30] + qb[8];
    for (let j = 3; j < 7; j++) {
      const c = j < 6 ? ((col[a * 3 + j - 3] + col[b * 3 + j - 3]) / 2) * cs : ((glow[a] + glow[b]) / 2) * 0.5 * cs;
      r0 += qf[j] * c;
      r1 += qf[6 + j] * c;
      r2 += qf[11 + j] * c;
    }
    const c0 = q4 * q7 - q5 * q5, c1 = q2 * q5 - q1 * q7, c2 = q1 * q5 - q2 * q4;
    const det = q0 * c0 + q1 * c1 + q2 * c2;
    if (Math.abs(det) > 1e-12 * (q0 + q4 + q7) ** 3) {
      const ox = -(c0 * r0 + c1 * r1 + c2 * r2) / det;
      const oy = -(c1 * r0 + (q0 * q7 - q2 * q2) * r1 + (q1 * q2 - q0 * q5) * r2) / det;
      const oz = -(c2 * r0 + (q1 * q2 - q0 * q5) * r1 + (q0 * q4 - q1 * q1) * r2) / det;
      const len2 = dx * dx + dy * dy + dz * dz;
      const s = ((ox - ax) * dx + (oy - ay) * dy + (oz - az) * dz) / Math.max(1e-12, len2);
      const off2 = (ox - ax - dx * s) ** 2 + (oy - ay - dy * s) ** 2 + (oz - az - dz * s) ** 2;
      const sc = Math.min(1, Math.max(0, s));
      const eo = qerr(ox, oy, oz, sc);
      if (eo < e && s > -0.5 && s < 1.5 && off2 < len2) {
        e = eo;
        t = sc;
        x = ox;
        y = oy;
        z = oz;
      }
    }
    const cost = e * (1 + 3 * Math.max(glow[a], glow[b]));
    const id = hCost.length;
    hCost.push(cost);
    hA.push(a);
    hB.push(b);
    hT.push(t);
    hX.push(x);
    hY.push(y);
    hZ.push(z);
    hSa.push(stamp[a]);
    hSb.push(stamp[b]);
    let i = heap.length;
    heap.push(id);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hCost[heap[p]] <= cost) break;
      heap[i] = heap[p];
      i = p;
    }
    heap[i] = id;
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      let i = 0;
      const c = hCost[last];
      for (;;) {
        let k = i * 2 + 1;
        if (k >= heap.length) break;
        if (k + 1 < heap.length && hCost[heap[k + 1]] < hCost[heap[k]]) k++;
        if (hCost[heap[k]] >= c) break;
        heap[i] = heap[k];
        i = k;
      }
      heap[i] = last;
    }
    return top;
  };
  for (const e of edges.values()) push(e.u, e.w);

  const np = new THREE.Vector3(), n0 = new THREE.Vector3(), n1 = new THREE.Vector3();
  const moved = [0, 0, 0];
  // would moving a and b to np tip or crush any face that survives the merge
  const flips = (a, b) => {
    for (const v of [a, b]) {
      for (const f of vf[v]) {
        if (!faceAlive[f]) continue;
        const i0 = F[f * 3], i1 = F[f * 3 + 1], i2 = F[f * 3 + 2];
        if ((i0 === a || i1 === a || i2 === a) && (i0 === b || i1 === b || i2 === b)) continue;
        faceNormal(i0, i1, i2, n0);
        const l0 = n0.length();
        if (l0 < 1e-12) continue;
        const save = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
        pos[v * 3] = np.x;
        pos[v * 3 + 1] = np.y;
        pos[v * 3 + 2] = np.z;
        faceNormal(i0, i1, i2, n1);
        pos[v * 3] = save[0];
        pos[v * 3 + 1] = save[1];
        pos[v * 3 + 2] = save[2];
        const l1 = n1.length();
        if (l1 < l0 * 0.02 || n0.dot(n1) < 0.5 * l0 * l1) return true;
      }
    }
    return false;
  };
  // Faces the merge would kill, or -1 if it would fold a face onto another
  // one (a cone flattening into a sliver, or a piece closing up)
  const kills = (a, b) => {
    const around = new Set();
    let n = 0;
    for (const f of vf[a]) {
      if (!faceAlive[f]) continue;
      const k = f * 3;
      if (F[k] === b || F[k + 1] === b || F[k + 2] === b) n++;
      else around.add(triKey(F[k], F[k + 1], F[k + 2]));
    }
    for (const f of vf[b]) {
      if (!faceAlive[f]) continue;
      const k = f * 3;
      if (F[k] === a || F[k + 1] === a || F[k + 2] === a) continue;
      const key = triKey(F[k] === b ? a : F[k], F[k + 1] === b ? a : F[k + 1], F[k + 2] === b ? a : F[k + 2]);
      if (around.has(key)) return -1;
      around.add(key);
    }
    return n;
  };
  const triKey = (x, y, z) => {
    const lo = Math.min(x, y, z), hi = Math.max(x, y, z);
    return (lo * nv + (x + y + z - lo - hi)) * nv + hi;
  };
  while (heap.length) {
    const id = pop();
    if (hCost[id] > limit) break;
    const a = hA[id], b = hB[id];
    if (!vAlive[a] || !vAlive[b] || stamp[a] !== hSa[id] || stamp[b] !== hSb[id]) continue;
    np.set(hX[id], hY[id], hZ[id]);
    if (flips(a, b)) continue;
    const c = comp[a];
    if (keep[c]) {
      const k = kills(a, b);
      if (k < 0 || compFaces[c] - k < 2) continue;
    }
    // b merges into a
    pos[a * 3] = np.x;
    pos[a * 3 + 1] = np.y;
    pos[a * 3 + 2] = np.z;
    // attributes follow where the new point sits along the edge
    const wb = hT[id];
    if (wb > 0) {
      for (let j = 0; j < 3; j++) {
        col[a * 3 + j] += (col[b * 3 + j] - col[a * 3 + j]) * wb;
        moved[j] = nrm[a * 3 + j] + (nrm[b * 3 + j] - nrm[a * 3 + j]) * wb;
      }
      const l = Math.hypot(moved[0], moved[1], moved[2]) || 1;
      for (let j = 0; j < 3; j++) nrm[a * 3 + j] = moved[j] / l;
      glow[a] += (glow[b] - glow[a]) * wb;
      sway[a] += (sway[b] - sway[a]) * wb;
    }
    for (let j = 0; j < QN; j++) QF[a * QN + j] += QF[b * QN + j];
    for (let j = 0; j < 10; j++) QB[a * 10 + j] += QB[b * 10 + j];
    W[a] += W[b];
    for (const f of vf[b]) {
      if (!faceAlive[f]) continue;
      const k = f * 3;
      if (F[k] === a || F[k + 1] === a || F[k + 2] === a) {
        faceAlive[f] = 0;
        compFaces[c]--;
        continue;
      }
      for (let j = 0; j < 3; j++) if (F[k + j] === b) F[k + j] = a;
      vf[a].push(f);
    }
    vAlive[b] = 0;
    parent[b] = a;
    vf[b] = [];
    vf[a] = vf[a].filter((f) => faceAlive[f]);
    stamp[a]++;
    const near = new Set();
    for (const f of vf[a]) for (let j = 0; j < 3; j++) near.add(F[f * 3 + j]);
    near.delete(a);
    for (const u of near) push(a, u);
  }

  // Far away a plant is a few pixels, and what shows is the average color of
  // its surface. Interpolating the kept vertices' colors across the bigger
  // faces gets that wrong (a fir's frosted lobe tips would tint the whole
  // tier). So every original face hands its area, color and glow to the
  // nearest far face around where its corners were merged, and each far face
  // is colored flat with the averages.
  const sp = src.position.array, sc = src.color.array, sg = src.aGlow.array;
  const alive = (v) => {
    while (!vAlive[v]) v = parent[v];
    return v;
  };
  const acc = new Float64Array(nf * 5);
  const q = new THREE.Vector3(), tri = new THREE.Triangle(), hit = new THREE.Vector3();
  const corner = (i, out) => out.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  for (let f = 0; f < nf; f++) {
    const k = f * 9;
    e1.set(sp[k + 3] - sp[k], sp[k + 4] - sp[k + 1], sp[k + 5] - sp[k + 2]);
    e2.set(sp[k + 6] - sp[k], sp[k + 7] - sp[k + 1], sp[k + 8] - sp[k + 2]);
    let area = fn.crossVectors(e1, e2).length() / 2;
    if (area < 1e-10) continue;
    fn.normalize();
    q.set((sp[k] + sp[k + 3] + sp[k + 6]) / 3, (sp[k + 1] + sp[k + 4] + sp[k + 7]) / 3, (sp[k + 2] + sp[k + 5] + sp[k + 8]) / 3);
    let best = Infinity, to = -1;
    for (let j = 0; j < 3; j++) {
      for (const g of vf[alive(remap[f * 3 + j])]) {
        if (!faceAlive[g]) continue;
        tri.set(corner(F[g * 3], tri.a), corner(F[g * 3 + 1], tri.b), corner(F[g * 3 + 2], tri.c));
        const d = tri.closestPointToPoint(q, hit).distanceToSquared(q);
        if (d < best) {
          best = d;
          to = g;
        }
      }
    }
    if (to < 0) continue;
    // faces turned away from the far face are mostly inside the clump and
    // hidden, they barely count
    faceNormal(F[to * 3], F[to * 3 + 1], F[to * 3 + 2], e1).normalize();
    area *= Math.max(0.05, e1.dot(fn));
    const o = to * 5;
    acc[o] += area;
    for (let j = 0; j < 3; j++) acc[o + 1 + j] += area * (sc[k + j] + sc[k + 3 + j] + sc[k + 6 + j]) / 3;
    acc[o + 4] += area * (sg[f * 3] + sg[f * 3 + 1] + sg[f * 3 + 2]) / 3;
  }
  const P2 = [], N2 = [], C2 = [], G2 = [], S2 = [];
  for (let f = 0; f < nf; f++) {
    if (!faceAlive[f]) continue;
    const o = f * 5, a = acc[o];
    for (let j = 0; j < 3; j++) {
      const v = F[f * 3 + j];
      P2.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      S2.push(sway[v]);
      // A far face nothing mapped to keeps its corners' welded values.
      // Normals stay welded and smooth either way, the lighting across them
      // brings back some of the shading a flat color loses.
      N2.push(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
      if (a > 0) {
        C2.push(acc[o + 1] / a, acc[o + 2] / a, acc[o + 3] / a);
        G2.push(acc[o + 4] / a);
      } else {
        C2.push(col[v * 3], col[v * 3 + 1], col[v * 3 + 2]);
        G2.push(glow[v]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P2, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N2, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C2, 3));
  g.setAttribute('aGlow', new THREE.Float32BufferAttribute(G2, 1));
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(S2, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
