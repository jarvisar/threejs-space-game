import * as THREE from 'three';
import { buildShip } from './shipModel.js';
import { Planet, surfaceNormal } from '../world/planet.js';
import { smoothstep, lerp } from '../core/math.js';
import { gm, orbitFloor, orbitCeiling, spinVel, elements } from './orbit.js';

const GEAR_HEIGHT = 2.05;
const CLEARANCE = 2.4;
// generous on purpose, the landing animation covers the rest of the way
const LAND_ALT = 160;
const LAND_SPEED = 90;
// seconds ahead the ground check looks along the velocity
const LOOKAHEAD = [0.35, 0.8, 1.4];

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _up = new THREE.Vector3();
const _f = new THREE.Vector3();
const _lat = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const ORIGIN = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

// Arcade flight model with mouse aim. The camera follows `aim`, the hull turns
// toward it at a limited rate. All state is in the current frame, either the
// system frame (frame = null) or a body's rotating frame.
//
// Orbit is a separate mode inside the 'flying' state. It's the only place
// gravity exists: normal flight ignores it so the ship always goes where it
// points, and orbiting is something the player opts into with C.
export class Ship {
  constructor(colors) {
    this.model = buildShip(colors);
    this.frame = null;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.aim = new THREE.Quaternion();
    this.throttle = 0.25;
    this.state = 'flying';
    this.anim = null;
    this.gear = 1;
    this.pulse = false;
    this.pulseSpool = 0;
    this.pulseSpeed = 0;
    this.boost = 0;
    this.energy = 1;
    this.bank = 0;
    this.speed = 0;
    this.altitude = Infinity;
    this.inAtmo = 0;
    this.prevAtmo = 0;
    this.orbit = null;
    this.entry = 0;
    this.heat = 0;
    this.cushion = 0;
    this.freeLook = false;
    this.queuedPulse = 0;
    this.spin = null;
    this.tapT = { KeyA: -1, KeyD: -1 };
    this.clock = 0;
    this.stats = {
      speed: 180,
      boost: 480,
      atmoSpeed: 120,
      atmoBoost: 300,
      pulse: 120000,
      turn: 1.8,
    };
    this.events = [];
  }

  worldPos(out = new THREE.Vector3()) {
    return this.frame ? this.frame.toWorld(this.pos, out) : out.copy(this.pos);
  }

  worldQuat(out = new THREE.Quaternion()) {
    return this.frame ? out.multiplyQuaternions(this.frame.quat, this.quat) : out.copy(this.quat);
  }

  forward(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(this.quat);
  }

  // world space velocity, including the frame's spin
  worldVel(out = new THREE.Vector3()) {
    if (!this.frame) return out.copy(this.vel);
    return out.copy(this.vel).applyQuaternion(this.frame.quat).add(this.frame.frameVelocity(this.pos, _v2));
  }

  // move into a new frame keeping the world-space motion continuous
  setFrame(body) {
    if (body === this.frame) return;
    const wp = this.worldPos();
    const wv = this.vel.clone();
    const wq = this.worldQuat();
    const wa = this.frame ? new THREE.Quaternion().multiplyQuaternions(this.frame.quat, this.aim) : this.aim.clone();
    if (this.frame) {
      wv.applyQuaternion(this.frame.quat).add(this.frame.frameVelocity(this.pos));
    }
    this.frame = body;
    if (body) {
      body.toLocal(wp, this.pos);
      wv.sub(body.frameVelocity(this.pos)).applyQuaternion(body.invQuat);
      this.vel.copy(wv);
      this.quat.multiplyQuaternions(body.invQuat, wq);
      this.aim.multiplyQuaternions(body.invQuat, wa);
    } else {
      this.pos.copy(wp);
      this.vel.copy(wv);
      this.quat.copy(wq);
      this.aim.copy(wa);
    }
  }

  emit(type, data) {
    this.events.push({ type, ...data });
  }

