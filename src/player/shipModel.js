import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { env, patchStandard } from '../render/materials.js';
import { LAYER_POST } from '../render/pipeline.js';
import { smoothstep, lerp } from '../core/math.js';

// Procedural explorer ship. Forward is -Z, up is +Y, about 10 m long.
// Everything static is merged into three meshes (painted hull with vertex
// colors, canopy glass, lamps). Landing gear, bay doors, boarding ladder and
// elevons are one skinned mesh, so the ship costs 4 draw calls plus 2 shadow
// casters and the flames.

const _t = new THREE.Vector3();
const _o = new THREE.Vector3();
const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

// deployed pad bottom sits at -2.05, matches GEAR_HEIGHT in ship.js
const PAD_Y = -2.05;
const SLEEVE = 0.75;
const PAD = 0.21;

// lamp channels, see the lamp material
const STEADY = 0;
const THRUST = 1;
const STROBE = 2;
const BEACON = 3;
const LANDING = 4;

function T(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(_e.set(rx, ry, rz, 'XYZ')), new THREE.Vector3(sx, sy, sz));
}

// Area weighted normals, only smoothed across edges flatter than the group's
// crease angle. Big panels stay flat and bevels shade round, the usual face
// weighted normals trick for chunky hard surface models.
function creaseNormals(pos, groups, creases) {
  const nf = pos.length / 9;
  const fn = new Float64Array(nf * 3);
  const fu = new Float64Array(nf * 3);
  for (let f = 0; f < nf; f++) {
    const i = f * 9;
    const ux = pos[i + 6] - pos[i + 3], uy = pos[i + 7] - pos[i + 4], uz = pos[i + 8] - pos[i + 5];
    const vx = pos[i] - pos[i + 3], vy = pos[i + 1] - pos[i + 4], vz = pos[i + 2] - pos[i + 5];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    const l = Math.hypot(x, y, z) || 1;
    fn[f * 3] = x;
    fn[f * 3 + 1] = y;
    fn[f * 3 + 2] = z;
    fu[f * 3] = x / l;
    fu[f * 3 + 1] = y / l;
    fu[f * 3 + 2] = z / l;
  }
  const map = new Map();
  const q = (v) => Math.round(v * 2000);
  for (let v = 0; v < nf * 3; v++) {
    const k = `${groups[(v / 3) | 0]}|${q(pos[v * 3])}|${q(pos[v * 3 + 1])}|${q(pos[v * 3 + 2])}`;
    let l = map.get(k);
    if (!l) map.set(k, (l = []));
    l.push(v);
  }
  const out = new Float32Array(pos.length);
  for (const list of map.values()) {
    for (const v of list) {
      const f = (v / 3) | 0;
      const cos = Math.cos(creases[groups[f]]);
      let x = 0, y = 0, z = 0;
      for (const w of list) {
        const h = (w / 3) | 0;
        if (fu[f * 3] * fu[h * 3] + fu[f * 3 + 1] * fu[h * 3 + 1] + fu[f * 3 + 2] * fu[h * 3 + 2] < cos) continue;
        x += fn[h * 3];
        y += fn[h * 3 + 1];
        z += fn[h * 3 + 2];
      }
      const l = Math.hypot(x, y, z) || 1;
      out[v * 3] = x / l;
      out[v * 3 + 1] = y / l;
      out[v * 3 + 2] = z / l;
    }
  }
  return out;
}

// Loose triangles with a color and one extra float per vertex, the metal
// amount for paint or the light channel for lamps. Optional bone index.
class Mesher {
  constructor() {
    this.pos = [];
    this.col = [];
    this.aux = [];
    this.spinA = [];
    this.bones = [];
    this.groups = [];
    this.creases = [0.5];
    this.bone = 0;
    this.spin = 0;
  }

  // new smoothing group, normals are never shared across groups
  part(crease = 0.5) {
    this.creases.push(crease);
    return this;
  }

  // paint is a Color, or fn(center, normal) returning a Color or [Color, aux].
  // With `inside` the triangle is flipped to face away from that point, or
  // toward it with sign -1. cb and cc are optional colors for b and c.
  tri(a, b, c, paint, aux = 0, inside = null, sign = 1, cb = null, cc = null) {
    _t.subVectors(c, b).cross(_o.subVectors(a, b));
    const area = _t.length();
    if (area < 1e-10) return;
    if (inside) {
      _o.copy(a).add(b).add(c).divideScalar(3).sub(inside);
      if (_t.dot(_o) * sign < 0) {
        [b, c] = [c, b];
        [cb, cc] = [cc, cb];
        _t.negate();
      }
    }
    let col = paint;
    let x = aux;
    if (typeof paint === 'function') {
      _o.copy(a).add(b).add(c).divideScalar(3);
      _n.copy(_t).divideScalar(area);
      const r = paint(_o, _n);
      if (Array.isArray(r)) [col, x] = r;
      else col = r;
    }
    const g = this.creases.length - 1;
    this.groups.push(g);
    const vs = [a, b, c];
    const cs = [col, cb || col, cc || col];
    for (let k = 0; k < 3; k++) {
      this.pos.push(vs[k].x, vs[k].y, vs[k].z);
      this.col.push(cs[k].r, cs[k].g, cs[k].b);
      this.aux.push(x);
      this.spinA.push(this.spin);
      this.bones.push(this.bone);
    }
  }

  add(geo, matrix, paint, aux = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position;
    const flip = matrix && matrix.determinant() < 0;
    for (let i = 0; i < p.count; i += 3) {
      _a.fromBufferAttribute(p, i);
      _b.fromBufferAttribute(p, i + 1);
      _c.fromBufferAttribute(p, i + 2);
      if (matrix) {
        _a.applyMatrix4(matrix);
        _b.applyMatrix4(matrix);
        _c.applyMatrix4(matrix);
      }
      if (flip) this.tri(_a, _c, _b, paint, aux);
      else this.tri(_a, _b, _c, paint, aux);
    }
    geo.dispose();
    if (g !== geo) g.dispose();
    return this;
  }

  build(skinned = false) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(this.pos);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(creaseNormals(pos, this.groups, this.creases), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aAux', new THREE.BufferAttribute(new Float32Array(this.aux), 1));
    g.setAttribute('aSpin', new THREE.BufferAttribute(new Float32Array(this.spinA), 1));
    if (skinned) {
      const n = this.bones.length;
      const idx = new Uint16Array(n * 4);
      const w = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        idx[i * 4] = this.bones[i];
        w[i * 4] = 1;
      }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
    }
    g.computeBoundingSphere();
    return g;
  }
}

function centroid(ring) {
  const c = new THREE.Vector3();
  for (const v of ring) c.add(v);
  return c.divideScalar(ring.length);
}

// Joins rings of equal length into a tube. paint(i, j, center, normal) gets the
// band index along the tube and the segment index around it, caps get j = -1.
function loft(m, rings, paint, { closed = true, capStart = false, capEnd = false, sign = 1 } = {}) {
  const cen = rings.map(centroid);
  for (let i = 0; i < rings.length - 1; i++) {
    const A = rings[i];
    const B = rings[i + 1];
    const mid = cen[i].clone().add(cen[i + 1]).multiplyScalar(0.5);
    const n = closed ? A.length : A.length - 1;
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % A.length;
      const p = (c, nn) => paint(i, j, c, nn);
      m.tri(A[j], A[j2], B[j2], p, 0, mid, sign);
      m.tri(A[j], B[j2], B[j], p, 0, mid, sign);
    }
  }
  const cap = (k, other) => {
    const r = rings[k];
    const p = (c, nn) => paint(k, -1, c, nn);
    for (let j = 0; j < r.length; j++) m.tri(cen[k], r[j], r[(j + 1) % r.length], p, 0, cen[other], sign);
  };
  if (capStart) cap(0, 1);
  if (capEnd) cap(rings.length - 1, rings.length - 2);
}

