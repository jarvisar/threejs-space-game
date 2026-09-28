import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChunk, CHUNK_N, perimeterIndices } from '../src/world/chunkBuilder.js';
import { faceDir, TerrainGenerator } from '../src/gen/terrain.js';
import { makeRockyPlanet } from '../src/gen/system.js';

const R = 6000;
const level = 7;
const N = CHUNK_N;
const field = {
  sample(x, y, z, out) {
    out.h = 12 * Math.sin(x * 90) + 7 * Math.cos(y * 60) + 4 * Math.sin(z * 80);
    out.m = 0.5;
    out.f = 0;
    return out.h;
  },
};
const world = (chunk, i) => chunk.center.map((v, axis) => v + chunk.positions[i * 3 + axis]);
const near = (a, b, epsilon = 0.0001) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < epsilon, `${v} != ${b[i]}`));

test('neighboring chunks share their borders and shading normals on all six faces', () => {
  for (let face = 0; face < 6; face++) {
    const a = buildChunk(field, R, face, level, 47, 51, N);
    const right = buildChunk(field, R, face, level, 48, 51, N);
    const top = buildChunk(field, R, face, level, 47, 52, N);
    for (let k = 0; k < N; k++) {
      for (const [b, i, j] of [[right, k * N + N - 1, k * N], [top, (N - 1) * N + k, k]]) {
        near(world(a, i), world(b, j));
        near(a.normals.subarray(i * 3, i * 3 + 3), b.normals.subarray(j * 3, j * 3 + 3), 1e-6);
      }
    }
  }
});

test('border vertices stay on the regular LOD grid and interiors sample the collision field', () => {
  const face = 2, x = 47, y = 51;
  const chunk = buildChunk(field, R, face, level, x, y, N);
  assert.deepEqual(chunk.positions, buildChunk(field, R, face, level, x, y, N).positions);
  const size = 2 / (1 << level), step = size / (N - 1);
  for (const i of perimeterIndices(N)) {
    const d = faceDir(face, -1 + x * size + (i % N) * step, -1 + y * size + Math.floor(i / N) * step, []);
    const h = field.sample(...d, {});
    near(world(chunk, i), d.map(v => v * (R + h)));
  }
  let moved = 0;
  for (let i = 0; i < N * N; i++) {
    const p = world(chunk, i), r = Math.hypot(...p), d = p.map(v => v / r);
    assert.ok(Math.abs(r - R - field.sample(...d, {})) < 0.0001);
    const u = Math.atan(d[0] / d[1]) * 4 / Math.PI;
    const v = Math.atan(-d[2] / d[1]) * 4 / Math.PI;
    const du = (u - (-1 + x * size + (i % N) * step)) / step;
    const dv = (v - (-1 + y * size + Math.floor(i / N) * step)) / step;
    assert.ok(Math.abs(du) <= 0.241 && Math.abs(dv) <= 0.241);
    if (Math.abs(du) + Math.abs(dv) > 0.01) moved++;
  }
  assert.ok(moved > (N - 2) ** 2 * 0.9);
});

test('biome chunks have finite attributes, outward faces and the same triangle budget', () => {
  for (const type of ['lush', 'ocean', 'desert', 'frozen', 'volcanic', 'toxic', 'radioactive', 'barren', 'dead', 'exotic']) {
    const gen = new TerrainGenerator(makeRockyPlanet(4242, type, R).terrain);
    for (const lod of [0, 4, 7, 9]) {
      const count = 1 << lod;
      const chunk = buildChunk(gen, R, 4, lod, Math.floor(count * 0.4), Math.floor(count * 0.6), N);
      assert.equal(chunk.index.length, ((N - 1) ** 2 * 2 + (N - 1) * 8) * 3);
      for (const a of [chunk.positions, chunk.normals, chunk.data]) assert.ok(a.every(Number.isFinite), `${type} LOD ${lod}`);
      assert.ok(chunk.index.every(i => i < chunk.positions.length / 3));
      const p = chunk.positions;
      for (let i = 0; i < (N - 1) ** 2 * 6; i += 3) {
        const a = chunk.index[i] * 3, b = chunk.index[i + 1] * 3, c = chunk.index[i + 2] * 3;
        const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
        const v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
        const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        assert.ok(normal.reduce((sum, n, axis) => sum + n * (chunk.center[axis] + p[a + axis]), 0) > 0, `${type} LOD ${lod} triangle ${i / 3}`);
      }
    }
  }
});
