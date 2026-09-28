import * as THREE from 'three';
import { LAYER_POST } from './pipeline.js';

let dotTex = null;
function dotTexture() {
  if (dotTex) return dotTex;
  const s = 32;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}

// Short-lived particle bursts. Each burst is parented to a planet group so it
// rides along with the planet's rotation.
export class Effects {
  constructor() {
    this.bursts = [];
  }

  // planet is anything with a .group, localPos is in that group's space
  burst(planet, localPos, color, size = 1, count = 36, gravity = true) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const vel = [];
    const up = gravity ? localPos.clone().normalize() : new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 5 * size);
      if (gravity) v.addScaledVector(up, 2 + Math.random() * 3);
      vel.push(v);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      map: dotTexture(),
      color: new THREE.Color(color).multiplyScalar(2.2),
      size: gravity ? 0.07 + 0.03 * size : 0.5 * size,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.position.copy(localPos);
    pts.layers.set(LAYER_POST);
    pts.frustumCulled = false;
    planet.group.add(pts);
    this.bursts.push({ pts, vel, up, t: 0, life: 1.1, planet });
  }

  update(dt) {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.t += dt;
      const arr = b.pts.geometry.attributes.position.array;
      for (let k = 0; k < b.vel.length; k++) {
        const v = b.vel[k];
        v.addScaledVector(b.up, -9 * dt);
        v.multiplyScalar(1 - dt * 1.5);
        arr[k * 3] += v.x * dt;
        arr[k * 3 + 1] += v.y * dt;
        arr[k * 3 + 2] += v.z * dt;
      }
      b.pts.geometry.attributes.position.needsUpdate = true;
      b.pts.material.opacity = Math.max(0, 1 - b.t / b.life);
      if (b.t >= b.life) {
        b.planet.group.remove(b.pts);
        b.pts.geometry.dispose();
        b.pts.material.dispose();
        this.bursts.splice(i, 1);
      }
    }
  }

  clear() {
    for (const b of this.bursts) {
      b.planet.group.remove(b.pts);
      b.pts.geometry.dispose();
      b.pts.material.dispose();
    }
    this.bursts.length = 0;
  }
}