  // altitude and atmosphere depth, valid in every state
  measure() {
    if (this.frame) {
      const r = this.pos.length();
      _v.copy(this.pos).divideScalar(r);
      this.altitude = r - this.frame.floorRadius(_v);
      const atmoH = this.frame.atmoRadius - this.frame.radius;
      this.inAtmo = 1 - smoothstep(atmoH * 0.7, atmoH * 1.25, r - this.frame.radius);
    } else {
      this.altitude = Infinity;
      this.inAtmo = 0;
    }
  }

  update(dt, input, ctx) {
    this.clock += dt;
    this.measure();
    if (this.state === 'landing' || this.state === 'takeoff') {
      this.updateAnim(dt);
    } else if (this.state === 'flying') {
      if (this.orbit) this.updateOrbit(dt, input, ctx);
      else this.updateFlight(dt, input, ctx);
    }
    const g = this.state === 'flying' ? 0 : 1;
    this.gear += (g - this.gear) * Math.min(1, dt * 3);
    this.model.setGear(this.gear);

    // entry glow needs real air, speed, and a recent drop in from above
    let heat = 0;
    if (this.state === 'flying' && !this.orbit) heat = this.entry * smoothstep(110, 230, this.speed) * smoothstep(0, 0.12, this.inAtmo);
    this.heat += (heat - this.heat) * Math.min(1, dt * 4);
  }

