import * as THREE from 'three';
import { LAYER_POST } from './pipeline.js';

const COUNT = 900;
const BOX = 220;

// Specks of dust around the camera that streak with the ship's velocity.
// They are the only thing close enough to show motion in open space.
export class SpaceDust {
  constructor(scene) {
    this.pts = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT * 3; i++) this.pts[i] = (Math.random() * 2 - 1) * BOX;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(COUNT * 6);
    this.col = new Float32Array(COUNT * 6);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.lines = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.lines.frustumCulled = false;
    this.lines.layers.set(LAYER_POST);
    scene.add(this.lines);
    this.last = new THREE.Vector3();
    this.hasLast = false;
  }

  // camWorld: camera world position, vel: world velocity, amount 0..1
  update(camWorld, vel, amount) {
    this.lines.visible = amount > 0.01;
    if (!this.lines.visible) {
      this.hasLast = false;
      return;
    }
    const move = this.hasLast ? camWorld.clone().sub(this.last) : new THREE.Vector3();
    this.last.copy(camWorld);
    this.hasLast = true;
    if (move.length() > BOX) move.set(0, 0, 0);
    const speed = vel.length();
    const streak = Math.min(60, speed * 0.03);
    const sdir = speed > 0.1 ? vel.clone().divideScalar(speed) : new THREE.Vector3();
    const b = 0.5 * amount * Math.min(1, 0.25 + speed / 400);
    const p = this.pts;
    for (let i = 0; i < COUNT; i++) {
      const o = i * 3;
      let x = p[o] - move.x, y = p[o + 1] - move.y, z = p[o + 2] - move.z;
      if (x > BOX) x -= 2 * BOX; else if (x < -BOX) x += 2 * BOX;
      if (y > BOX) y -= 2 * BOX; else if (y < -BOX) y += 2 * BOX;
      if (z > BOX) z -= 2 * BOX; else if (z < -BOX) z += 2 * BOX;
      p[o] = x;
      p[o + 1] = y;
      p[o + 2] = z;
      const w = i * 6;
      this.pos[w] = x;
      this.pos[w + 1] = y;
      this.pos[w + 2] = z;
      this.pos[w + 3] = x - sdir.x * (streak + 0.4);
      this.pos[w + 4] = y - sdir.y * (streak + 0.4);
      this.pos[w + 5] = z - sdir.z * (streak + 0.4);
      // fade specks far from the camera
      const f = b * Math.max(0, 1 - Math.sqrt(x * x + y * y + z * z) / BOX);
      this.col[w] = this.col[w + 1] = this.col[w + 2] = f;
      this.col[w + 3] = this.col[w + 4] = this.col[w + 5] = 0;
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.geometry.attributes.color.needsUpdate = true;
  }
}
