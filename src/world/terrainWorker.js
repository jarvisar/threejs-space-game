import { TerrainGenerator } from '../gen/terrain.js';
import { buildChunk } from './chunkBuilder.js';
import { buildScatter } from './scatterBuilder.js';

const planets = new Map();

self.onmessage = (e) => {
  const msg = e.data;
  switch (msg.type) {
    case 'planet':
      planets.set(msg.id, { gen: new TerrainGenerator(msg.terrain), terrain: msg.terrain });
      break;
    case 'drop':
      planets.delete(msg.id);
      break;
    case 'chunk': {
      const p = planets.get(msg.planetId);
      if (!p) {
        self.postMessage({ id: msg.id, error: 'no planet' });
        return;
      }
      const res = buildChunk(p.gen, p.terrain.radius, msg.face, msg.level, msg.x, msg.y, msg.N);
      res.id = msg.id;
      self.postMessage(res, [res.positions.buffer, res.normals.buffer, res.data.buffer]);
      break;
    }
    case 'scatter': {
      const p = planets.get(msg.planetId);
      if (!p) {
        self.postMessage({ id: msg.id, error: 'no planet' });
        return;
      }
      const { transfer, ...res } = buildScatter(p.gen, p.terrain, msg);
      res.id = msg.id;
      self.postMessage(res, transfer);
      break;
    }
  }
};