  updateFlight(dt, input, ctx) {
    const st = this.stats;
    const up = this.frame ? _up.copy(this.pos).normalize() : null;
    this.freeLook = input.mouse(2) && !this.pulse;

    // aim from the mouse, in the aim's own axes. Holding right mouse looks
    // around instead and the ship holds its course.
    if (input.enabled) {
      if (!this.freeLook) {
        const look = input.look();
        const turnScale = this.pulse ? 0.45 : 1;
        this.aim.multiply(_q.setFromAxisAngle(Y, -look.x * turnScale));
        this.aim.multiply(_q.setFromAxisAngle(X, -look.y * turnScale));
      }
      const roll = input.axis('KeyD', 'KeyA');
      if (roll) this.aim.multiply(_q.setFromAxisAngle(Z, roll * 1.9 * dt));
      // double tap A or D for a barrel roll that also sidesteps
      for (const [code, dir] of [['KeyA', 1], ['KeyD', -1]]) {
        if (!input.hit(code)) continue;
        if (this.clock - this.tapT[code] < 0.28 && !this.spin && !this.pulse) {
          this.spin = { t: 0, dir };
          this.vel.addScaledVector(_v.set(-dir, 0, 0).applyQuaternion(this.quat), 38);
          this.emit('roll', {});
        }
        this.tapT[code] = this.clock;
      }
      // auto level against the horizon when low
      if (this.frame && !roll && this.inAtmo > 0.05) {
        const fwd = _v.set(0, 0, -1).applyQuaternion(this.aim);
        const aup = _v2.set(0, 1, 0).applyQuaternion(this.aim);
        const proj = _p.copy(up).addScaledVector(fwd, -up.dot(fwd));
        if (proj.lengthSq() > 0.02) {
          proj.normalize();
          const angle = Math.atan2(aup.clone().cross(proj).dot(fwd), aup.dot(proj));
          const k = (1 - Math.exp(-dt * 2.2)) * this.inAtmo;
          this.aim.premultiply(_q.setFromAxisAngle(fwd, angle * k));
        }
      }
      // the pulse drive homes in on a planet near the reticle
      if (this.pulse && ctx.lockDir && Math.abs(input.dx) + Math.abs(input.dy) < 3) {
        const fwd = _v.set(0, 0, -1).applyQuaternion(this.aim);
        _q.setFromUnitVectors(fwd, ctx.lockDir);
        this.aim.premultiply(_q2.identity().slerp(_q, 1 - Math.exp(-dt * 1.2)));
      }
    }
    this.aim.normalize();
    // keep the aim within reach of the nose so the camera can't run away
    const lead = this.quat.angleTo(this.aim);
    const maxLead = 0.7;
    if (lead > maxLead && !this.queuedPulse) this.aim.copy(this.quat).rotateTowards(this.aim.clone(), maxLead);

    // hull follows the aim
    const ang = this.quat.angleTo(this.aim);
    const turn = st.turn * (this.pulse ? 0.5 : 1);
    const step = Math.min(ang * (1 - Math.exp(-dt * 5)), turn * dt);
    const before = this.forward(_v2).clone();
    this.quat.rotateTowards(this.aim, step);
    const after = this.forward(_v);
    // cosmetic bank from the turn rate
    const yawRate = before.cross(after).dot(_p.set(0, 1, 0).applyQuaternion(this.quat)) / Math.max(dt, 1e-4);
    this.bank += (Math.max(-0.7, Math.min(0.7, -yawRate * 0.5)) - this.bank) * Math.min(1, dt * 4);
    if (this.spin) {
      this.spin.t += dt / 0.55;
      if (this.spin.t >= 1) this.spin = null;
    }

    // throttle
    if (input.key('KeyW')) this.throttle = Math.min(1, this.throttle + dt * 0.8);
    if (input.key('KeyS')) this.throttle = Math.max(-0.15, this.throttle - dt * 1.0);

    // boost uses a small energy pool
    const wantsBoost = input.key('ShiftLeft') || input.key('ShiftRight');
    if (wantsBoost && this.energy > 0.02 && !this.pulse) {
      if (this.boost < 0.05) this.emit('boost', {});
      this.boost = Math.min(1, this.boost + dt * 3);
      this.energy = Math.max(0, this.energy - dt * 0.18);
    } else {
      this.boost = Math.max(0, this.boost - dt * 2);
      this.energy = Math.min(1, this.energy + dt * 0.1);
    }

    // pulse drive
    if (this.queuedPulse) {
      this.queuedPulse = Math.max(0, this.queuedPulse - dt);
      if (input.key('KeyS') || input.hit('Space')) this.queuedPulse = 0;
      else if (this.quat.angleTo(this.aim) < 0.08) {
        this.queuedPulse = 0;
        this.tryPulse(ctx);
      }
    } else if (input.hit('Space')) {
      if (this.pulse) this.dropPulse('manual');
      else this.tryPulse(ctx);
    }
    if (this.pulse) {
      // only drop near a body while still heading toward it, so it can be
      // started from low orbit and fly away
      const aimFwd = _f.set(0, 0, -1).applyQuaternion(this.aim);
      const closing = !ctx.nearDir || aimFwd.dot(ctx.nearDir) > 0;
      if (ctx.clearance < 600 && closing) this.dropPulse('proximity');
      else if (input.key('KeyS')) this.dropPulse('brake');
    }

    const fwd = this.forward(_f);
    if (this.pulse) {
      this.pulseSpool = Math.min(1, this.pulseSpool + dt / 1.4);
      // top speed scales with distance to the nearest atmosphere so arrivals ease in
      const cap = Math.min(st.pulse, Math.max(500, ctx.clearance * 0.9));
      if (this.pulseSpool > 0.6) this.pulseSpeed = Math.min(cap, this.pulseSpeed * Math.pow(3.5, dt) + 400 * dt);
      else this.pulseSpeed = Math.min(cap, this.pulseSpeed + 60 * dt);
      this.pulseSpeed = Math.min(this.pulseSpeed, cap);
      this.vel.copy(fwd).multiplyScalar(this.pulseSpeed);
    } else {
      const base = lerp(st.speed, st.atmoSpeed, this.inAtmo);
      const boostSpeed = lerp(st.boost, st.atmoBoost, this.inAtmo);
      let target = this.throttle * base + this.boost * (boostSpeed - base * Math.max(0, this.throttle));
      // in air, diving trades height for speed and climbing costs a little
      if (up && this.inAtmo > 0 && target > 0) {
        const slope = fwd.dot(up);
        target *= 1 + this.inAtmo * (slope < 0 ? -slope * 0.35 : -slope * 0.12);
      }
      // Speed along the nose eases toward the target, sideways slip dies off.
      // Grippy in air so it carves like a plane, looser in space.
      let along = this.vel.dot(fwd);
      _lat.copy(this.vel).addScaledVector(fwd, -along);
      // faster response when slowing down so the ship doesn't float past things,
      // but entry bleeds speed slowly so the fire has time to show
      let rate = along > target ? 1.7 : 1.1;
      if (this.entry > 0.2 && along > target) rate = 0.5;
      along += (target - along) * (1 - Math.exp(-dt * rate));
      _lat.multiplyScalar(Math.exp(-dt * lerp(1.8, 4.5, this.inAtmo)));
      this.vel.copy(fwd).multiplyScalar(along).add(_lat);
      if (up) this.groundCushion(dt, up, fwd);
    }

    // entry starts when the ship drops into the air fast from above
    if (up && this.frame.def.atmosphere) {
      if (this.prevAtmo < 0.02 && this.inAtmo >= 0.02 && this.vel.dot(up) < -5 && this.speed > 150 && !this.pulse) {
        this.entry = 1;
        this.emit('entry', {});
      }
    }
    this.prevAtmo = this.inAtmo;
    if (this.entry > 0) this.entry = Math.max(0, this.entry - dt * (this.speed < 140 ? 1.2 : 0.12));

    this.pos.addScaledVector(this.vel, dt);
    this.speed = this.vel.length();

    if (this.frame) this.collide(dt);
    this.model.setThrust(0.12 + Math.max(0, this.throttle) * 0.45 + this.boost * 0.7 + (this.pulse ? 0.9 : 0), ctx.time, this.inAtmo);
  }

