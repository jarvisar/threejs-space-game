// Multi jump route between two stars. Every hop has to be within range and
// land on a star class the drive can hold. A* on jump count, ties broken by
// total distance so routes don't zig zag. Returns the list of stars from
// `from` to `to`, or null if there's no route. Stars cut off from the rest
// can take a long search to rule out, so it gives up after budgetMs.
export function planRoute(galaxy, from, to, range, classes, budgetMs = 40) {
  const t0 = performance.now();
  if (from === to) return [from];
  if (!classes.includes(galaxy.classOf(to))) return null;
  const n = galaxy.count;
  const g = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const P = galaxy.positions;
  const [tx, ty, tz] = galaxy.pos(to);
  const toGoal = (i) => Math.hypot(P[i * 3] - tx, P[i * 3 + 1] - ty, P[i * 3 + 2] - tz);
  // cost is jumps + a small share of distance, the heuristic is the fewest
  // jumps that could still cover the gap, so it never overestimates
  const DIST_W = 1e-4;
  const h = (i) => Math.ceil(toGoal(i) / range - 1e-6) + toGoal(i) * DIST_W;
  const heap = new MinHeap();
  // the current system can be the core or any star, it only matters as a start
  const [fx, fy, fz] = galaxy.pos(from);
  const startCandidates = from >= 0 ? null : galaxy.starsWithin(fx, fy, fz, range);
  if (from >= 0) {
    g[from] = 0;
    heap.push(from, h(from));
  } else {
    for (const j of startCandidates) {
      if (!classes.includes(galaxy.classOf(j))) continue;
      const d = Math.hypot(P[j * 3] - fx, P[j * 3 + 1] - fy, P[j * 3 + 2] - fz);
      g[j] = 1 + d * DIST_W;
      came[j] = -2;
      heap.push(j, g[j] + h(j));
    }
  }
  let expanded = 0;
  while (heap.size) {
    const i = heap.pop();
    if (closed[i]) continue;
    if (i === to) break;
    closed[i] = 1;
    if ((++expanded & 31) === 0 && performance.now() - t0 > budgetMs) return null;
    const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
    let near = galaxy.starsWithin(px, py, pz, range);
    // near the core a hop can reach thousands of stars. The useful ones are
    // those closest to the goal, so only those get expanded there.
    if (near.length > MAX_BRANCH) near = closestTo(near, toGoal, MAX_BRANCH);
    for (const j of near) {
      if (closed[j] || j === i) continue;
      if (!classes.includes(galaxy.classOf(j))) continue;
      const d = Math.hypot(P[j * 3] - px, P[j * 3 + 1] - py, P[j * 3 + 2] - pz);
      const ng = g[i] + 1 + d * DIST_W;
      if (ng < g[j]) {
        g[j] = ng;
        came[j] = i;
        heap.push(j, ng + h(j));
      }
    }
  }
  if (g[to] === Infinity) return null;
  const path = [to];
  let c = to;
  while (came[c] >= 0) {
    c = came[c];
    path.push(c);
  }
  path.push(from);
  return path.reverse().filter((v, k, a) => k === 0 || v !== a[k - 1]);
}

const MAX_BRANCH = 48;

// the k items with the smallest key, in no particular order (quickselect)
function closestTo(items, key, k) {
  const keys = items.map(key);
  const idx = items.map((_, i) => i);
  let lo = 0, hi = idx.length - 1;
  while (lo < hi) {
    const pivot = keys[idx[(lo + hi) >> 1]];
    let i = lo, j = hi;
    while (i <= j) {
      while (keys[idx[i]] < pivot) i++;
      while (keys[idx[j]] > pivot) j--;
      if (i <= j) {
        [idx[i], idx[j]] = [idx[j], idx[i]];
        i++;
        j--;
      }
    }
    if (k - 1 <= j) hi = j;
    else if (k - 1 >= i) lo = i;
    else break;
  }
  return idx.slice(0, k).map((i) => items[i]);
}

class MinHeap {
  constructor() {
    this.ids = [];
    this.keys = [];
  }

  get size() {
    return this.ids.length;
  }

  push(id, key) {
    const ids = this.ids, keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }

  pop() {
    const ids = this.ids, keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop();
    const lastKey = keys.pop();
    if (ids.length) {
      let i = 0;
      const n = ids.length;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= lastKey) break;
        ids[i] = ids[c];
        keys[i] = keys[c];
        i = c;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}
