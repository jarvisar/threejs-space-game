import * as THREE from 'three';
import { Planet } from './planet.js';
import { GasGiant } from './gasGiant.js';
import { Star } from './star.js';
import { createRings } from './rings.js';
import { MAX_ATMO_PLANETS } from '../render/shaders/atmosphere.glsl.js';

const _v = new THREE.Vector3();

export class StarSystem {
  constructor(def, pool, scene) {
    this.def = def;
    this.scene = scene;
    this.star = new Star(def.star);
    scene.add(this.star.group);
    this.bodies = def.planets.map((p, i) => {
      const b = p.kind === 'gas' ? new GasGiant(p) : new Planet(p, pool, i);
      if (p.kind === 'rocky' && p.rings) {
        b.rings = createRings(p.rings, b);
        b.group.add(b.rings);
      }
      b.index = i;
      scene.add(b.group);
      return b;
    });
    this.focus = null;
  }

  updateRotations(worldTime) {
    for (const b of this.bodies) b.updateRotation(worldTime);
  }

  update(camWorld, time) {
    this.star.update(time);
    let best = null;
    let bestScore = Infinity;
    for (const b of this.bodies) {
      b.update(camWorld, time);
      const alt = b.camDist - b.radius;
      // weight by size so a big gas giant doesn't steal focus from a nearby moon
      const score = alt / Math.sqrt(b.radius);
      if (score < bestScore) {
        bestScore = score;
        best = b;
      }
    }
    if (this.focus !== best) {
      if (this.focus) this.focus.focus = false;
      this.focus = best;
      if (best) best.focus = true;
    }
  }

  updateRender(origin) {
    this.star.updateRender(origin);
    for (const b of this.bodies) b.updateRender(origin);
  }

  // nearest MAX_ATMO_PLANETS bodies that need the atmosphere pass, drawn far to near
  atmosphereList() {
    const list = this.bodies.filter((b) => b.hasAtmoPass);
    list.sort((a, b) => a.camDist - a.radius - (b.camDist - b.radius));
    const top = list.slice(0, MAX_ATMO_PLANETS);
    top.sort((a, b) => b.camDist - a.camDist);
    return top;
  }

  // body whose rotating frame the player should live in, if any
  frameBodyFor(pos, current) {
    for (const b of this.bodies) {
      const r = soiRadius(b) * (b === current ? 1.1 : 1.0);
      if (_v.subVectors(pos, b.position).lengthSq() < r * r) return b;
    }
    return null;
  }

  dispose() {
    this.scene.remove(this.star.group);
    this.star.dispose();
    for (const b of this.bodies) {
      this.scene.remove(b.group);
      b.dispose();
    }
  }
}

function soiRadius(b) {
  return Math.max(b.atmoRadius * 1.35, b.radius + 2500);
}
