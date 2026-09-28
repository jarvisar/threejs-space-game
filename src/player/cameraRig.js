import * as THREE from 'three';
import { Planet } from '../world/planet.js';
import { smoothstep } from '../core/math.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);

// Works out where the camera is in the controlled entity's frame, then turns
// that into a world transform for the floating origin.
export class CameraRig {
  constructor() {
    this.frame = null;
    this.localPos = new THREE.Vector3();
    this.localQuat = new THREE.Quaternion();
    this.worldPos = new THREE.Vector3();
    this.worldQuat = new THREE.Quaternion();
    this.offset = new THREE.Vector3(0, 4, 16);
    this.smoothOffset = new THREE.Vector3(0, 4, 16);
    this.orbitYaw = 0;
    this.orbitPitch = -0.25;
    this.orbitDist = 18;
    this.lookYaw = 0;
    this.orbitZoom = 1;
    this.lookPitch = 0;
    this.fov = 70;
    this.shakeAmt = 0;
    this.transition = null;
    this.zoom = 1;
  }

  shake(amount) {
    this.shakeAmt = Math.min(1.5, this.shakeAmt + amount);
  }

  beginTransition(dur = 0.7) {
    this.transition = { t: 0, dur, pos: this.localPos.clone(), quat: this.localQuat.clone(), frame: this.frame };
  }

  followShip(ship, dt, input) {
    this.frame = ship.frame;
    if (ship.orbit) {
      this.followOrbit(ship, dt, input);
    } else if (ship.state === 'flying' || ship.state === 'takeoff') {
      // right mouse swings the camera around the ship, it eases back on release
      if (ship.freeLook && input && input.enabled) {
        const look = input.look();
        this.lookYaw -= look.x;
        this.lookPitch = Math.max(-1.2, Math.min(1.0, this.lookPitch - look.y));
      } else {
        const k = Math.exp(-dt * 4);
        this.lookYaw *= k;
        this.lookPitch *= k;
      }
      const view = _q2.copy(ship.aim);
      if (Math.abs(this.lookYaw) + Math.abs(this.lookPitch) > 1e-4) {
        view.multiply(_q.setFromAxisAngle(Y, this.lookYaw)).multiply(_q.setFromAxisAngle(X, this.lookPitch));
      }
      const speedK = Math.min(1, ship.speed / 400);
      // boost drops the camera back a little, like it can't keep up
      const target = _v.set(0, 3.6 + speedK * 0.6, 15 + speedK * 3.5 + ship.boost * 2.5).multiplyScalar(this.zoom).applyQuaternion(view);
      this.smoothOffset.lerp(target, 1 - Math.exp(-dt * 10));
      this.localPos.copy(ship.pos).add(this.smoothOffset);
      // look slightly above the ship so it sits low in frame
      _q.copy(view).multiply(_q3.setFromAxisAngle(X, -0.06));
      this.localQuat.slerp(_q, 1 - Math.exp(-dt * 14));
      this.orbitYaw = 0;
      this.orbitPitch = -0.28;
      const pulseK = ship.pulse ? ship.pulseSpool : 0;
      this.fov = 68 + ship.boost * 9 + pulseK * 22 + ship.heat * 6;
    } else {
      // landed or landing: free orbit around the ship
      if (input && input.enabled) {
        const look = input.look();
        this.orbitYaw -= look.x;
        this.orbitPitch = Math.max(-1.2, Math.min(0.5, this.orbitPitch - look.y));
      }
      const up = _v.copy(ship.pos).normalize();
      const base = new THREE.Quaternion().copy(ship.quat);
      const q = base.clone().multiply(new THREE.Quaternion().setFromAxisAngle(Y, this.orbitYaw)).multiply(new THREE.Quaternion().setFromAxisAngle(X, this.orbitPitch));
      const off = new THREE.Vector3(0, 0, this.orbitDist * this.zoom).applyQuaternion(q);
      const target = ship.pos.clone().add(off).addScaledVector(up, 1.5);
      this.localPos.lerp(target, 1 - Math.exp(-dt * 8));
      const m = new THREE.Matrix4().lookAt(this.localPos, ship.pos.clone().addScaledVector(up, 1.2), up);
      _q.setFromRotationMatrix(m);
      this.localQuat.slerp(_q, 1 - Math.exp(-dt * 10));
      this.smoothOffset.copy(this.localPos).sub(ship.pos);
      this.fov = 68;
    }
    this.keepAboveGround(1.2);
    this.finish(dt);
  }