  tryPulse(ctx) {
    const fwd = _f.set(0, 0, -1).applyQuaternion(this.aim);
    // near a body it can still start when pointed away from it
    const away = ctx.nearDir && fwd.dot(ctx.nearDir) < -0.3 && ctx.clearance > 100;
    if ((ctx.clearance <= 1500 && !away) || this.throttle < 0 || this.inAtmo > 0.1) {
      this.emit('pulseBlocked', { reason: this.inAtmo > 0.1 ? 'atmo' : this.throttle < 0 ? 'reverse' : 'near' });
      return false;
    }
    this.pulse = true;
    this.pulseSpool = 0;
    this.pulseSpeed = Math.max(this.speed, 200);
    this.emit('pulseStart', {});
    return true;
  }

  // Look ahead along the velocity and lift the ship over terrain it's about to
  // hit, so skimming low over hills is fun instead of a string of crashes.
  // Landing is a separate action, so this never has to let the ship touch down.
  groundCushion(dt, up, fwd) {
    this.cushion = Math.max(0, this.cushion - dt * 2);
    if (this.altitude > 260 || this.vel.lengthSq() < 25) return;
    let worst = this.altitude;
    for (const t of LOOKAHEAD) {
      _p.copy(this.pos).addScaledVector(this.vel, t);
      const r = _p.length();
      const clr = r - this.frame.floorRadius(_p.divideScalar(r));
      if (clr < worst) worst = clr;
    }
    const want = 6 + Math.min(18, this.vel.length() * 0.05);
    if (worst >= want) return;
    const push = (want - worst) / want;
    const need = (want - worst) * 2.4;
    const vr = this.vel.dot(up);
    if (vr < need) this.vel.addScaledVector(up, (need - vr) * Math.min(1, dt * 8));
    this.cushion = Math.max(this.cushion, Math.min(1, push));
    // bring a dive back toward level so it reads as the ship pulling up, not
    // being shoved. Never past level, or it keeps climbing after the hill.
    if (fwd.dot(up) < -0.02) this.aim.multiply(_q.setFromAxisAngle(X, Math.min(1, push) * dt * 0.9));
  }