// [r, z] profile revolved around the local Z axis
function latheRings(profile, segs, phase = 0) {
  return profile.map(([r, z]) => {
    const ring = [];
    for (let k = 0; k < segs; k++) {
      const a = phase + (k / segs) * Math.PI * 2;
      ring.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, z));
    }
    return ring;
  });
}

function xfRings(rings, matrix) {
  for (const r of rings) for (const v of r) v.applyMatrix4(matrix);
  return rings;
}

function bevelPlate(m, outline, bottom, top, bevel, matrix, face, edge = face) {
  const cx = outline.reduce((sum, p) => sum + p[0], 0) / outline.length;
  const cz = outline.reduce((sum, p) => sum + p[1], 0) / outline.length;
  const ring = (y, inset) => outline.map(([x, z]) => {
    const d = Math.hypot(x - cx, z - cz);
    const k = 1 - inset / Math.max(d, inset * 2);
    return new THREE.Vector3(cx + (x - cx) * k, y, cz + (z - cz) * k);
  });
  const b = Math.min(bevel, (top - bottom) * 0.35);
  const rings = [ring(bottom, bevel), ring(bottom + b, 0), ring(top - b, 0), ring(top, bevel)];
  loft(m, xfRings(rings, matrix), (i, j) => j < 0 ? face : edge, { capStart: true, capEnd: true });
}

// Hull cross section: flat bottom, chamfered lower edge, straight side,
// two faced shoulder and a flat top with points for the racing stripes.
// 16 points, segment 0 and 15 are the bottom, 6 and 9 the stripes.
function hullRing(z, { w, yb = -0.42, ys, yt, wt }) {
  const cb = 0.1;
  const s2 = Math.min(0.34, wt * 0.62);
  const s1 = Math.min(0.13, wt * 0.24);
  const half = [[w - cb, yb], [w, yb + cb], [w, ys], [w - 0.3 * (w - wt), ys + 0.62 * (yt - ys)], [wt, yt], [s2, yt], [s1, yt]];
  const pts = [[0, yb], ...half, [0, yt], ...half.slice().reverse().map(([x, y]) => [-x, y])];
  return pts.map(([x, y]) => new THREE.Vector3(x, y, z));
}

function interpKeys(keys, z) {
  if (z <= keys[0].z) return { ...keys[0] };
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (z <= b.z) {
      const t = (z - a.z) / (b.z - a.z);
      const out = { z };
      for (const k of ['w', 'yb', 'ys', 'yt', 'wt']) out[k] = lerp(a[k] ?? -0.42, b[k] ?? -0.42, t);
      return out;
    }
  }
  return { ...keys[keys.length - 1] };
}

// Lofted hull with panel line grooves cut in at the given z positions
function hullLoft(m, keys, grooves, paint) {
  const stations = keys.map((k) => ({ z: k.z, k, inset: 0 }));
  for (const g of grooves) {
    for (const [dz, inset] of [[-0.03, 0], [-0.012, 0.018], [0.012, 0.018], [0.03, 0]]) stations.push({ z: g + dz, k: interpKeys(keys, g + dz), inset });
  }
  stations.sort((a, b) => a.z - b.z);
  const rings = stations.map(({ z, k, inset }) => hullRing(z, { w: k.w - inset, yb: k.yb ?? -0.42, ys: k.ys, yt: k.yt - inset, wt: k.wt - inset }));
  const groove = stations.map((s, i) => i < stations.length - 1 && (s.inset > 0 || stations[i + 1].inset > 0));
  loft(m, rings, (i, j, c, n) => paint(groove[i], j, c, n), { capStart: true, capEnd: true });
}

// Wing style section at span position s (along x), chord from le to te on z.
// Segments: 0 and 9 leading edge, 1-3 top (3 is the flap), 4-6 trailing
// edge, 7-8 bottom.
function foilRing(s, le, te, t, y) {
  const c = te - le;
  const pts = [
    [le, y], [le + c * 0.05, y + t * 0.4], [le + c * 0.18, y + t * 0.5], [te - c * 0.3, y + t * 0.5], [te - c * 0.1, y + t * 0.4],
    [te, y + t * 0.12], [te, y - t * 0.12], [te - c * 0.1, y - t * 0.4], [le + c * 0.18, y - t * 0.5], [le + c * 0.05, y - t * 0.4],
  ];
  return pts.map(([z, yy]) => new THREE.Vector3(s, yy, z));
}

// semi superellipse arch over a sill at y0, right to left
function archRing(z, aw, ah, y0, n = 8, p = 2.6) {
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * Math.PI;
    const c = Math.cos(a);
    const s = Math.max(0, Math.sin(a));
    pts.push(new THREE.Vector3(aw * Math.sign(c) * Math.pow(Math.abs(c), 2 / p), y0 + ah * Math.pow(s, 2 / p), z));
  }
  return pts;
}

function bar(m, a, b, r, paint, aux = 0, sides = 6) {
  const d = _t.subVectors(b, a);
  const len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len + r * 0.6, sides, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.normalize());
  const mid = a.clone().add(b).multiplyScalar(0.5);
  m.add(g, new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)), paint, aux);
}

// flat round lamp lens with a hot center, facing +z in local space
function lensDisc(m, matrix, r, segs, center, rim, channel) {
  const c = new THREE.Vector3().applyMatrix4(matrix);
  for (let k = 0; k < segs; k++) {
    const a0 = (k / segs) * Math.PI * 2;
    const a1 = ((k + 1) / segs) * Math.PI * 2;
    const p0 = new THREE.Vector3(Math.cos(a0) * r, Math.sin(a0) * r, 0).applyMatrix4(matrix);
    const p1 = new THREE.Vector3(Math.cos(a1) * r, Math.sin(a1) * r, 0).applyMatrix4(matrix);
    m.tri(c, p0, p1, center, channel, null, 1, rim, rim);
  }
}

// small dome lamp, bulging toward local +z
function lampDome(m, matrix, r, color, channel) {
  const rings = xfRings(latheRings([[r, 0], [r * 0.92, r * 0.45], [r * 0.6, r * 0.85], [0, r]], 8), matrix);
  loft(m, rings, () => [color, channel]);
}

