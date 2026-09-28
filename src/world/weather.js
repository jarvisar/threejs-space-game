import * as THREE from 'three';
import { LAYER_POST } from '../render/pipeline.js';
import { radialTexture } from '../render/textures.js';

const COUNT = 2600;
const BOX = 26;

const TYPES = {
  rain: { color: [0.55, 0.65, 0.8], size: 0.06, fall: 16, wind: 3, base: 0, storm: 1, glow: 0.5 },
  snow: { color: [1, 1, 1], size: 0.09, fall: 1.6, wind: 2.5, base: 0.35, storm: 1, glow: 0.5 },
  dust: { color: null, size: 0.07, fall: 0.3, wind: 7, base: 0.2, storm: 1, glow: 0.35 },
  ash: { color: [1.0, 0.45, 0.15], size: 0.07, fall: 0.9, wind: 2, base: 0.45, storm: 1, glow: 1.4 },
  spores: { color: null, size: 0.1, fall: -0.25, wind: 0.8, base: 0.55, storm: 1, glow: 1.6 },
};

let tex = null;
function dot() {
  if (!tex) tex = radialTexture(32, [[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]);
  return tex;
}

// Particles in a box around the camera, stored relative to the camera in the
// planet's frame so they stay put in the world while the camera moves.
export class Weather {
  constructor() {
    this.planet = null;
    this.points = null;
    this.last = new THREE.Vector3();
    this.hasLast = false;
    this.windDir = new THREE.Vector3(1, 0, 0);
  }

  setPlanet(planet) {
    if (this.points) {
      this.points.parent && this.points.parent.remove(this.points);
      this.points.geometry.dispose();
      this.points.material.dispose();
      this.points = null;
    }
    this.planet = planet;
    this.hasLast = false;
    if (!planet || !planet.def.weather) return;
    const type = TYPES[planet.def.weather];
    if (!type) return;
    this.type = type;
    const pos = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT * 3; i++) pos[i] = (Math.random() * 2 - 1) * BOX;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const col = type.color ? new THREE.Color(...type.color) : new THREE.Color(planet.def.weather === 'spores' ? planet.def.palette.glow : planet.def.palette.sand);
    const mat = new THREE.PointsMaterial({
      map: dot(),
      color: col.multiplyScalar(type.glow),
      size: type.size,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.layers.set(LAYER_POST);
    this.points.frustumCulled = false;
    planet.group.add(this.points);
    const a = (planet.def.seed % 628) / 100;
    this.windDir.set(Math.cos(a), 0, Math.sin(a));
  }

  update(dt, planet, camLocal, storm) {
    if (planet !== this.planet) this.setPlanet(planet);
    if (!this.points) return;
    if (!camLocal) {
      this.points.visible = false;
      this.hasLast = false;
      return;
    }
    const t = this.type;
    const amount = Math.min(1, t.base + storm * t.storm);
    this.points.visible = amount > 0.01;
    this.points.geometry.setDrawRange(0, Math.floor(COUNT * amount));
    const up = camLocal.clone().normalize();
    const wind = this.windDir.clone().projectOnPlane(up).normalize().multiplyScalar(t.wind * (1 + storm * 2));
    const move = new THREE.Vector3();
    if (this.hasLast) move.subVectors(camLocal, this.last);
    if (move.lengthSq() > BOX * BOX) move.set(0, 0, 0);
    this.last.copy(camLocal);
    this.hasLast = true;
    const fall = up.clone().multiplyScalar(-t.fall * (1 + storm));
    const v = wind.add(fall).multiplyScalar(dt);
    const arr = this.points.geometry.attributes.position.array;
    const n = Math.floor(COUNT * amount);
    const time = performance.now() * 0.001;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      let x = arr[o] + v.x - move.x;
      let y = arr[o + 1] + v.y - move.y;
      let z = arr[o + 2] + v.z - move.z;
      if (t === TYPES.spores) {
        x += Math.sin(time * 0.7 + i) * dt * 0.3;
        z += Math.cos(time * 0.6 + i * 1.3) * dt * 0.3;
      }
      if (x > BOX) x -= 2 * BOX;
      else if (x < -BOX) x += 2 * BOX;
      if (y > BOX) y -= 2 * BOX;
      else if (y < -BOX) y += 2 * BOX;
      if (z > BOX) z -= 2 * BOX;
      else if (z < -BOX) z += 2 * BOX;
      arr[o] = x;
      arr[o + 1] = y;
      arr[o + 2] = z;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.position.copy(camLocal);
  }
}
