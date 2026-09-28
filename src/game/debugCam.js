import * as THREE from 'three';
import { findLand } from '../world/planet.js';

const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const Z = new THREE.Vector3(0, 0, 1);

// Free-fly camera used for photo mode and by test scripts through window.__game.
export class DebugCam {
  constructor() {
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.speed = 200;
  }

  // reads raw key state, the game pauses (and disables input) in photo mode
  update(dt, input) {
    const look = input.look();
    if (look.x || look.y) this.quat.multiply(_q.setFromEuler(_e.set(-look.y, -look.x, 0)));
    if (input.wheel) this.speed = Math.min(Math.max(this.speed * (input.wheel > 0 ? 0.8 : 1.25), 1), 500000);
    const k = input.down;
    const v = new THREE.Vector3();
    if (k.has('KeyW')) v.z -= 1;
    if (k.has('KeyS')) v.z += 1;
    if (k.has('KeyA')) v.x -= 1;
    if (k.has('KeyD')) v.x += 1;
    if (k.has('KeyR')) v.y += 1;
    if (k.has('KeyF')) v.y -= 1;
    let roll = 0;
    if (k.has('KeyQ')) roll += 1;
    if (k.has('KeyE')) roll -= 1;
    if (roll) this.quat.multiply(_q.setFromAxisAngle(Z, roll * dt));
    const fast = k.has('ShiftLeft') || k.has('ShiftRight');
    v.applyQuaternion(this.quat).multiplyScalar(this.speed * dt * (fast ? 5 : 1));
    this.pos.add(v);
  }

  // place the camera above a body, looking toward the horizon
  placeAbove(body, alt, lat = 0.3, lon = 0.5, pitch = -0.15) {
    const dir = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
    let ground = body.radius;
    if (body.heightAt) ground = body.floorRadius(dir);
    this.pos.copy(body.position).addScaledVector(dir, ground + alt);
    const up = dir.clone();
    const fwd = new THREE.Vector3(0, 1, 0).projectOnPlane(up).normalize();
    if (fwd.lengthSq() < 0.01) fwd.set(1, 0, 0).projectOnPlane(up).normalize();
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), fwd, up);
    this.quat.setFromRotationMatrix(m);
    this.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch));
  }

  // place on the lit side, sunAngle is the angle between local up and the sun (0 = noon)
  placeDay(body, alt, sunAngle = 0.6, pitch = -0.1, turn = 0, land = false) {
    const sun = body.position.clone().negate().normalize();
    const side = new THREE.Vector3(0, 1, 0).cross(sun).normalize();
    let dir = sun.clone().applyAxisAngle(side, sunAngle).normalize();
    if (land && body.heightAt) dir = findLand(body, dir);
    let ground = body.radius;
    if (body.heightAt) ground = body.floorRadius(dir);
    this.pos.copy(body.position).addScaledVector(dir, ground + alt);
    const up = dir.clone();
    const fwd = sun.clone().projectOnPlane(up).normalize().applyAxisAngle(up, turn);
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), fwd, up);
    this.quat.setFromRotationMatrix(m);
    this.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch));
  }

  lookAt(target) {
    const dir = target.clone().sub(this.pos).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), dir, up);
    this.quat.setFromRotationMatrix(m);
  }
}
