import * as THREE from 'three';
import { LAYER_POST } from '../render/pipeline.js';
import { soiRadius } from '../world/starSystem.js';

// Arcade gravity. Every body pulls about 9.5 m/s² at the surface no matter its
// size, which puts a low orbit around a 5 km planet at roughly 200 m/s. That's
// close to the ship's cruise speed, so orbits feel like part of normal flight.
const SURFACE_G = 9.5;

export function gm(body) {
  return SURFACE_G * body.radius * body.radius;
}

// Lowest radius an orbit can hold. Ship.measure() fades the air in from 1.25x
// the atmosphere height, so the floor sits just above that. Airless worlds
// only need to clear the tallest peaks.
export function orbitFloor(body) {
  if (!body.def.atmosphere) return body.radius + (body.maxH || 0) + 250;
  return body.radius + (body.atmoRadius - body.radius) * 1.2 + 60;
}

export function orbitCeiling(body) {
  return soiRadius(body) * 0.97;
}

// body angular velocity crossed with a local position, in local axes
export function spinVel(body, r, out = new THREE.Vector3()) {
  return out.set(body.spin * r.z, 0, -body.spin * r.x);
}

const _h = new THREE.Vector3();
const _e = new THREE.Vector3();

// Keplerian elements from a local position and inertial velocity. Only what
// the HUD and the orbit line need.
export function elements(r, v, mu, out = {}) {
  const rl = r.length();
  _h.crossVectors(r, v);
  _e.crossVectors(v, _h).divideScalar(mu).addScaledVector(r, -1 / rl);
  const ecc = _e.length();
  const p = _h.lengthSq() / mu;
  out.ecc = ecc;
  out.p = p;
  out.pe = p / (1 + ecc);
  out.ap = ecc < 1 ? p / (1 - ecc) : Infinity;
  out.a = ecc < 1 ? p / (1 - ecc * ecc) : Infinity;
  out.period = ecc < 1 ? Math.PI * 2 * Math.sqrt((out.a * out.a * out.a) / mu) : Infinity;
  out.n = (out.h || (out.h = new THREE.Vector3())).copy(_h).normalize();
  // near circular orbits have no stable periapsis direction, use the ship's
  out.P = (out.P || new THREE.Vector3()).copy(ecc > 1e-4 ? _e : r).normalize();
  out.Q = (out.Q || new THREE.Vector3()).crossVectors(out.n, out.P);
  // true anomaly of the ship right now
  const nu = Math.atan2(r.dot(out.Q), r.dot(out.P));
  out.nu = nu;
  return out;
}

function meanAnomaly(nu, ecc) {
  const E = 2 * Math.atan(Math.sqrt((1 - ecc) / (1 + ecc)) * Math.tan(nu / 2));
  return E - ecc * Math.sin(E);
}

// seconds until the orbit drops through `radius`, or Infinity if it never does
export function timeToRadius(el, radius, mu) {
  if (el.ecc >= 1 || el.pe >= radius || el.ecc < 1e-5) return Infinity;
  const c = (el.p / radius - 1) / el.ecc;
  if (c > 1 || c < -1) return Infinity;
  // the crossing on the way down is before periapsis
  const nuHit = -Math.acos(c);
  const n = Math.sqrt(mu / (el.a * el.a * el.a));
  let dM = meanAnomaly(nuHit, el.ecc) - meanAnomaly(el.nu, el.ecc);
  const TAU = Math.PI * 2;
  dM = ((dM % TAU) + TAU) % TAU;
  return dM / n;
}

const SEGS = 180;
const LINE = new THREE.Color(0.55, 0.85, 1.0);
const HOT = new THREE.Color(1.0, 0.5, 0.18);

// The predicted path drawn around the planet while orbiting. Starts at the
// ship and fades as it goes around, turns orange where it dips toward the air
// and stops where it would enter the atmosphere or leave the planet's space.
export class OrbitLine {
  constructor(scene) {
    this.pos = new Float32Array((SEGS + 1) * 3);
    this.col = new Float32Array((SEGS + 1) * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.line.frustumCulled = false;
    this.line.layers.set(LAYER_POST);
    this.line.visible = false;
    scene.add(this.line);
    this.alpha = 0;
    this.pe = new THREE.Vector3();
    this.ap = new THREE.Vector3();
  }

  // el from elements(), in the body's local axes at this instant
  update(dt, body, el, show, origin) {
    this.alpha += ((show ? 1 : 0) - this.alpha) * Math.min(1, dt * 3);
    this.line.visible = this.alpha > 0.01 && !!body;
    if (!this.line.visible) return;
    const floor = orbitFloor(body);
    const ceil = soiRadius(body);
    const { ecc, p, P, Q } = el;
    // for escape paths only sweep up to the asymptote
    let span = Math.PI * 2;
    if (ecc >= 1) span = Math.acos(-1 / ecc) - el.nu - 0.02;
    let n = 0;
    for (let i = 0; i <= SEGS; i++) {
      const nu = el.nu + (span * i) / SEGS;
      const r = p / (1 + ecc * Math.cos(nu));
      const out = r <= 0 || r > ceil;
      const low = r < floor;
      if (out && i > 0) break;
      const c = Math.cos(nu), s = Math.sin(nu);
      const o = n * 3;
      this.pos[o] = (P.x * c + Q.x * s) * r;
      this.pos[o + 1] = (P.y * c + Q.y * s) * r;
      this.pos[o + 2] = (P.z * c + Q.z * s) * r;
      // bright near the ship, dimmer around the far side
      const f = (i / SEGS);
      const k = this.alpha * (1.6 - 1.1 * f) * (i < 3 ? i / 3 : 1);
      const hot = 1 - Math.min(1, Math.max(0, (r - floor) / 500));
      this.col[o] = (LINE.r + (HOT.r - LINE.r) * hot) * k;
      this.col[o + 1] = (LINE.g + (HOT.g - LINE.g) * hot) * k;
      this.col[o + 2] = (LINE.b + (HOT.b - LINE.b) * hot) * k;
      n++;
      if (low) break;
    }
    const g = this.line.geometry;
    g.setDrawRange(0, n);
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    this.line.position.subVectors(body.position, origin);
    this.line.quaternion.copy(body.quat);
    // apsis points for the HUD markers, local axes
    this.pe.copy(P).multiplyScalar(el.pe);
    if (ecc < 1) this.ap.copy(P).multiplyScalar(-el.ap);
  }

  dispose() {
    this.line.parent?.remove(this.line);
    this.line.geometry.dispose();
    this.line.material.dispose();
  }
}
