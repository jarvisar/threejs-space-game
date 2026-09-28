import * as THREE from 'three';
import { patchStandard } from '../render/materials.js';
import { LAYER_POST } from '../render/pipeline.js';

// Procedural explorer ship. Forward is -Z, up is +Y, about 11 m long.

function hullMaterial(color, metal = 0.45, rough = 0.38, key = 'ship') {
  const m = new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough });
  return patchStandard(m, { key });
}

function lathe(points, segs = 24) {
  const pts = points.map(([r, z]) => new THREE.Vector2(r, z));
  const g = new THREE.LatheGeometry(pts, segs);
  // lathe runs along Y, turn it so it runs along Z
  g.rotateX(Math.PI / 2);
  return g;
}

function wingGeometry(span, rootChord, tipChord, sweep, thick) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(span, sweep);
  s.lineTo(span, sweep + tipChord);
  s.lineTo(0, rootChord);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.4, bevelSize: thick * 0.4, bevelSegments: 2 });
  // shape is in XY, lay it flat in XZ with chord along +Z
  g.rotateX(Math.PI / 2);
  g.translate(0, thick / 2, 0);
  return g;
}

const flameVert = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const flameFrag = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uPower;
uniform float uTime;
varying vec3 vPos;
void main() {
  #include <logdepthbuf_fragment>
  // cone runs from z=0 (nozzle) to z=1 (tail) in local space
  float t = clamp(vPos.z, 0.0, 1.0);
  float r = length(vPos.xy) / max(0.001, 1.0 - t * 0.85);
  float core = exp(-r * r * 6.0);
  float flick = 0.85 + 0.15 * sin(uTime * 40.0 + t * 20.0);
  float fall = pow(1.0 - t, 1.6);
  vec3 c = mix(uColor, vec3(1.0), core * (1.0 - t) * 0.8) * core * fall * uPower * flick * 4.0;
  gl_FragColor = vec4(c, 1.0);
}
`;

export function buildShip(colors = {}) {
  const primary = new THREE.Color(colors.primary || '#d8dde6');
  const secondary = new THREE.Color(colors.secondary || '#2b3140');
  const accent = new THREE.Color(colors.accent || '#ff8a3c');
  const glow = new THREE.Color(colors.glow || '#6fd6ff');

  const matHull = hullMaterial(primary, 0.35, 0.4, 'ship-hull');
  const matDark = hullMaterial(secondary, 0.55, 0.45, 'ship-dark');
  const matAccent = hullMaterial(accent, 0.2, 0.5, 'ship-accent');
  const matGlass = new THREE.MeshStandardMaterial({ color: 0x0b1420, metalness: 0.9, roughness: 0.08, emissive: glow.clone().multiplyScalar(0.08) });
  patchStandard(matGlass, { key: 'ship-glass' });
  const matGlow = new THREE.MeshBasicMaterial({ color: glow.clone().multiplyScalar(3.5) });
  const matAccentGlow = new THREE.MeshBasicMaterial({ color: accent.clone().multiplyScalar(2.5) });

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // fuselage, nose toward -Z
  const fus = new THREE.Mesh(
    lathe([
      [0.0, -5.6], [0.35, -5.2], [0.7, -4.3], [1.0, -3.0], [1.15, -1.5], [1.2, 0.0], [1.12, 1.6], [0.95, 3.0], [0.8, 3.9], [0.0, 4.0],
    ], 28),
    matHull
  );
  fus.scale.set(1.0, 0.72, 1.0);
  body.add(fus);

  // dark belly plate
  const belly = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.35, 6.2), matDark);
  belly.position.set(0, -0.62, 0.3);
  body.add(belly);

  // canopy
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.75, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), matGlass);
  canopy.scale.set(0.95, 0.75, 2.1);
  canopy.position.set(0, 0.55, -2.2);
  body.add(canopy);
  const canopyRim = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.05, 6, 32), matDark);
  canopyRim.scale.set(0.95, 2.1, 1);
  canopyRim.rotation.x = Math.PI / 2;
  canopyRim.position.set(0, 0.56, -2.2);
  body.add(canopyRim);

  // spine stripe
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 4.2), matAccent);
  stripe.position.set(0, 0.86, 1.0);
  body.add(stripe);

  // wings
  for (const side of [-1, 1]) {
    // negative scale mirrors the left wing, three flips the winding for us
    const wing = new THREE.Mesh(wingGeometry(4.6, 3.6, 1.3, 2.6, 0.18), matHull);
    wing.scale.x = side;
    wing.position.set(side * 0.9, -0.2, -0.3);
    wing.rotation.z = side * -0.08;
    body.add(wing);
    // dark leading edge
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 5.2), matDark);
    edge.position.set(side * 3.1, -0.05, 0.1);
    edge.rotation.y = side * -0.52;
    body.add(edge);
    // wingtip light strip
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.2), side < 0 ? matAccentGlow : matGlow);
    tip.position.set(side * 5.5, -0.35, 2.9);
    body.add(tip);
    // tail fin
    const fin = new THREE.Mesh(wingGeometry(1.7, 1.9, 0.7, 1.3, 0.12), matDark);
    fin.rotation.z = Math.PI / 2 + side * 0.35;
    fin.position.set(side * 0.55, 0.45, 1.8);
    fin.scale.x = 1;
    body.add(fin);
  }

  // engines
  const nozzles = [];
  for (const side of [-1, 1]) {
    const nac = new THREE.Mesh(
      lathe([[0.0, -1.8], [0.45, -1.5], [0.62, -0.6], [0.66, 0.9], [0.58, 1.6], [0.5, 1.75], [0.0, 1.75]], 20),
      matDark
    );
    nac.position.set(side * 1.45, -0.1, 2.55);
    body.add(nac);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.07, 8, 24), matAccent);
    ring.position.set(side * 1.45, -0.1, 3.9);
    body.add(ring);
    const noz = new THREE.Mesh(new THREE.CircleGeometry(0.44, 24), matGlow);
    noz.position.set(side * 1.45, -0.1, 4.31);
    body.add(noz);
    nozzles.push(new THREE.Vector3(side * 1.45, -0.1, 4.32));
  }

  // landing gear, scaled in on flight
  const gear = new THREE.Group();
  const legPos = [[0, -0.6, -3.2], [-1.35, -0.6, 1.9], [1.35, -0.6, 1.9]];
  for (const [x, y, z] of legPos) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 1.4, 8), matDark);
    leg.position.set(x, y - 0.7, z);
    gear.add(leg);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.12, 12), matDark);
    foot.position.set(x, y - 1.4, z);
    gear.add(foot);
  }
  body.add(gear);

  // engine flames on the post layer so they skip the atmosphere pass
  const flameUniforms = { uColor: { value: glow.clone() }, uPower: { value: 0.3 }, uTime: { value: 0 } };
  const flameMat = new THREE.ShaderMaterial({
    uniforms: flameUniforms,
    vertexShader: flameVert,
    fragmentShader: flameFrag,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const flameGeo = new THREE.CylinderGeometry(0.42, 0.05, 1, 20, 8, true);
  flameGeo.rotateX(-Math.PI / 2);
  flameGeo.translate(0, 0, 0.5);
  const flames = [];
  for (const n of nozzles) {
    const f = new THREE.Mesh(flameGeo, flameMat);
    f.position.copy(n);
    f.layers.set(LAYER_POST);
    f.frustumCulled = false;
    body.add(f);
    flames.push(f);
  }

  // mining lasers under the nose
  const laserUniforms = { uColor: { value: new THREE.Color(1.0, 0.35, 0.15) }, uTime: { value: 0 } };
  const laserMat = new THREE.ShaderMaterial({
    uniforms: laserUniforms,
    vertexShader: laserVert,
    fragmentShader: laserFrag,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const laserGeo = new THREE.CylinderGeometry(0.09, 0.09, 1, 8, 1, true);
  laserGeo.rotateX(-Math.PI / 2);
  laserGeo.translate(0, 0, -0.5);
  const guns = [new THREE.Vector3(-0.55, -0.55, -3.6), new THREE.Vector3(0.55, -0.55, -3.6)];
  const lasers = guns.map((gp) => {
    const m = new THREE.Mesh(laserGeo, laserMat);
    m.position.copy(gp);
    m.layers.set(LAYER_POST);
    m.frustumCulled = false;
    m.visible = false;
    body.add(m);
    return m;
  });

  body.traverse((o) => {
    if (o.isMesh && o.layers.mask === 1) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  return {
    root,
    body,
    gear,
    flames,
    flameUniforms,
    nozzles,
    setGear(t) {
      gear.visible = t > 0.02;
      gear.scale.set(1, Math.max(0.02, t), 1);
      gear.position.y = (1 - t) * 0.8;
    },
    setThrust(power, time) {
      flameUniforms.uPower.value = power;
      flameUniforms.uTime.value = time;
      for (const f of flames) f.scale.set(1, 1, 0.6 + power * 5.5);
    },
    // target is in body space, null turns the lasers off
    setLaser(target, time) {
      laserUniforms.uTime.value = time;
      for (let i = 0; i < lasers.length; i++) {
        const l = lasers[i];
        if (!target) {
          l.visible = false;
          continue;
        }
        l.visible = true;
        const d = target.clone().sub(guns[i]);
        const len = d.length();
        l.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), d.normalize());
        l.scale.set(1, 1, len);
      }
    },
  };
}

const laserVert = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const laserFrag = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uTime;
varying vec3 vPos;
void main() {
  #include <logdepthbuf_fragment>
  float pulse = 0.7 + 0.3 * sin(vPos.z * 40.0 + uTime * 60.0);
  gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.4) * 4.0 * pulse, 1.0);
}
`;
