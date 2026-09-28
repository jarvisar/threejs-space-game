import * as THREE from 'three';
import { RNG } from '../core/rng.js';

const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const Y = new THREE.Vector3(0, 1, 0);

// Spin and local frame shared by planets, moons and gas giants. While the
// player is near a body their position lives in its rotating local frame, so
// the ground stays still under them while the sun moves across the sky.
export class Body {
  initBody(def) {
    this.def = def;
    this.radius = def.radius;
    this.position = new THREE.Vector3().fromArray(def.position);
    this.group = new THREE.Group();
    this.group.name = def.name || 'body';
    const rng = new RNG((def.seed ^ 0x51ab) >>> 0);
    this.dayLength = def.kind === 'gas' ? rng.range(500, 900) : rng.range(900, 1600);
    this.spin = (Math.PI * 2) / this.dayLength;
    this.phase0 = rng.range(0, Math.PI * 2);
    const axis = new THREE.Vector3(rng.range(-1, 1), 0, rng.range(-1, 1)).normalize();
    this.tilt = new THREE.Quaternion().setFromAxisAngle(axis, rng.range(0.05, def.kind === 'gas' ? 0.6 : 0.4));
    this.quat = new THREE.Quaternion();
    this.invQuat = new THREE.Quaternion();
    this.rotUniform = { value: new THREE.Matrix3() };
    this.camDist = 1e12;
    this.camLocal = new THREE.Vector3();
    this.updateRotation(0);
  }

  updateRotation(t) {
    _q.setFromAxisAngle(Y, this.phase0 + this.spin * t);
    this.quat.multiplyQuaternions(this.tilt, _q);
    this.invQuat.copy(this.quat).invert();
    this.group.quaternion.copy(this.quat);
    // world to local, for shaders that need planet-fixed coordinates
    this.rotUniform.value.setFromMatrix4(_m.makeRotationFromQuaternion(this.invQuat));
  }

  toLocal(world, out = new THREE.Vector3()) {
    return out.subVectors(world, this.position).applyQuaternion(this.invQuat);
  }

  toWorld(local, out = new THREE.Vector3()) {
    return out.copy(local).applyQuaternion(this.quat).add(this.position);
  }

  dirToLocal(v, out = new THREE.Vector3()) {
    return out.copy(v).applyQuaternion(this.invQuat);
  }

  dirToWorld(v, out = new THREE.Vector3()) {
    return out.copy(v).applyQuaternion(this.quat);
  }

  // velocity of a planet-fixed point, needed when switching frames
  frameVelocity(local, out = new THREE.Vector3()) {
    // omega x r in the local frame is spin around local Y
    out.set(local.z * this.spin, 0, -local.x * this.spin);
    return out.applyQuaternion(this.quat);
  }

  // local direction of the star, used for time of day
  sunDirLocal(out = new THREE.Vector3()) {
    out.copy(this.position).negate().normalize();
    return out.applyQuaternion(this.invQuat);
  }

  updateRender(origin) {
    this.group.position.subVectors(this.position, origin);
  }
}