  dropPulse(reason) {
    if (!this.pulse) return;
    this.pulse = false;
    const fwd = this.forward(_v);
    this.vel.copy(fwd).multiplyScalar(Math.min(this.pulseSpeed, this.stats.speed * 1.2));
    this.throttle = Math.max(this.throttle, 0.6);
    this.emit('pulseEnd', { reason });
  }

  collide() {
    const r = this.pos.length();
    const dir = _v.copy(this.pos).divideScalar(r);
    const floor = this.frame.floorRadius(dir);
    if (r < floor + CLEARANCE) {
      const inward = -this.vel.dot(dir);
      this.pos.copy(dir).multiplyScalar(floor + CLEARANCE);
      if (inward > 0) {
        this.vel.addScaledVector(dir, inward * 1.25);
        if (inward > 14) {
          this.emit('impact', { speed: inward });
        } else if (inward > 4) {
          this.emit('scrape', { speed: inward });
        }
      }
      if (this.pulse) this.dropPulse('impact');
    }
  }

  // ---------------------------------------------------------------- orbit

  // null if the ship can settle into orbit here, otherwise why not
  canOrbit() {
    const b = this.frame;
    if (this.state !== 'flying' || this.orbit) return 'busy';
    if (!b) return 'space';
    const r = this.pos.length();
    if (r < orbitFloor(b)) return 'low';
    if (r > orbitCeiling(b)) return 'far';
    return null;
  }

  enterOrbit(instant = false) {
    const b = this.frame;
    const v = spinVel(b, this.pos, new THREE.Vector3()).add(this.vel);
    // settles at the current height, or a bit over the floor when arriving low and fast
    const settleR = Math.min(orbitCeiling(b) * 0.95, Math.max(this.pos.length(), orbitFloor(b) + 150));
    this.orbit = { v, settle: 0, settleR, el: {}, burn: 0, side: 0, warp: 1, view: new THREE.Quaternion(), mu: gm(b), time: 0 };
    this.pulse = false;
    this.boost = 0;
    this.entry = 0;
    if (instant) {
      this.circular(v);
      this.orbit.settle = 1;
    }
    this.orbitView(this.orbit.view);
    if (instant) this.quat.copy(this.orbit.view);
    elements(this.pos, v, this.orbit.mu, this.orbit.el);
    this.emit('orbitStart', { instant });
  }

  // circular orbit velocity at the current radius, keeping the direction of travel
  circular(out) {
    const o = this.orbit;
    const r = this.pos.length();
    const rh = _p.copy(this.pos).divideScalar(r);
    out.copy(o.v).addScaledVector(rh, -o.v.dot(rh));
    if (out.lengthSq() < 15 * 15) {
      this.forward(out);
      out.addScaledVector(rh, -out.dot(rh));
      if (out.lengthSq() < 0.01) out.crossVectors(rh, Math.abs(rh.y) < 0.9 ? Y : X);
    }
    return out.normalize().multiplyScalar(Math.sqrt(o.mu / r));
  }

  // prograde forward, radial up
  orbitView(out) {
    const up = _v2.copy(this.pos).normalize();
    const fwd = _p.copy(this.orbit.v).normalize();
    _m.lookAt(ORIGIN, fwd, up);
    return out.setFromRotationMatrix(_m);
  }

