import * as THREE from 'three';
import { floraMaterial } from '../world/scatter.js';
import { faunaMaterial } from '../world/fauna.js';
import { std, makeBeam } from '../world/pois.js';
import { patchStandard } from './materials.js';
import { LAYER_POST } from './pipeline.js';

// One throwaway object per material variant that only shows up mid-game
// (flora, creatures, points of interest, asteroids, particles). Rendering them
// once behind the fade compiles their shaders so the first plant or monolith
// doesn't stall the frame for a hundred milliseconds.
export function buildWarmup() {
  const g = new THREE.Group();
  const box = new THREE.BoxGeometry(0.2, 0.2, 0.2);

  const floraGeo = box.clone();
  const n = floraGeo.attributes.position.count;
  floraGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  floraGeo.setAttribute('aSway', new THREE.BufferAttribute(new Float32Array(n), 1));
  floraGeo.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n), 1));
  for (const kind of ['plant', 'rock', 'crystal']) {
    const m = new THREE.InstancedMesh(floraGeo, floraMaterial(kind, 100), 1);
    m.setColorAt(0, new THREE.Color(1, 1, 1));
    m.castShadow = true;
    g.add(m);
  }

  const faunaGeo = box.clone();
  faunaGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  faunaGeo.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n), 1));
  faunaGeo.setAttribute('aExtra', new THREE.BufferAttribute(new Float32Array(n), 1));
  faunaGeo.setAttribute('aAnim', new THREE.InstancedBufferAttribute(new Float32Array(2), 2));
  const fauna = new THREE.InstancedMesh(faunaGeo, faunaMaterial(), 1);
  fauna.castShadow = true;
  g.add(fauna);

  const poi = new THREE.Mesh(box, std('#ffffff'));
  poi.castShadow = true;
  g.add(poi);
  g.add(new THREE.Mesh(box, std('#ffffff', { flat: true })));
  g.add(new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0xffffff })));
  const beam = makeBeam('#ffffff', 1, 0.1);
  g.add(beam);

  const ast = new THREE.InstancedMesh(box, patchStandard(new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), { key: 'asteroid' }), 1);
  ast.setColorAt(0, new THREE.Color(1, 1, 1));
  g.add(ast);

  const pts = new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3()]), new THREE.PointsMaterial({ size: 0.1, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, map: new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1) }));
  pts.material.map.needsUpdate = true;
  pts.layers.set(LAYER_POST);
  g.add(pts);

  g.traverse((o) => {
    o.frustumCulled = false;
  });
  return g;
}

export function disposeWarmup(g) {
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (o.material.map) o.material.map.dispose();
      o.material.dispose();
    }
  });
}