const flameVert = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aCore;
uniform float uPower;
uniform float uAtmo;
uniform float uLen;
varying float vT;
varying float vD;
varying float vCore;
varying vec3 vN;
varying vec3 vV;
varying vec3 vAxis;
void main() {
  vec3 p = position;
  vAxis = normalize((modelViewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
  // cones run from z=0 (nozzle) back to z=1, the inner core is shorter
  vT = clamp(p.z / mix(1.0, 0.42, aCore), 0.0, 1.0);
  vD = p.z * uLen;
  vCore = aCore;
  // in air the plume necks down at each shock cell, in vacuum it spreads out wide
  float cell = 0.5 + 0.5 * cos(vD * 5.5);
  p.xy *= 1.0 - 0.3 * uAtmo * smoothstep(0.35, 1.0, uPower) * cell * exp(-vD * 0.5);
  p.xy *= 1.0 + (1.0 - uAtmo) * 0.8 * p.z;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const flameFrag = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uPower;
uniform float uTime;
uniform float uAtmo;
varying float vT;
varying float vD;
varying float vCore;
varying vec3 vN;
varying vec3 vV;
varying vec3 vAxis;
void main() {
  #include <logdepthbuf_fragment>
  // The cone is a thin shell, so fake the volume from how head-on we see it.
  // Looking down the axis (the chase camera) the whole plume is thick.
  vec3 v = normalize(vV);
  float facing = abs(dot(normalize(vN), v));
  float along = abs(dot(vAxis, v));
  float body = mix(smoothstep(0.05, 0.9, facing), 1.0, along * along * along);
  float flick = 0.86 + 0.14 * sin(uTime * 41.0 + vT * 23.0) * sin(uTime * 13.0 - vT * 7.0);
  // the white hot core keeps a short fixed length in meters, the plume stretches
  float t = vCore > 0.5 ? clamp(vD / (0.4 + uPower * 0.8), 0.0, 1.0) : vT;
  float fall = pow(1.0 - t, mix(2.0, 2.6, vCore)) * smoothstep(0.0, 0.04, t);
  vec3 c = mix(uColor, vec3(1.0), pow(1.0 - t, 3.0) * mix(0.25, 0.95, vCore));
  // vacuum plumes spread out thin and pale
  c *= body * fall * flick * uPower * mix(1.4, 3.0, vCore) * mix(0.55, 1.0, uAtmo);
  // soft mach disks where the plume necks down, only in the first few meters
  float disk = pow(0.5 + 0.5 * cos(vD * 5.5), 8.0) * exp(-vD * 0.6) * uAtmo * smoothstep(0.35, 1.2, uPower);
  c += mix(uColor, vec3(1.0), 0.7) * disk * body * body * uPower * 1.3 * (1.0 - vCore);
  gl_FragColor = vec4(c, 1.0);
}
`;

export function buildShip(colors = {}) {
  const primary = new THREE.Color(colors.primary || '#d8dde6');
  const secondary = new THREE.Color(colors.secondary || '#2b3140');
  const accent = new THREE.Color(colors.accent || '#ff8a3c');
  const glow = new THREE.Color(colors.glow || '#6fd6ff');

  const C = {
    hull: primary.clone(),
    seam: primary.clone().multiplyScalar(0.5),
    flap: primary.clone().multiplyScalar(0.84),
    trim: secondary.clone().lerp(primary, 0.1),
    dark: secondary.clone().multiplyScalar(0.4),
    metal: new THREE.Color(0.3, 0.32, 0.36),
    chrome: new THREE.Color(0.72, 0.74, 0.78),
    accent: accent.clone(),
    soft: accent.clone().lerp(primary, 0.45),
    top: accent.clone().lerp(primary, 0.28),
    white: new THREE.Color(0.92, 0.92, 0.9),
  };
  const hot = glow.clone().lerp(new THREE.Color(1, 1, 1), 0.6);
  const lampRed = new THREE.Color(1, 0.08, 0.04);
  const lampGreen = new THREE.Color(0.08, 1, 0.25);
  const lampWhite = new THREE.Color(1, 1, 1);
  const warm = new THREE.Color(1, 0.85, 0.6);

  const H = new Mesher();
  const G = new Mesher();
  const L = new Mesher();
  const R = new Mesher();

  // keel: chunky dark belly slab with the gear bays cut through it
  const keelSide = [[0.3, -5.05], [0.7, -4.85], [0.93, -4.4], [1.05, -3.3], [1.15, -1.2], [1.22, 0.4], [1.22, 2.9], [1.08, 3.6], [0.8, 3.92]];
  const outline = [...keelSide, ...keelSide.slice().reverse().map(([x, z]) => [-x, z])];
  const bays = [[-0.4, -3.78, 0.4, -1.95], [0.3, 0.62, 1.08, 2.62], [-1.08, 0.62, -0.3, 2.62]];
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, z)));
  for (const [x0, z0, x1, z1] of bays) shape.holes.push(new THREE.Path([new THREE.Vector2(x0, z0), new THREE.Vector2(x1, z0), new THREE.Vector2(x1, z1), new THREE.Vector2(x0, z1)]));
  const keel = new THREE.ExtrudeGeometry(shape, { depth: 0.38, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 2, curveSegments: 1 });
  keel.rotateX(Math.PI / 2);
  keel.translate(0, -0.43, 0);
  // sweep the belly up at the chin and the tail, like a boat's rocker, so the
  // side profile isn't one long slab. The bays stay in the flat middle.
  const kp = keel.attributes.position;
  for (let i = 0; i < kp.count; i++) {
    const y = kp.getY(i);
    const z = kp.getZ(i);
    const lift = 0.3 * smoothstep(-3.95, -5.2, z) + 0.26 * smoothstep(2.75, 4.0, z);
    kp.setY(i, y + lift * ((-0.36 - y) / 0.52));
  }
  const inBay = (c) => bays.some(([x0, z0, x1, z1]) => c.x > x0 - 0.03 && c.x < x1 + 0.03 && c.z > z0 - 0.03 && c.z < z1 + 0.03);
  H.part(0.7).add(keel, null, (c, n) => {
    if (inBay(c) && n.y < 0.95) return C.dark;
    // top bevel doubles as a pinstripe where the hull sits on the keel
    if (n.y > 0.25 && n.y < 0.97) return C.accent;
    return C.trim;
  });

  // upper hull, nose section under the canopy and the raised deck behind it
  const noseKeys = [
    { z: -5.32, w: 0.42, ys: -0.3, yt: -0.18, wt: 0.24 },
    { z: -5.12, w: 0.7, ys: -0.18, yt: 0.02, wt: 0.42 },
    { z: -4.75, w: 0.9, ys: -0.05, yt: 0.2, wt: 0.64 },
    { z: -4.3, w: 1.0, ys: 0.05, yt: 0.33, wt: 0.84 },
    { z: -3.2, w: 1.06, ys: 0.1, yt: 0.4, wt: 0.94 },
    { z: -1.3, w: 1.08, ys: 0.12, yt: 0.42, wt: 0.97 },
  ];
  const deckKeys = [
    { z: -1.45, w: 1.12, ys: 0.3, yt: 1.06, wt: 0.5 },
    { z: -0.7, w: 1.17, ys: 0.32, yt: 1.02, wt: 0.56 },
    { z: 0.5, w: 1.21, ys: 0.34, yt: 0.96, wt: 0.62 },
    { z: 2.4, w: 1.21, ys: 0.32, yt: 0.9, wt: 0.64 },
    { z: 3.35, w: 1.1, ys: 0.26, yt: 0.8, wt: 0.56 },
    { z: 3.9, w: 0.9, ys: 0.18, yt: 0.64, wt: 0.44 },
    { z: 4.12, w: 0.66, ys: 0.1, yt: 0.46, wt: 0.3 },
  ];
  // two-tone: colored top and shoulders, white sides, white racing stripes
  const hullPaint = (groove, j, c) => {
    if (j < 0) return c.z > 0 ? C.hull : C.trim;
    if (groove) return C.seam;
    if (j === 0 || j === 15) return C.dark;
    if (j === 1 || j === 14) return C.trim;
    // cabin floor under the canopy
    if (c.z > -4.22 && c.z < -1.3 && j >= 5 && j <= 10) return C.trim;
    if (j === 2 || j === 13) return C.hull;
    if (j === 6 || j === 9) return C.hull;
    return C.top;
  };
  H.part(0.45);
  hullLoft(H, noseKeys, [-4.55], hullPaint);
  H.part(0.45);
  hullLoft(H, deckKeys, [-0.05, 1.75], hullPaint);
  const deckAt = (z) => interpKeys(deckKeys, z);
  const noseAt = (z) => interpKeys(noseKeys, z);

  // canopy bubble, faceted like cut glass. It peaks well above the deck and
  // tucks down into the deck's front bulkhead at the back.
  const canopy = [[-4.22, 0.5, 0.12], [-3.9, 0.74, 0.55], [-3.35, 0.88, 0.86], [-2.6, 0.93, 1.0], [-1.9, 0.9, 0.94], [-1.3, 0.8, 0.52]];
  const sill = (z) => noseAt(z).yt - 0.005;
  const canopyAt = (z) => {
    for (let i = 0; i < canopy.length - 1; i++) {
      const [z0, a0, h0] = canopy[i];
      const [z1, a1, h1] = canopy[i + 1];
      if (z <= z1) {
        const t = (z - z0) / (z1 - z0);
        return [lerp(a0, a1, t), lerp(h0, h1, t)];
      }
    }
    return canopy[canopy.length - 1].slice(1);
  };
  G.part(0.3);
  loft(G, canopy.map(([z, aw, ah]) => archRing(z, aw, ah, sill(z))), () => C.white, { closed: false, capStart: true });

  // canopy frame
  H.part(0.6);
  for (const s of [-1, 1]) {
    for (let i = 0; i < canopy.length - 1; i++) {
      const [z0, a0] = canopy[i];
      const [z1, a1] = canopy[i + 1];
      bar(H, new THREE.Vector3(s * a0, sill(z0) + 0.02, z0), new THREE.Vector3(s * a1, sill(z1) + 0.02, z1), 0.055, C.trim);
    }
  }
  const hoop = (z, r) => {
    const [aw, ah] = canopyAt(z);
    const pts = archRing(z, aw * 1.015, ah * 1.015 + 0.01, sill(z));
    for (let k = 0; k < pts.length - 1; k++) bar(H, pts[k], pts[k + 1], r, C.trim);
  };
  hoop(-4.22, 0.05);
  hoop(-3.05, 0.045);
  hoop(-1.34, 0.055);
  for (let i = 0; i < canopy.length - 1; i++) {
    const [z0, , h0] = canopy[i];
    const [z1, , h1] = canopy[i + 1];
    bar(H, new THREE.Vector3(0, sill(z0) + h0 + 0.012, z0), new THREE.Vector3(0, sill(z1) + h1 + 0.012, z1), 0.023, C.hull, 0, 6);
  }

  // cockpit: seat, console with screens, stick and a dashboard bobblehead
  H.part(0.7);
  H.add(new RoundedBoxGeometry(0.5, 0.1, 0.46, 2, 0.03), T(0, 0.58, -2.45), C.soft);
  H.add(new THREE.BoxGeometry(0.28, 0.14, 0.3), T(0, 0.48, -2.45), C.trim);
  H.add(new RoundedBoxGeometry(0.5, 0.5, 0.12, 2, 0.04), T(0, 0.86, -2.18, 0.18), C.soft);
  H.add(new RoundedBoxGeometry(0.3, 0.16, 0.1, 2, 0.03), T(0, 1.09, -2.13, 0.18), C.trim);
  for (const s of [-1, 1]) {
    H.add(new RoundedBoxGeometry(0.08, 0.075, 0.38, 1, 0.02), T(s * 0.29, 0.73, -2.43), C.trim);
    H.add(new THREE.BoxGeometry(0.055, 0.34, 0.015), T(s * 0.135, 0.87, -2.263, 0.18), C.trim);
    H.add(new THREE.BoxGeometry(0.075, 0.045, 0.025), T(s * 0.135, 0.75, -2.281, 0.18), C.chrome, 1);
  }
  const consoleM = T(0, 0.6, -3.45, -0.4);
  H.add(new RoundedBoxGeometry(0.92, 0.3, 0.34, 2, 0.04), consoleM, C.trim);
  H.add(new THREE.CylinderGeometry(0.025, 0.03, 0.3, 6), T(0, 0.56, -2.85, -0.2), C.metal, 1);
  H.add(new THREE.IcosahedronGeometry(0.045, 1), T(0, 0.71, -2.88), C.accent);
  const bob = new THREE.Vector3(-0.34, 0.15, 0.05).applyMatrix4(consoleM);
  H.add(new THREE.IcosahedronGeometry(0.04, 1), T(bob.x, bob.y + 0.03, bob.z), C.white);
  H.add(new THREE.IcosahedronGeometry(0.055, 1), T(bob.x, bob.y + 0.11, bob.z), C.white);
  lensDisc(L, T(bob.x, bob.y + 0.11, bob.z + 0.05), 0.032, 6, glow.clone().multiplyScalar(1.5), glow.clone().multiplyScalar(0.8), STEADY);
  // screens face the seat, lens discs face local +z so turn them up and back
  const screen = (x, y, w, h, color) => {
    const m = consoleM.clone().multiply(T(x, 0.152, y, -Math.PI / 2));
    const p = [[-w, -h], [w, -h], [w, h], [-w, h]].map(([a, b]) => new THREE.Vector3(a, b, 0).applyMatrix4(m));
    L.tri(p[0], p[1], p[2], color, STEADY);
    L.tri(p[0], p[2], p[3], color, STEADY);
  };
  screen(0, 0.02, 0.15, 0.09, glow.clone().multiplyScalar(1.6));
  screen(-0.27, 0.03, 0.08, 0.07, glow.clone().multiplyScalar(0.9));
  screen(0.27, 0.03, 0.08, 0.07, accent.clone().multiplyScalar(1.2));
  for (let k = 0; k < 4; k++) screen(-0.12 + k * 0.08, -0.12, 0.018, 0.018, [lampRed, lampGreen, accent, lampGreen][k].clone().multiplyScalar(1.5));

  // nose: headlight eyes on the dark nose face, mining lasers in the chin
  for (const s of [-1, 1]) {
    H.add(new THREE.CylinderGeometry(0.095, 0.095, 0.04, 10), T(s * 0.2, -0.3, -5.33, Math.PI / 2), C.chrome, 1);
    lensDisc(L, T(s * 0.2, -0.3, -5.352, 0, Math.PI), 0.075, 10, warm.clone().multiplyScalar(3), warm.clone().multiplyScalar(1.2), LANDING);
    H.add(new THREE.CylinderGeometry(0.07, 0.075, 0.42, 8), T(s * 0.42, -0.5, -5.14, Math.PI / 2), C.metal, 1);
    H.add(new THREE.CylinderGeometry(0.09, 0.09, 0.07, 8), T(s * 0.42, -0.5, -5.32, Math.PI / 2), C.accent);
    lensDisc(L, T(s * 0.42, -0.5, -5.358, 0, Math.PI), 0.05, 8, new THREE.Color(1, 0.4, 0.2).multiplyScalar(1.6), new THREE.Color(1, 0.3, 0.1).multiplyScalar(0.5), STEADY);
  }

  // cheek vents under the canopy
  for (const s of [-1, 1]) {
    const x = s * noseAt(-3.2).w;
    H.add(new RoundedBoxGeometry(0.08, 0.3, 0.76, 1, 0.035), T(x, -0.1, -3.2), C.trim);
    H.add(new THREE.BoxGeometry(0.085, 0.2, 0.62), T(x, -0.1, -3.2), C.dark);
    for (let k = 0; k < 3; k++) H.add(new THREE.BoxGeometry(0.06, 0.032, 0.59), T(x + s * 0.032, -0.18 + k * 0.08, -3.2, 0, 0, s * 0.2), C.hull);
  }

  // RCS thruster blocks at the four corners
  H.part(0.7);
  for (const s of [-1, 1]) {
    for (const [x, y, z] of [[1.0, -0.12, -4.3], [1.13, 0.12, 3.3]]) {
      H.add(new RoundedBoxGeometry(0.16, 0.16, 0.26, 2, 0.035), T(s * x, y, z), C.trim);
      for (const dz of [-0.06, 0.06]) H.add(new THREE.CylinderGeometry(0.03, 0.035, 0.03, 6), T(s * (x + 0.08), y, z + dz, 0, 0, Math.PI / 2), C.dark);
    }
  }

  // engine pods
  const nozzles = [];
  const podX = 2.05;
  const podY = 0.02;
  const podProfile = [
    [0.44, 0.02], [0.6, -0.04], [0.69, 0.1], [0.765, 0.45], [0.785, 0.9], [0.785, 1.25], [0.75, 2.26], [0.728, 2.29], [0.728, 2.33], [0.75, 2.36],
    [0.735, 3.05], [0.68, 3.55], [0.62, 3.8], [0.61, 3.95], [0.58, 4.36], [0.5, 4.38],
  ];
  const podPaint = (i, j) => {
    // hazard striped intake lip
    if (i === 1) return j % 2 ? C.dark : C.accent;
    if (i === 0 || i === 4) return C.accent;
    if (i >= 6 && i <= 8) return C.seam;
    if (i === 11) return C.trim;
    if (i === 13) return [j % 2 ? C.metal : C.chrome, 1];
    if (i >= 12) return [C.metal, 1];
    if (j >= 6 && j <= 10) return C.trim;
    if (j === 2) return C.top;
    return C.hull;
  };
  for (const s of [-1, 1]) {
    const px = s * podX;
    const pm = T(px, podY, 0);
    H.part(0.62);
    loft(H, xfRings(latheRings(podProfile, 12, Math.PI / 12), pm), podPaint);
    // intake throat, fan face and spinner
    H.part(0.62);
    loft(H, xfRings(latheRings([[0.44, 0.02], [0.42, 0.6]], 12, Math.PI / 12), pm), () => C.dark, { sign: -1 });
    const wall = xfRings(latheRings([[0.42, 0.6]], 12, Math.PI / 12), pm)[0];
    const wc = new THREE.Vector3(px, podY, 0.6);
    const behind = new THREE.Vector3(px, podY, 1);
    for (let k = 0; k < 12; k++) H.tri(wc, wall[k], wall[(k + 1) % 12], C.dark, 0, behind);
    loft(H, xfRings(latheRings([[0, 0.2], [0.1, 0.28], [0.15, 0.42], [0.15, 0.6]], 10), pm), (i) => (i === 0 ? C.accent : C.chrome));
    H.part(0.3);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      H.add(new THREE.BoxGeometry(0.26, 0.022, 0.12), pm.clone().multiply(T(0, 0, 0.5, 0, 0, a)).multiply(T(0.28, 0, 0, 0.55)), C.metal, 1);
    }
    // A raised cowl leaves the cooling slots below its lip.
    H.part(0.6);
    const cowl = [[-0.29, 1.3], [-0.36, 1.55], [-0.28, 3.22], [-0.17, 3.4], [0.17, 3.4], [0.28, 3.22], [0.36, 1.55], [0.29, 1.3]];
    bevelPlate(H, cowl, podY + 0.64, podY + 0.82, 0.05, T(px), C.hull, C.flap);
    H.add(new RoundedBoxGeometry(0.36, 0.05, 1.15, 1, 0.025), T(px, podY + 0.832, 2.36), C.dark);
    for (let k = 0; k < 7; k++) H.add(new THREE.BoxGeometry(0.32, 0.04, 0.045), T(px, podY + 0.855, 1.91 + k * 0.15, -0.28), C.metal, 1);
    H.add(new RoundedBoxGeometry(0.22, 0.04, 0.3, 1, 0.025), T(px, podY + 0.838, 1.54), C.accent);
    // Longitudinal ribs on the nozzle collar catch the light from behind.
    for (let k = 0; k < 12; k++) {
      const a = (k + 0.5) * Math.PI / 6;
      const start = new THREE.Vector3(px + Math.cos(a) * 0.611, podY + Math.sin(a) * 0.611, 3.96);
      const end = new THREE.Vector3(px + Math.cos(a) * 0.582, podY + Math.sin(a) * 0.582, 4.32);
      bar(H, start, end, 0.018, C.chrome, 1, 4);
    }
    // glowing nozzle: hot disc, then the inner bell fading toward the lip
    lensDisc(L, T(px, podY, 3.97), 0.44, 12, hot.clone().multiplyScalar(3.2), glow.clone().multiplyScalar(2.2), THRUST);
    const bell = xfRings(latheRings([[0.44, 3.97], [0.5, 4.37]], 12, Math.PI / 12), pm);
    const cA = glow.clone().multiplyScalar(1.8);
    const cB = glow.clone().multiplyScalar(0.1);
    const bc = new THREE.Vector3(px, podY, 4.2);
    for (let k = 0; k < 12; k++) {
      const k2 = (k + 1) % 12;
      L.tri(bell[0][k], bell[0][k2], bell[1][k2], cA, THRUST, bc, -1, cA, cB);
      L.tri(bell[0][k], bell[1][k2], bell[1][k], cA, THRUST, bc, -1, cB, cB);
    }
    const sx = px + s * 0.768;
    H.add(new RoundedBoxGeometry(0.065, 0.25, 1.18, 1, 0.03), T(sx, podY + 0.01, 1.8), C.trim);
    for (let k = 0; k < 3; k++) {
      const z0 = 1.36 + k * 0.31;
      const strip = [[z0, -0.014], [z0 + 0.25, -0.014], [z0 + 0.25, 0.034], [z0, 0.034]].map(([z, y]) => new THREE.Vector3(sx + s * 0.035, podY + y, z));
      L.tri(strip[0], strip[1], strip[2], glow.clone().multiplyScalar(1.25), STEADY, new THREE.Vector3(px, podY, 2.2));
      L.tri(strip[0], strip[2], strip[3], glow.clone().multiplyScalar(1.25), STEADY, new THREE.Vector3(px, podY, 2.2));
    }
    nozzles.push(new THREE.Vector3(px, podY, 3.98));
  }

  // Low cranked wings: flat under the pods, where they stay clear of the
  // intakes, then angled up outboard. Two accent bands near the tip. The
  // outer trailing edge is cut back to FLAP_Z for the elevons, which live in
  // the skinned gear mesh further down.
  const FLAP_Z = 2.5;
  const FLAP = [2.93, 4.02];
  // inner, cut back middle and tip, each capped so the notch walls face out
  const wingParts = [[[1.15, 1.7, 2.6, 2.8, 2.9]], [[2.9, 3.28, 3.46, 3.58, 3.7, 4.05], 1], [[4.05, 4.22]]];
  const wle = (s) => 0.1 + (s - 1.15) * 0.44;
  const wte = (s) => 2.95 + (s - 1) * 0.03;
  const wt = (s) => 0.26 - (s - 1) * 0.02;
  const wy = (s) => -0.6 + Math.max(0, s - 2.8) * 0.2;
  const inBand = (x) => (x > 3.28 && x < 3.46) || (x > 3.58 && x < 3.7);
  const wingPaint = (i, j, c) => {
    if (j < 0) return C.trim;
    if (j === 0 || j === 9 || (j >= 4 && j <= 8)) return C.trim;
    if (inBand(Math.abs(c.x))) return C.accent;
    return j === 3 ? C.flap : C.hull;
  };
  for (const s of [-1, 1]) {
    H.part(0.6);
    const fairing = [[1.06, -0.82, 3.55, 0.48, -0.25], [1.28, -0.6, 3.54, 0.43, -0.29], [1.63, -0.03, 3.48, 0.33, -0.4], [1.92, 0.54, 3.32, 0.26, -0.53]];
    const fairingRings = fairing.map(([x, le, te, t, y]) => foilRing(s * x, le, te, t, y));
    loft(H, fairingRings, (i, j) => j === 0 || j === 9 ? C.accent : j >= 4 ? C.trim : C.hull, { capStart: true, capEnd: true });
    H.part(0.45);
    for (const [stations, cut] of wingParts) {
      const rings = stations.map((w) => foilRing(w, wle(w), cut ? FLAP_Z : wte(w), wt(w), wy(w)));
      if (s < 0) for (const r of rings) for (const v of r) v.x = -v.x;
      loft(H, rings, wingPaint, { capStart: true, capEnd: true });
    }

    // wingtip pods with nav light up front and a strobe at the back
    const tx = s * 4.3;
    const ty = wy(4.3);
    const tm = T(tx, ty, 0);
    H.part(0.62);
    loft(H, xfRings(latheRings([[0.13, 0.55], [0.2, 0.75], [0.24, 1.1], [0.24, 2.55], [0.2, 2.95], [0.12, 3.15]], 8, Math.PI / 8), tm), (i) => (i === 3 ? C.trim : C.accent), { capStart: true, capEnd: true });
    H.part(0.5);
    const winglet = [0, 0.18, 0.6, 0.72].map((h) => foilRing(h, 1.24 + h * 1.05, 2.91 - h * 0.28, 0.11 - h * 0.08, 0));
    loft(H, xfRings(winglet, T(tx, ty + 0.07, 0, 0, 0, Math.PI / 2 - s * 0.3)), (i, j) => j < 0 || j === 0 || j >= 4 ? C.trim : i === 2 ? C.accent : C.hull, { capStart: true, capEnd: true });
    L.part(0.6);
    lampDome(L, T(tx, ty, 0.56, 0, Math.PI), 0.135, (s < 0 ? lampRed : lampGreen).clone().multiplyScalar(4), STEADY);
    lampDome(L, T(tx, ty, 3.14), 0.12, lampWhite, STROBE);
  }

  // twin tail fins, canted out, with a roundel on the outside
  const finS = [0, 0.3, 0.75, 0.97, 1.25];
  const fle = (s) => 1.95 + s * 0.8;
  const fte = (s) => 3.72 + s * 0.1;
  const ft = (s) => 0.16 - s * 0.035;
  for (const s of [-1, 1]) {
    const fm = T(s * 0.55, 0.6, 0, 0, 0, Math.PI / 2 - s * 0.35);
    H.part(0.45);
    loft(H, xfRings(finS.map((f) => foilRing(f, fle(f), fte(f), ft(f), 0)), fm), (i, j) => (i === 3 ? C.accent : j === 0 || j === 9 || j < 0 ? C.trim : C.hull), { capStart: true, capEnd: true });
    // local +y points inward on the right fin and outward on the left
    const out = s > 0 ? -1 : 1;
    const es = 0.6;
    const ec = (fle(es) + fte(es)) / 2;
    const ey = out * (ft(es) / 2);
    const disc = (r, segs, off, paint) => {
      const g = new THREE.CircleGeometry(r, segs);
      g.rotateX(out > 0 ? -Math.PI / 2 : Math.PI / 2);
      H.add(g, fm.clone().multiply(T(es, ey + out * off, ec)), paint);
    };
    H.part(0.1);
    disc(0.23, 12, 0.004, C.trim);
    disc(0.19, 12, 0.008, C.accent);
    const star = new THREE.Shape();
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + Math.PI / 2;
      const r = k % 2 ? 0.055 : 0.14;
      if (k === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const sg = new THREE.ShapeGeometry(star);
    sg.rotateX(out > 0 ? -Math.PI / 2 : Math.PI / 2);
    H.add(sg, fm.clone().multiply(T(es, ey + out * 0.012, ec, 0, s > 0 ? Math.PI / 2 : -Math.PI / 2)), C.white);
    // strobe on the tip
    const tip = new THREE.Vector3(1.25, 0, fte(1.25) - 0.06).applyMatrix4(fm);
    L.part(0.6);
    lampDome(L, T(tip.x, tip.y, tip.z), 0.06, lampWhite, STROBE);
    if (s < 0) {
      // whip antenna
      const base = new THREE.Vector3(1.25, 0, fte(1.25) - 0.35).applyMatrix4(fm);
      const end = base.clone().add(new THREE.Vector3(-0.08, 0.6, 0.25));
      H.part(0.6);
      bar(H, base, end, 0.012, C.metal, 1, 4);
      H.add(new THREE.IcosahedronGeometry(0.035, 0), T(end.x, end.y, end.z), C.accent);
    }
  }

  // radar dish on the spine, spun in the vertex shader around uSpinPivot
  const dishZ = 0.75;
  const dishY = deckAt(dishZ).yt;
  H.part(0.6);
  H.add(new THREE.CylinderGeometry(0.1, 0.13, 0.08, 10), T(0, dishY + 0.02, dishZ), C.trim);
  H.add(new THREE.CylinderGeometry(0.045, 0.05, 0.3, 8), T(0, dishY + 0.18, dishZ), C.metal, 1);
  H.spin = 1;
  H.add(new RoundedBoxGeometry(0.12, 0.1, 0.12, 1, 0.02), T(0, dishY + 0.36, dishZ), C.trim);
  const dm = T(0, dishY + 0.46, dishZ, -2.53);
  // back and rim face out, the bowl faces in toward the axis
  loft(H, xfRings(latheRings([[0.03, -0.06], [0.16, -0.02], [0.3, 0.07], [0.31, 0.1]], 10), dm), (i) => (i === 2 ? C.accent : C.hull));
  loft(H, xfRings(latheRings([[0.31, 0.1], [0.24, 0.06], [0.12, 0.02], [0.0, 0.01]], 10), dm), () => C.white, { sign: -1 });
  bar(H, new THREE.Vector3(0, 0, 0.01).applyMatrix4(dm), new THREE.Vector3(0, 0, 0.3).applyMatrix4(dm), 0.015, C.metal, 1, 4);
  const feed = new THREE.Vector3(0, 0, 0.31).applyMatrix4(dm);
  H.add(new THREE.IcosahedronGeometry(0.035, 0), T(feed.x, feed.y, feed.z), C.accent);
  H.spin = 0;

  // beacons top and bottom, tail light
  const beaconZ = 1.4;
  const beaconY = deckAt(beaconZ).yt;
  H.add(new THREE.CylinderGeometry(0.12, 0.13, 0.04, 10), T(0, beaconY + 0.01, beaconZ), C.trim);
  H.add(new THREE.CylinderGeometry(0.12, 0.13, 0.04, 10), T(0, -0.89, 0.2), C.trim);
  L.part(0.6);
  lampDome(L, T(0, beaconY + 0.02, beaconZ, -Math.PI / 2), 0.1, lampRed.clone().multiplyScalar(2), BEACON);
  lampDome(L, T(0, -0.9, 0.2, Math.PI / 2), 0.1, lampRed.clone().multiplyScalar(2), BEACON);
  lampDome(L, T(0, 0.26, 4.115), 0.065, lampWhite.clone().multiplyScalar(2), STEADY);
  // rear service hatch on the tail cap
  H.part(0.7);
  H.add(new RoundedBoxGeometry(0.72, 0.38, 0.06, 2, 0.03), T(0, -0.14, 4.12), C.trim);
  H.add(new RoundedBoxGeometry(0.22, 0.05, 0.06, 1, 0.015), T(0, -0.06, 4.15), C.accent);

  const matPaint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.0 });
  patchStandard(matPaint, {
    key: 'ship-paint',
    uniforms: { uSpinPivot: { value: new THREE.Vector3(0, 0, dishZ) } },
    vertexPars: /* glsl */ `
      attribute float aAux;
      attribute float aSpin;
      uniform vec3 uSpinPivot;
      varying float vMetal;
      vec3 spinY(vec3 p) {
        float a = uTime * 2.2;
        float c = cos(a), s = sin(a);
        return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
      }
    `,
    vertexBegin: /* glsl */ `
      vMetal = aAux;
      if (aSpin > 0.5) transformed = spinY(transformed - uSpinPivot) + uSpinPivot;
    `,
    fragmentPars: 'varying float vMetal;',
    extra(shader) {
      shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n if (aSpin > 0.5) objectNormal = spinY(objectNormal);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.3, vMetal);')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = mix(metalnessFactor, 0.6, vMetal);');
    },
  });

  const tint = new THREE.Color(0.03, 0.06, 0.1).lerp(glow, 0.12);
  const matGlass = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.28 });
  patchStandard(matGlass, {
    key: 'ship-glass',
    rim: 0.9,
    normal: /* glsl */ `
      diffuseColor.a = mix(opacity, 0.92, pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0));
    `,
    emissive: /* glsl */ `
      {
        // fake sky over ground reflection, gives the bubble a horizon line
        vec3 upG = normalize(vWorldPosP - uAmbCenter);
        vec3 nG = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
        vec3 rG = reflect(normalize(vWorldPosP - cameraPosition), nG);
        float dayG = smoothstep(-0.2, 0.3, dot(upG, normalize(uSunPos - uAmbCenter)));
        vec3 envG = mix(uEnvGround * 0.7, uEnvSky * 1.5, smoothstep(-0.06, 0.1, dot(rG, upG))) * dayG + uEnvNight * 0.6;
        float fG = 0.06 + 0.94 * pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 4.0);
        reflectedLight.indirectSpecular += envG * fG;
      }
    `,
    extra(shader) {
      // sun glints stay visible where the glass is otherwise see-through
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        'diffuseColor.a = clamp(diffuseColor.a + dot(reflectedLight.directSpecular, vec3(0.3, 0.59, 0.11)) * 0.6, 0.0, 1.0);\n#include <opaque_fragment>'
      );
    },
  });

  // lamps: vertex color times a per channel intensity
  const lampUniforms = { uTime: env.uTime, uThrust: { value: 0 }, uGear: { value: 1 } };
  const matLamp = new THREE.MeshBasicMaterial({ vertexColors: true });
  matLamp.customProgramCacheKey = () => 'ship-lamp';
  matLamp.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, lampUniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aAux;
        uniform float uTime;
        uniform float uThrust;
        uniform float uGear;
        varying float vLamp;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vLamp = 1.0;
        if (aAux > 0.5 && aAux < 1.5) vLamp = 0.15 + uThrust * 1.2;
        else if (aAux > 1.5 && aAux < 2.5) {
          // double flash strobes, only in flight like real anti-collision lights
          float p = mod(uTime, 1.3);
          vLamp = 0.15 + 9.0 * (step(p, 0.05) + step(0.17, p) * step(p, 0.22)) * step(uGear, 0.5);
        } else if (aAux > 2.5 && aAux < 3.5) vLamp = 0.25 + 3.0 * pow(max(0.0, sin(uTime * 5.2)), 12.0);
        else if (aAux > 3.5) vLamp = 0.1 + uGear;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLamp;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= vLamp;');
  };

  // Landing gear. The doors open, each leg swings down out of its bay and
  // splays out, then the piston extends and the ladder drops. Legs are
  // modeled deployed, doors closed, and every part is skinned to one bone.
  const bones = [new THREE.Bone()];
  const addBone = (parent, x, y, z) => {
    const b = new THREE.Bone();
    b.position.set(x, y, z);
    parent.add(b);
    bones.push(b);
    return b;
  };
  const legQuat = (q, rx, rz) => q.setFromEuler(_e.set(rx, 0, rz, 'ZYX'));
  const legDefs = [
    { hinge: [0, -0.48, -3.62], bay: bays[0], rake: 0.14, splay: 0, lc: 1.1 },
    { hinge: [0.69, -0.48, 0.78], bay: bays[1], rake: -0.17, splay: 0.45, lc: 1.2 },
    { hinge: [-0.69, -0.48, 0.78], bay: bays[2], rake: -0.17, splay: -0.45, lc: 1.2 },
  ];
  const legs = legDefs.map((d) => {
    const [hx, hy, hz] = d.hinge;
    const len = (hy - (PAD_Y + PAD)) / (Math.cos(d.rake) * Math.cos(d.splay));
    const travel = len - d.lc;
    const strut = addBone(bones[0], hx, hy, hz);
    legQuat(strut.quaternion, d.rake, d.splay);
    const piston = addBone(strut, 0, -(SLEEVE + travel), 0);
    const foot = addBone(piston, 0, -(d.lc - SLEEVE), 0);
    foot.quaternion.copy(strut.quaternion).invert();
    const [x0, z0, x1, z1] = d.bay;
    const doors = [addBone(bones[0], x0, -0.885, (z0 + z1) / 2), addBone(bones[0], x1, -0.885, (z0 + z1) / 2)];
    return { ...d, strut, piston, foot, doors, travel };
  });
  const ladder = addBone(bones[0], -1.19, -0.9, -1.6);
  ladder.rotation.z = -0.22;
  const flaps = [-1, 1].map((s) => {
    const [a, b] = FLAP;
    const p0 = new THREE.Vector3(s * a, wy(a), FLAP_Z);
    const p1 = new THREE.Vector3(s * b, wy(b), FLAP_Z);
    // hinge axis points +x on both sides, so a positive angle drops the trailing edge
    const axis = s > 0 ? p1.clone().sub(p0).normalize() : p0.clone().sub(p1).normalize();
    return { s, a, b, axis, bone: addBone(bones[0], p0.x, p0.y, p0.z) };
  });
  bones[0].updateMatrixWorld(true);

  const put = (bone, geo, local, paint, aux = 0) => {
    R.bone = bones.indexOf(bone);
    R.add(geo, bone.matrixWorld.clone().multiply(local), paint, aux);
  };
  for (const g of legs) {
    R.part(0.6);
    put(g.strut, new THREE.CylinderGeometry(0.1, 0.1, 0.34, 8), T(0, 0, 0, 0, 0, Math.PI / 2), C.metal, 1);
    put(g.strut, new THREE.CylinderGeometry(0.125, 0.12, SLEEVE, 8), T(0, -SLEEVE / 2, 0), C.trim);
    put(g.strut, new THREE.CylinderGeometry(0.15, 0.15, 0.08, 8), T(0, -SLEEVE + 0.05, 0), C.accent);
    put(g.strut, new THREE.BoxGeometry(0.05, SLEEVE * 0.8, 0.05), T(0, -SLEEVE * 0.45, 0.14), C.metal, 1);
    const rodBottom = -(g.lc - SLEEVE);
    put(g.piston, new THREE.CylinderGeometry(0.065, 0.065, 0.5 - rodBottom, 8), T(0, (0.5 + rodBottom) / 2, 0), C.chrome, 1);
    put(g.piston, new THREE.CylinderGeometry(0.075, 0.075, 0.22, 8), T(0, rodBottom, 0, 0, 0, Math.PI / 2), C.metal, 1);
    for (const x of [-0.09, 0.09]) put(g.foot, new THREE.BoxGeometry(0.035, 0.14, 0.1), T(x, -0.05, 0), C.metal, 1);
    put(g.foot, new THREE.CylinderGeometry(0.15, 0.2, 0.065, 8), T(0, -0.08, 0), C.accent);
    R.bone = bones.indexOf(g.foot);
    R.part(0.6);
    const footOutline = [[-0.21, -0.39], [0.21, -0.39], [0.33, -0.22], [0.33, 0.24], [0.2, 0.38], [-0.2, 0.38], [-0.33, 0.24], [-0.33, -0.22]];
    bevelPlate(R, footOutline, -PAD, -0.17, 0.028, g.foot.matrixWorld, C.dark);
    bevelPlate(R, footOutline, -0.175, -0.105, 0.05, g.foot.matrixWorld, C.flap, C.trim);
    for (const z of [-0.27, 0.26]) {
      put(g.foot, new THREE.BoxGeometry(0.34, 0.012, 0.045), T(0, -0.099, z), C.accent);
      for (const x of [-0.225, 0.225]) put(g.foot, new THREE.CylinderGeometry(0.027, 0.027, 0.017, 6), T(x, -0.098, z * 0.76), C.metal, 1);
    }
    // two doors per bay, trim outside with an accent edge
    const [x0, z0, x1, z1] = g.bay;
    const hw = (x1 - x0) / 2 - 0.004;
    const dl = z1 - z0 - 0.01;
    const doorPaint = (base) => (c, n) => (n.y < -0.5 ? base : C.dark);
    R.part(0.3);
    put(g.doors[0], new THREE.BoxGeometry(hw - 0.07, 0.05, dl), T((hw - 0.07) / 2, 0.025, 0), doorPaint(C.trim));
    put(g.doors[0], new THREE.BoxGeometry(0.07, 0.05, dl), T(hw - 0.035, 0.025, 0), doorPaint(C.accent));
    put(g.doors[1], new THREE.BoxGeometry(hw - 0.07, 0.05, dl), T(-(hw - 0.07) / 2, 0.025, 0), doorPaint(C.trim));
    put(g.doors[1], new THREE.BoxGeometry(0.07, 0.05, dl), T(-(hw - 0.035), 0.025, 0), doorPaint(C.accent));
  }
  R.part(0.3);
  for (const z of [-0.16, 0.16]) put(ladder, new THREE.BoxGeometry(0.035, 0.86, 0.045), T(0, -0.43, z), C.metal, 1);
  for (const y of [-0.26, -0.52, -0.78]) put(ladder, new THREE.BoxGeometry(0.05, 0.035, 0.36), T(0, y, 0), C.accent);
  put(ladder, new THREE.CylinderGeometry(0.03, 0.03, 0.42, 6), T(0, 0, 0, Math.PI / 2), C.metal, 1);
  // elevons fill the cut back trailing edge, bind pose is neutral so they're
  // built straight in ship space
  for (const f of flaps) {
    R.bone = bones.indexOf(f.bone);
    R.part(0.45);
    const rings = [f.a, 3.28, 3.46, 3.58, 3.7, f.b].map((w) => {
      const y = wy(w);
      const t = wt(w) * 0.9;
      const te = wte(w);
      return [[FLAP_Z - 0.02, y], [FLAP_Z + 0.06, y + t * 0.45], [te, y + t * 0.1], [te, y - t * 0.1], [FLAP_Z + 0.06, y - t * 0.45]].map(([z, yy]) => new THREE.Vector3(f.s * w, yy, z));
    });
    loft(R, rings, (i, j, c) => (j < 0 || j > 1 ? C.trim : inBand(Math.abs(c.x)) ? C.accent : C.flap), { capStart: true, capEnd: true });
  }

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const hullMesh = new THREE.Mesh(H.build(), matPaint);
  hullMesh.castShadow = true;
  hullMesh.receiveShadow = true;
  body.add(hullMesh);
  const glassMesh = new THREE.Mesh(G.build(), matGlass);
  glassMesh.receiveShadow = true;
  body.add(glassMesh);
  const lampMesh = new THREE.Mesh(L.build(), matLamp);
  body.add(lampMesh);

  const gear = new THREE.SkinnedMesh(R.build(true), matPaint);
  gear.add(bones[0]);
  gear.bind(new THREE.Skeleton(bones));
  gear.castShadow = true;
  gear.receiveShadow = true;
  // bounds are taken once from the bind pose, the legs move outside them
  gear.frustumCulled = false;
  // Game.js only disposes geometry and materials, this frees the bone texture too
  gear.geometry.addEventListener('dispose', () => gear.skeleton.dispose());
  body.add(gear);

  // engine flames on the post layer so they skip the atmosphere pass. Outer
  // plume plus a short white hot core in one geometry.
  const flameUniforms = {
    uColor: { value: glow.clone() },
    uPower: { value: 0.3 },
    uTime: { value: 0 },
    uAtmo: { value: 1 },
    uLen: { value: 1 },
  };
  const flameMat = new THREE.ShaderMaterial({
    uniforms: flameUniforms,
    vertexShader: flameVert,
    fragmentShader: flameFrag,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const cone = (r0, r1, len, segs, core) => {
    const g = new THREE.CylinderGeometry(r0, r1, len, segs, 10, true);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, len / 2);
    g.setAttribute('aCore', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(core), 1));
    return g;
  };
  const flameGeo = mergeGeometries([cone(0.44, 0.03, 1, 20, 0), cone(0.26, 0.03, 0.42, 14, 1)]);
  const flames = [];
  for (const n of nozzles) {
    const f = new THREE.Mesh(flameGeo, flameMat);
    f.position.copy(n);
    f.layers.set(LAYER_POST);
    f.frustumCulled = false;
    body.add(f);
    flames.push(f);
  }

  // mining lasers from the chin emitters
  const laserUniforms = { uColor: { value: new THREE.Color(1.0, 0.35, 0.15) }, uTime: { value: 0 } };
  const laserMat = new THREE.ShaderMaterial({
    uniforms: laserUniforms,
    vertexShader: laserVert,
    fragmentShader: laserFrag,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const laserGeo = new THREE.CylinderGeometry(0.09, 0.09, 1, 8, 1, true);
  laserGeo.rotateX(-Math.PI / 2);
  laserGeo.translate(0, 0, -0.5);
  const guns = [new THREE.Vector3(-0.42, -0.5, -5.36), new THREE.Vector3(0.42, -0.5, -5.36)];
  const lasers = guns.map((gp) => {
    const m = new THREE.Mesh(laserGeo, laserMat);
    m.position.copy(gp);
    m.layers.set(LAYER_POST);
    m.frustumCulled = false;
    m.visible = false;
    body.add(m);
    return m;
  });

  // elevons droop a little with the gear down and work as ailerons against
  // the cosmetic bank (bank > 0 rolls left, so the right one goes down)
  let gearNow = 1;
  let bankNow = 0;
  const setFlaps = () => {
    for (const f of flaps) f.bone.quaternion.setFromAxisAngle(f.axis, 0.3 * gearNow + f.s * 0.5 * bankNow);
  };

  const model = {
    root,
    body,
    gear,
    flames,
    flameUniforms,
    nozzles,
    setBank(bank) {
      bankNow = bank;
      setFlaps();
    },
    setGear(t) {
      gearNow = t;
      setFlaps();
      const doors = smoothstep(0, 0.3, t);
      const swing = smoothstep(0.12, 0.72, t);
      const splay = smoothstep(0.4, 0.85, t);
      const ext = smoothstep(0.68, 1, t);
      for (const g of legs) {
        legQuat(g.strut.quaternion, lerp(-Math.PI / 2, g.rake, swing), g.splay * splay);
        g.foot.quaternion.copy(g.strut.quaternion).invert();
        g.piston.position.y = -(SLEEVE + g.travel * ext);
        g.doors[0].rotation.z = -doors * 1.75;
        g.doors[1].rotation.z = doors * 1.75;
      }
      ladder.rotation.z = lerp(Math.PI / 2, -0.22, smoothstep(0.5, 0.95, t));
      lampUniforms.uGear.value = t;
    },
    // atmo is 0 in vacuum and 1 in air, it shapes the plume. Left as is when omitted.
    setThrust(power, time, atmo) {
      const len = 0.6 + power * 4.6;
      flameUniforms.uPower.value = power;
      flameUniforms.uTime.value = time || env.uTime.value;
      flameUniforms.uLen.value = len;
      if (atmo !== undefined) flameUniforms.uAtmo.value = atmo;
      lampUniforms.uThrust.value = Math.min(power, 1.6);
      for (const f of flames) f.scale.set(1, 1, len);
    },
    // target is in body space, null turns the lasers off
    setLaser(target, time) {
      laserUniforms.uTime.value = time;
      for (let i = 0; i < lasers.length; i++) {
        const l = lasers[i];
        if (!target) {
          l.visible = false;
          continue;
        }
        l.visible = true;
        const d = target.clone().sub(guns[i]);
        const len = d.length();
        l.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), d.normalize());
        l.scale.set(1, 1, len);
      }
    },
  };
  model.setGear(1);
  model.setThrust(0, 0);
  return model;
}

const laserVert = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const laserFrag = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uTime;
varying vec3 vPos;
void main() {
  #include <logdepthbuf_fragment>
  float pulse = 0.7 + 0.3 * sin(vPos.z * 40.0 + uTime * 60.0);
  gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.4) * 4.0 * pulse, 1.0);
}
`;