  updateOrbit(dt, input, ctx) {
    const b = this.frame;
    const o = this.orbit;
    if (!b) return this.leaveOrbit('escape');
    o.time += dt;
    this.freeLook = false;

    // pulse toward wherever the camera is looking, once the ship has turned
    if (input.hit('Space')) {
      this.leaveOrbit('pulse', ctx.camDir);
      this.queuedPulse = 3;
      return;
    }

    // W/S burn along the orbit, A/D tilt its plane. Shift fast forwards the
    // orbit, a real lap takes a few minutes.
    const fwdIn = input.axis('KeyS', 'KeyW');
    const side = input.axis('KeyD', 'KeyA');
    const fast = input.key('ShiftLeft') || input.key('ShiftRight');
    o.warp += ((fast ? 4 : 1) - o.warp) * Math.min(1, dt * 3);
    const acc = 6;
    o.burn += (fwdIn - o.burn) * Math.min(1, dt * 6);
    o.side += (side - o.side) * Math.min(1, dt * 6);
    if ((fwdIn || side) && o.settle < 1 && (o.settleT || 0) > 0.8) o.settle = 1;
    const burn = _lat.set(0, 0, 0);
    if (fwdIn) burn.copy(o.v).normalize().multiplyScalar(fwdIn * acc);
    if (side) burn.addScaledVector(_f.crossVectors(this.pos, o.v).normalize(), side * acc * 0.6);

    // settling in: steer toward a circular orbit at settleR, done once it's
    // close, then snap the last bit so it reads as a clean circle
    if (o.settle < 1) {
      o.settleT = (o.settleT || 0) + dt;
      const r = this.pos.length();
      const rh = _v2.copy(this.pos).divideScalar(r);
      const climb = Math.max(-40, Math.min(40, (o.settleR - r) * 0.8));
      o.v.lerp(this.circular(_v).addScaledVector(rh, climb), 1 - Math.exp(-dt * 2.4));
      const close = Math.abs(o.settleR - r) < 40 && Math.abs(o.v.dot(rh)) < 6;
      o.settle = Math.min(0.99, o.settleT / 2.2);
      if ((o.settleT > 2.2 && close) || o.settleT > 7) {
        o.settle = 1;
        o.v.copy(this.circular(_v));
      }
    }

    const sdt = dt * o.warp;
    const n = Math.max(1, Math.ceil(sdt * 120));
    const h = sdt / n;
    for (let i = 0; i < n; i++) {
      const r = this.pos.length();
      o.v.addScaledVector(this.pos, (-o.mu / (r * r * r)) * h).addScaledVector(burn, h);
      // the local axes turn with the planet, so an inertial vector turns back
      o.v.applyAxisAngle(Y, -b.spin * h);
      this.vel.copy(o.v).sub(spinVel(b, this.pos, _v));
      this.pos.addScaledVector(this.vel, h);
    }
    this.speed = this.vel.length();
    elements(this.pos, o.v, o.mu, o.el);

    const r = this.pos.length();
    if (r < orbitFloor(b) - (o.settle < 1 ? 250 : 0)) return this.leaveOrbit('entry');

    // hull faces prograde, or turns around for a retrograde burn
    this.orbitView(o.view);
    _q.copy(o.view);
    if (o.burn < -0.3) _q.multiply(_q2.setFromAxisAngle(Y, Math.PI));
    this.quat.slerp(_q, 1 - Math.exp(-dt * 2.2));
    this.aim.copy(this.quat);
    this.bank += (o.side * -0.35 - this.bank) * Math.min(1, dt * 3);
    this.throttle = Math.abs(o.burn);
    this.energy = Math.min(1, this.energy + dt * 0.1);
    this.model.setThrust(0.08 + Math.abs(o.burn) * 0.8 + Math.abs(o.side) * 0.3 + (o.settle < 1 ? 0.35 : 0), ctx.time, 0);
  }

