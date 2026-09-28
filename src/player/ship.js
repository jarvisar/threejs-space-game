import * as THREE from 'three';
import { buildShip } from './shipModel.js';
import { Planet, surfaceNormal } from '../world/planet.js';
import { smoothstep, lerp } from '../core/math.js';

const GEAR_HEIGHT = 2.05;
const CLEARANCE = 2.4;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

// Arcade flight model with mouse aim. The camera follows `aim`, the hull turns
// toward it at a limited rate. All state is in the current frame, either the
// system frame (frame = null) or a body's rotating frame.
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
    this.measure();
    if (this.state === 'landing' || this.state === 'takeoff') {
      this.updateAnim(dt);
    } else if (this.state === 'flying') {
      this.updateFlight(dt, input, ctx);
    }
    const g = this.state === 'flying' ? 0 : 1;
    this.gear += (g - this.gear) * Math.min(1, dt * 3);
    this.model.setGear(this.gear);
  }

  updateFlight(dt, input, ctx) {
    const st = this.stats;

    // aim from the mouse, in the aim's own axes
    if (input.enabled) {
      const look = input.look();
      const turnScale = this.pulse ? 0.45 : 1;
      this.aim.multiply(_q.setFromAxisAngle(Y, -look.x * turnScale));
      this.aim.multiply(_q.setFromAxisAngle(X, -look.y * turnScale));
      const roll = input.axis('KeyD', 'KeyA');
      if (roll) this.aim.multiply(_q.setFromAxisAngle(Z, roll * 1.9 * dt));
      // auto level against the horizon when low
      if (this.frame && !roll && this.inAtmo > 0.05) {
        const fwd = _v.set(0, 0, -1).applyQuaternion(this.aim);
        const up = _v2.set(0, 1, 0).applyQuaternion(this.aim);
        const wUp = this.pos.clone().normalize();
        const proj = wUp.addScaledVector(fwd, -wUp.dot(fwd));
        if (proj.lengthSq() > 0.02) {
          proj.normalize();
          const angle = Math.atan2(up.clone().cross(proj).dot(fwd), up.dot(proj));
          const k = (1 - Math.exp(-dt * 2.2)) * this.inAtmo;
          this.aim.premultiply(_q.setFromAxisAngle(fwd, angle * k));
        }
      }
    }
    this.aim.normalize();
    // keep the aim within reach of the nose so the camera can't run away
    const lead = this.quat.angleTo(this.aim);
    const maxLead = 0.7;
    if (lead > maxLead) this.aim.copy(this.quat).rotateTowards(this.aim.clone(), maxLead);

    // hull follows the aim
    const ang = this.quat.angleTo(this.aim);
    const turn = st.turn * (this.pulse ? 0.5 : 1);
    const step = Math.min(ang * (1 - Math.exp(-dt * 5)), turn * dt);
    const before = this.forward(new THREE.Vector3());
    this.quat.rotateTowards(this.aim, step);
    const after = this.forward(new THREE.Vector3());
    // cosmetic bank from the turn rate
    const yawRate = before.clone().cross(after).dot(_v.set(0, 1, 0).applyQuaternion(this.quat)) / Math.max(dt, 1e-4);
    this.bank += (Math.max(-0.7, Math.min(0.7, -yawRate * 0.5)) - this.bank) * Math.min(1, dt * 4);

    // throttle
    if (input.key('KeyW')) this.throttle = Math.min(1, this.throttle + dt * 0.8);
    if (input.key('KeyS')) this.throttle = Math.max(-0.15, this.throttle - dt * 1.0);

    // boost uses a small energy pool
    const wantsBoost = input.key('ShiftLeft') || input.key('ShiftRight');
    if (wantsBoost && this.energy > 0.02 && !this.pulse) {
      this.boost = Math.min(1, this.boost + dt * 3);
      this.energy = Math.max(0, this.energy - dt * 0.18);
    } else {
      this.boost = Math.max(0, this.boost - dt * 2);
      this.energy = Math.min(1, this.energy + dt * 0.1);
    }

    // pulse drive
    const clearSpace = ctx.clearance > 1500;
    if (input.hit('Space')) {
      if (this.pulse) this.dropPulse('manual');
      else if (!clearSpace) this.emit('pulseBlocked', {});
      else if (this.throttle < 0) this.emit('pulseBlocked', {});
      else {
        this.pulse = true;
        this.pulseSpool = 0;
        this.pulseSpeed = Math.max(this.speed, 200);
        this.emit('pulseStart', {});
      }
    }
    if (this.pulse && (ctx.clearance < 600 || input.key('KeyS'))) this.dropPulse(ctx.clearance < 600 ? 'proximity' : 'brake');

    const fwd = this.forward(_v);
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
      const target = this.throttle * base + this.boost * (boostSpeed - base * Math.max(0, this.throttle));
      const desired = _v2.copy(fwd).multiplyScalar(target);
      // faster response when slowing down so the ship doesn't float past things
      const k = 1 - Math.exp(-dt * (this.vel.lengthSq() > desired.lengthSq() ? 1.6 : 1.1));
      this.vel.lerp(desired, k);
    }

    this.pos.addScaledVector(this.vel, dt);
    this.speed = this.vel.length();

    if (this.frame) this.collide(dt);
    this.model.setThrust(0.12 + Math.max(0, this.throttle) * 0.45 + this.boost * 0.7 + (this.pulse ? 0.9 : 0), ctx.time);
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

  // returns null or a reason string
  canLand() {
    if (!(this.frame instanceof Planet)) return 'space';
    if (this.altitude > 70) return 'high';
    if (this.speed > 60) return 'fast';
    return null;
  }

  startLanding() {
    const planet = this.frame;
    const dir = this.pos.clone().normalize();
    const h = planet.heightAt(dir);
    if (planet.seaLevel !== null && h < 0.4) return 'water';
    const n = surfaceNormal(planet, dir, 2.5);
    if (n.dot(dir) < Math.cos(0.5)) return 'steep';
    const up = dir.clone().lerp(n, 0.6).normalize();
    const toPos = dir.clone().multiplyScalar(planet.radius + h).addScaledVector(up, GEAR_HEIGHT);
    const fwd = this.forward(new THREE.Vector3()).projectOnPlane(up).normalize();
    if (fwd.lengthSq() < 0.1) fwd.set(1, 0, 0).projectOnPlane(up).normalize();
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), fwd, up);
    const toQuat = new THREE.Quaternion().setFromRotationMatrix(m);
    this.anim = {
      t: 0,
      dur: 2.4,
      fromPos: this.pos.clone(),
      toPos,
      fromQuat: this.quat.clone(),
      toQuat,
      kind: 'landing',
    };
    this.pulse = false;
    this.state = 'landing';
    this.throttle = 0;
    this.emit('landStart', {});
    return null;
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
      // come down steeply at the end like a hover landing
      const k = Math.pow(e, 0.8);
      this.pos.lerpVectors(a.fromPos, a.toPos, k);
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
    this.pulse = false;
    this.pulseSpool = 0;
    this.pulseSpeed = 0;
    this.boost = 0;
    this.anim = null;
  }

  updateModel(origin) {
    const wp = this.worldPos(_v);
    this.model.root.position.subVectors(wp, origin);
    this.worldQuat(this.model.root.quaternion);
    this.model.body.rotation.set(0, 0, this.bank);
  }
}
