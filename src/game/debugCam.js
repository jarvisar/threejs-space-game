import * as THREE from 'three';

// spiral search for a dry spot with some height near dir. Falls back to the
// highest point it sampled so mostly-ocean worlds still get the best island.
export function findLand(body, dir, minH = 4) {
  let best = dir;
  let bestH = body.heightAt(dir);
  if (bestH > minH) return dir;
  const t1 = new THREE.Vector3(0, 1, 0).cross(dir);
  if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0);
  t1.normalize();
  const t2 = dir.clone().cross(t1);
  for (let i = 1; i < 1600; i++) {
    const a = i * 2.399;
    const r = 0.012 * Math.sqrt(i);
    const d = dir.clone().addScaledVector(t1, Math.cos(a) * r).addScaledVector(t2, Math.sin(a) * r).normalize();
    const h = body.heightAt(d);
    if (h > minH) return d;
    if (h > bestH) {
      best = d;
      bestH = h;
    }
  }
  return best;
}

// Free-fly camera used for testing and photo mode.
export class DebugCam {
  constructor(game) {
    this.game = game;
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.speed = 200;
    this.keys = new Set();
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('wheel', (e) => {
      if (!this.active) return;
      this.speed *= e.deltaY > 0 ? 0.8 : 1.25;
      this.speed = Math.min(Math.max(this.speed, 1), 500000);
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.active || document.pointerLockElement === null) return;
      const q = new THREE.Quaternion();
      q.setFromEuler(new THREE.Euler(-e.movementY * 0.002, -e.movementX * 0.002, 0, 'YXZ'));
      this.quat.multiply(q);
    });
    this.active = false;
  }

  update(dt) {
    const k = this.keys;
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
    if (roll) this.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll * dt));
    v.applyQuaternion(this.quat).multiplyScalar(this.speed * dt * (k.has('ShiftLeft') ? 5 : 1));
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