  // back to normal flight. Keeps the current motion and points the ship along
  // it, or along `dir` (local) when given.
  leaveOrbit(reason, dir) {
    if (!this.orbit) return;
    this.orbit = null;
    const up = _v2.copy(this.pos).normalize();
    const fwd = _p.copy(dir || this.vel).normalize();
    // A decaying orbit only grazes the air, and flying straight from there
    // climbs back out as the ground curves away. Point it down into a real dive.
    if (reason === 'entry') {
      const a = this.frame.def.atmosphere ? 0.32 : 0.18;
      fwd.addScaledVector(up, -fwd.dot(up)).normalize().multiplyScalar(Math.cos(a)).addScaledVector(up, -Math.sin(a));
      this.vel.copy(fwd).multiplyScalar(this.speed);
    }
    _m.lookAt(ORIGIN, fwd, up);
    this.aim.setFromRotationMatrix(_m);
    const base = lerp(this.stats.speed, this.stats.atmoSpeed, this.inAtmo);
    this.throttle = Math.max(0.3, Math.min(1, this.speed / base));
    this.emit('orbitEnd', { reason });
  }

  // ---------------------------------------------------------------- landing

  // returns null or a reason string
  canLand() {
    if (!(this.frame instanceof Planet)) return 'space';
    if (this.orbit) return 'orbit';
    if (this.altitude > LAND_ALT) return 'high';
    if (this.speed > LAND_SPEED) return 'fast';
    return null;
  }

  // Closest flat, dry spot near where the ship is heading. Rings out to about
  // 60 m, so a steep slope right below doesn't block landing. It starts a bit
  // ahead of the ship, straight down is out of view from the chase camera.
  findLandingSite(quick = false) {
    const planet = this.frame;
    if (!(planet instanceof Planet)) return null;
    const up = _v.copy(this.pos).normalize();
    const ahead = this.forward(_v2).addScaledVector(up, -_v2.dot(up));
    if (ahead.lengthSq() > 0.01) ahead.normalize().multiplyScalar(Math.min(110, 30 + this.altitude * 1.1));
    const center = this.pos.clone().add(ahead).addScaledVector(this.vel, 0.6).addScaledVector(up, -this.vel.dot(up) * 0.6).normalize();
    const ok = (d) => {
      const h = planet.heightAt(d);
      if (planet.seaLevel !== null && h < 0.4) return false;
      return surfaceNormal(planet, d, 2.5).dot(d) >= Math.cos(0.5);
    };
    if (ok(center)) return center;
    if (quick) return null;
    const t1 = new THREE.Vector3().crossVectors(center, Math.abs(center.y) < 0.9 ? Y : X).normalize();
    const t2 = new THREE.Vector3().crossVectors(center, t1);
    const R = planet.radius;
    const d = new THREE.Vector3();
    for (const ring of [9, 18, 30, 44, 60]) {
      const count = Math.round(ring / 3.5);
      for (let k = 0; k < count; k++) {
        const a = (k / count) * Math.PI * 2 + ring;
        d.copy(center).multiplyScalar(R).addScaledVector(t1, Math.cos(a) * ring).addScaledVector(t2, Math.sin(a) * ring).normalize();
        if (ok(d)) return d.clone();
      }
    }
    return null;
  }

