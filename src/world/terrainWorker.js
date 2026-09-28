import { TerrainGenerator } from '../gen/terrain.js';
import { buildChunk } from './chunkBuilder.js';
import { buildScatter } from './scatterBuilder.js';

const planets = new Map();

// Jobs always answer, even when they fail. The pool counts replies to know
// which workers are free, so a job that throws would otherwise use up a slot
// for good. planet and drop messages aren't jobs and never answer.
self.onmessage = (e) => {
  const msg = e.data;
  try {
    handle(msg);
  } catch (err) {
    console.error('terrain worker', err);
    if (msg.type === 'chunk' || msg.type === 'scatter') self.postMessage({ id: msg.id, error: String(err) });
  }
};

function handle(msg) {
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
}