  // Slow cinematic view while orbiting. The mouse swings it around the ship,
  // and it's based on the orbit's own axes so a retrograde flip doesn't spin it.
  followOrbit(ship, dt, input) {
    if (input && input.enabled) {
      const look = input.look();
      this.orbitYaw -= look.x;
      this.orbitPitch = Math.max(-1.3, Math.min(1.1, this.orbitPitch - look.y));
    }
    const up = _v2.copy(ship.pos).normalize();
    const q = _q2.copy(ship.orbit.view).multiply(_q.setFromAxisAngle(Y, this.orbitYaw)).multiply(_q3.setFromAxisAngle(X, this.orbitPitch));
    const off = _v.set(0, 0, 30 * this.orbitZoom).applyQuaternion(q).addScaledVector(up, 2);
    // offset relative to the ship, the ship itself moves a few hundred m/s
    this.smoothOffset.lerp(off, 1 - Math.exp(-dt * 3));
    this.localPos.copy(ship.pos).add(this.smoothOffset);
    // zoomed far out the view swings over to the planet so the whole orbit fits
    const k = smoothstep(500, 8000, this.smoothOffset.length());
    const look = _v.copy(ship.pos).addScaledVector(up, 1.5).multiplyScalar(1 - k);
    const m = _m.lookAt(this.localPos, look, up);
    _q.setFromRotationMatrix(m);
    this.localQuat.slerp(_q, 1 - Math.exp(-dt * 8));
    this.fov = 60;
  }

  followWalker(walker, dt) {
    this.frame = walker.frame;
    walker.eye(this.localPos);
    walker.viewQuat(this.localQuat);
    this.fov = 74 + (walker.sprinting ? 6 : 0);
    this.finish(dt);
  }

  // cinematic orbit around a body, used by the title screen
  orbitBody(body, dt, time, dist, height) {
    this.frame = null;
    const a = time * 0.02;
    const p = new THREE.Vector3(Math.cos(a) * dist, height, Math.sin(a) * dist).add(body.position);
    this.localPos.copy(p);
    const m = new THREE.Matrix4().lookAt(p, body.position.clone().add(new THREE.Vector3(0, body.radius * 0.35, 0)), Y);
    this.localQuat.setFromRotationMatrix(m);
    this.fov = 55;
    this.finish(dt);
  }

  keepAboveGround(min) {
    if (!(this.frame instanceof Planet)) return;
    const r = this.localPos.length();
    _v.copy(this.localPos).divideScalar(r);
    const floor = this.frame.floorRadius(_v);
    if (r < floor + min) this.localPos.copy(_v).multiplyScalar(floor + min);
  }

  finish(dt) {
    let pos = this.localPos;
    let quat = this.localQuat;
    if (this.transition) {
      const t = this.transition;
      t.t = Math.min(1, t.t + dt / t.dur);
      const e = t.t * t.t * (3 - 2 * t.t);
      if (t.frame === this.frame) {
        pos = t.pos.clone().lerp(this.localPos, e);
        quat = t.quat.clone().slerp(this.localQuat, e);
      }
      if (t.t >= 1) this.transition = null;
    }
    if (this.frame) {
      this.frame.toWorld(pos, this.worldPos);
      this.worldQuat.multiplyQuaternions(this.frame.quat, quat);
    } else {
      this.worldPos.copy(pos);
      this.worldQuat.copy(quat);
    }
    if (this.shakeAmt > 0.001) {
      const s = this.shakeAmt * 0.02;
      _q.setFromEuler(new THREE.Euler((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
      this.worldQuat.multiply(_q);
      this.shakeAmt *= Math.exp(-dt * 5);
    }
  }
}
