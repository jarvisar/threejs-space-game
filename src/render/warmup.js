import * as THREE from 'three';
import { floraMaterial } from '../world/scatter.js';
import { faunaMaterial } from '../world/fauna.js';
import { std, makeBeam } from '../world/pois.js';
import { patchStandard } from './materials.js';
import { LAYER_POST } from './pipeline.js';
import { cloudMaterial } from '../world/clouds.js';
import { tailMaterial } from '../world/comet.js';
import { meteorMaterial } from '../world/meteors.js';

// One stand-in object per material variant that only shows up mid-game
// (flora, creatures, points of interest, asteroids, particles). Compiling them
// ahead of time means the first plant or monolith doesn't stall the frame for
// a hundred milliseconds. The group is never drawn.
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
  // geyser steam puffs
  g.add(new THREE.InstancedMesh(box, std('#ffffff', { flat: true }), 1));
  g.add(new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0xffffff })));
  const beam = makeBeam('#ffffff', 1, 0.1);
  g.add(beam);

  const ast = new THREE.InstancedMesh(box, patchStandard(new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), { key: 'asteroid' }), 1);
  ast.setColorAt(0, new THREE.Color(1, 1, 1));
  g.add(ast);

  // cloud puffs: instanced, with their per-instance appear value
  const cloudGeo = box.clone();
  cloudGeo.setAttribute('aAppear', new THREE.InstancedBufferAttribute(new Float32Array(1), 1));
  const u = () => ({ value: new THREE.Vector3() });
  g.add(new THREE.InstancedMesh(cloudGeo, cloudMaterial(new THREE.Color(1, 1, 1), { center: u(), radius: { value: 1 }, sky: { value: new THREE.Color() }, ground: { value: new THREE.Color() } }, { value: 0.5 }, { value: 1 }), 1));
  // comet tails, and shooting stars which sit hidden until night
  g.add(new THREE.Mesh(box, tailMaterial(new THREE.Color(1, 1, 1), 0)));
  const meteorGeo = box.clone();
  meteorGeo.setAttribute('aFade', new THREE.BufferAttribute(new Float32Array(meteorGeo.attributes.position.count), 1));
  const meteor = new THREE.Mesh(meteorGeo, meteorMaterial({ uK: { value: 0 }, uColor: { value: new THREE.Color() } }));
  meteor.layers.set(LAYER_POST);
  g.add(meteor);

  const pts = new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3()]), new THREE.PointsMaterial({ size: 0.1, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, map: new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1) }));
  pts.material.map.needsUpdate = true;
  pts.layers.set(LAYER_POST);
  g.add(pts);

  g.traverse((o) => {
    o.frustumCulled = false;
  });
  return g;
}

const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const noLights = new THREE.Scene();
// Same attributes as FullScreenQuad's triangle. Which attributes a geometry
// has is part of three's program key, a normal attribute here would compile
// a program the passes never use.
const quadGeo = new THREE.BufferGeometry();
quadGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
quadGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
// terrain chunks have normals
const meshGeo = new THREE.BoxGeometry(1, 1, 1);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

export async function afterFrames(n) {
  for (let i = 0; i < n; i++) await nextFrame();
}

// Post pass materials hanging off the pipeline (bloom, AO, DOF and whatever
// gets added later). They're found by walking the object instead of listed by
// hand so new passes get warmed up too.
function passMaterials(root, skip) {
  const found = new Set();
  const seen = new Set();
  const visit = (o, depth) => {
    if (!o || typeof o !== 'object' || seen.has(o) || depth > 4) return;
    seen.add(o);
    if (o.isMaterial) {
      if (!skip.has(o)) found.add(o);
      return;
    }
    if (o.isObject3D) {
      if (o.material?.isMaterial && !skip.has(o.material)) found.add(o.material);
      return;
    }
    if (o.isTexture || o.isBufferGeometry || o.isRenderTarget || o.isWebGLRenderer || ArrayBuffer.isView(o) || o.nodeType) return;
    for (const v of Array.isArray(o) ? o : Object.values(o)) visit(v, depth + 1);
  };
  visit(root, 0);
  return found;
}

function quads(materials) {
  const g = new THREE.Group();
  for (const m of materials) g.add(new THREE.Mesh(quadGeo, m));
  return g;
}