  // site is a local direction from findLandingSite
  startLanding(site) {
    const planet = this.frame;
    const dir = site;
    const h = planet.heightAt(dir);
    const n = surfaceNormal(planet, dir, 2.5);
    const up = dir.clone().lerp(n, 0.6).normalize();
    const toPos = dir.clone().multiplyScalar(planet.radius + h).addScaledVector(up, GEAR_HEIGHT);
    const fwd = this.forward(new THREE.Vector3()).projectOnPlane(up).normalize();
    if (fwd.lengthSq() < 0.1) fwd.set(1, 0, 0).projectOnPlane(up).normalize();
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), fwd, up);
    const toQuat = new THREE.Quaternion().setFromRotationMatrix(m);
    const dist = toPos.distanceTo(this.pos);
    this.anim = {
      t: 0,
      dur: Math.min(4.2, Math.max(2.2, 1.7 + dist / 70)),
      fromPos: this.pos.clone(),
      toPos,
      fromQuat: this.quat.clone(),
      toQuat,
      kind: 'landing',
    };
    this.pulse = false;
    this.spin = null;
    this.state = 'landing';
    this.throttle = 0;
    this.entry = 0;
    this.emit('landStart', {});
  }

  startTakeoff() {
    const up = this.pos.clone().normalize();
    this.anim = {
      t: 0,
      dur: 1.6,
      fromPos: this.pos.clone(),
      toPos: this.pos.clone().addScaledVector(up, 16),
      fromQuat: this.quat.clone(),
      toQuat: this.quat.clone(),
      kind: 'takeoff',
    };
    this.state = 'takeoff';
    this.emit('takeoff', {});
  }

  updateAnim(dt) {
    const a = this.anim;
    a.t = Math.min(1, a.t + dt / a.dur);
    const e = smoothstep(0, 1, a.t);
    if (a.kind === 'landing') {
      // glide over the spot first, then settle straight down like a hover landing
      const across = smoothstep(0, 0.7, a.t);
      const down = Math.pow(smoothstep(0.1, 1, a.t), 0.85);
      const r0 = a.fromPos.length();
      const r1 = a.toPos.length();
      _v.copy(a.fromPos).divideScalar(r0).lerp(_v2.copy(a.toPos).divideScalar(r1), across).normalize();
      this.pos.copy(_v).multiplyScalar(lerp(r0, r1, down));
      this.quat.slerpQuaternions(a.fromQuat, a.toQuat, Math.min(1, e * 1.4));
      this.model.setThrust(0.25 * (1 - e), 0);
    } else {
      this.pos.lerpVectors(a.fromPos, a.toPos, e);
      this.model.setThrust(0.5, 0);
    }
    this.vel.set(0, 0, 0);
    this.speed = 0;
    if (a.t >= 1) {
      if (a.kind === 'landing') {
        this.state = 'landed';
        this.emit('landed', {});
      } else {
        this.state = 'flying';
        this.aim.copy(this.quat);
        this.throttle = 0.2;
        this.emit('airborne', {});
      }
      this.anim = null;
    }
  }

  // place the ship landed at a local direction on a planet
  placeLanded(planet, dir, heading) {
    this.frame = planet;
    const h = planet.heightAt(dir);
    const n = surfaceNormal(planet, dir, 2.5);
    const up = dir.clone().lerp(n, 0.6).normalize();
    this.pos.copy(dir).multiplyScalar(planet.radius + Math.max(h, 0)).addScaledVector(up, GEAR_HEIGHT);
    const fwd = (heading || new THREE.Vector3(0, 1, 0)).clone().projectOnPlane(up).normalize();
    if (fwd.lengthSq() < 0.1) fwd.set(1, 0, 0).projectOnPlane(up).normalize();
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), fwd, up);
    this.quat.setFromRotationMatrix(m);
    this.aim.copy(this.quat);
    this.vel.set(0, 0, 0);
    this.state = 'landed';
    this.gear = 1;
    this.throttle = 0;
    this.resetMotion();
  }

  // clears drives and effects, for spawning, loading and warp arrival
  resetMotion() {
    this.pulse = false;
    this.pulseSpool = 0;
    this.pulseSpeed = 0;
    this.boost = 0;
    this.anim = null;
    this.orbit = null;
    this.entry = 0;
    this.heat = 0;
    this.spin = null;
    this.cushion = 0;
    this.queuedPulse = 0;
  }

  updateModel(origin) {
    const wp = this.worldPos(_v);
    this.model.root.position.subVectors(wp, origin);
    this.worldQuat(this.model.root.quaternion);
    // barrel roll is cosmetic, the flight direction never rolls with it
    let roll = this.bank;
    if (this.spin) roll += this.spin.dir * Math.PI * 2 * smoothstep(0, 1, this.spin.t);
    this.model.body.rotation.set(0, 0, roll);
    this.model.setBank(this.bank);
  }
}