// Starts compiling every program the current view needs. With
// KHR_parallel_shader_compile this returns right away and the GPU process
// compiles in the background. Returns the materials to wait on.
//
// Program keys depend on the render target and the lights, so each group is
// compiled the way it's actually drawn: the scene into the HDR target with its
// lights, FullScreenQuad passes without lights, and only the final pass to the
// canvas. A mismatch doesn't break anything, it just compiles a program that
// never gets used and the real one still stalls the first frame.
export function compileView(game, extra) {
  const { renderer: r, scene, camera, pipeline } = game;
  const all = new Set();
  const add = (set) => set.forEach((m) => all.add(m));
  const inScene = new Set();
  scene.traverse((o) => {
    if (Array.isArray(o.material)) o.material.forEach((m) => inScene.add(m));
    else if (o.material) inScene.add(o.material);
  });
  // a planet's terrain material isn't on a mesh until its first chunk arrives
  const proxies = new THREE.Group();
  for (const b of game.system?.bodies || []) {
    if (b.material?.isMaterial && !inScene.has(b.material)) proxies.add(new THREE.Mesh(meshGeo, b.material));
  }
  const screen = pipeline.finalQuad?.material;
  const passes = passMaterials(pipeline, inScene);
  passes.delete(screen);

  const prev = r.getRenderTarget();
  r.setRenderTarget(pipeline.rtScene);
  add(r.compile(scene, camera));
  if (proxies.children.length) add(r.compile(proxies, camera, scene));
  if (extra) add(r.compile(extra, camera, scene));
  add(r.compile(quads(passes), quadCam, noLights));
  r.setRenderTarget(null);
  if (screen) add(r.compile(quads([screen]), quadCam, noLights));
  r.setRenderTarget(prev);
  return all;
}

// Resolves once every material's program has linked. Without the parallel
// compile extension there's no way to ask without blocking, so it links one
// program per frame instead, which at least lets the loading bar move.
export async function waitForPrograms(renderer, materials, onProgress) {
  const programs = new Set();
  for (const m of materials) {
    const p = renderer.properties.get(m).currentProgram;
    if (p) programs.add(p);
  }
  const total = programs.size;
  const parallel = renderer.extensions.has('KHR_parallel_shader_compile');
  const start = performance.now();
  while (programs.size) {
    for (const p of programs) {
      if (parallel && !p.isReady()) continue;
      // fetching the uniforms is the part that blocks on the link, do it here
      // instead of in the first real frame
      p.getUniforms();
      programs.delete(p);
      if (!parallel) break;
    }
    onProgress?.(total ? 1 - programs.size / total : 1);
    // a driver that never reports completion shouldn't keep the game from starting
    if (performance.now() - start > 30000) break;
    await nextFrame();
  }
}

// Priority of the pool jobs that still matter. Chunks and scatter both use a
// rough meters-away scale, 150 covers the ground and plants around the camera
// and leaves the far LOD levels to stream in while playing.
const NEAR = 150;

function nearJobs(pool) {
  let n = 0;
  for (const j of pool.queue) if (!j.cancelled && j.priority < NEAR) n++;
  for (const j of pool.pending.values()) if (!j.cancelled && j.priority < NEAR) n++;
  return n;
}

// Waits until the terrain and scatter jobs near the camera are done. The LOD
// only asks for the next level once the previous one arrived, so the queue can
// be empty for a frame between levels. It has to stay empty for a few frames.
export async function waitForTerrain(pool, onProgress, maxMs = 8000) {
  const start = performance.now();
  let quiet = 0;
  let most = 1;
  while (quiet < 4 && performance.now() - start < maxMs) {
    await nextFrame();
    const n = nearJobs(pool);
    most = Math.max(most, n);
    quiet = n === 0 ? quiet + 1 : 0;
    onProgress?.(1 - n / most);
  }
}

// Everything the current view needs before it can be shown without hitching:
// shaders compiled and the ground around the camera built. The game loop has
// to be running (with holdRender set) so the LOD keeps requesting chunks.
// onProgress gets 0..1 and a label.
export async function prepareView(game, { extra, onProgress, terrainMs } = {}) {
  const report = onProgress || (() => {});
  report(0, 'Compiling shaders');
  // one tick first so things that are created on the first update exist
  await nextFrame();
  const materials = compileView(game, extra);
  let compiled = false;
  const shaders = waitForPrograms(game.renderer, materials, (p) => report(p * 0.75, 'Compiling shaders')).then(() => (compiled = true));
  // the terrain workers run at the same time, it only shows once shaders are done
  const ground = waitForTerrain(game.pool, (p) => compiled && report(0.75 + p * 0.25, 'Building terrain'), terrainMs);
  await shaders;
  await ground;
  report(1, 'Building terrain');
}
