// Small priority queue in front of a few terrain workers. Jobs with the lowest
// priority value run first. Priorities are refreshed every frame by the owner
// through the getPriority callback, so a chunk the player flies toward jumps
// ahead of ones they left behind.

export class WorkerPool {
  constructor(count) {
    this.workers = [];
    this.queue = [];
    this.pending = new Map();
    this.nextId = 1;
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL('./terrainWorker.js', import.meta.url), { type: 'module' });
      w.busy = 0;
      w.onmessage = (e) => this.onResult(w, e.data);
      w.onerror = (e) => console.error('terrain worker error', e);
      this.workers.push(w);
    }
    this.maxPerWorker = 2;
  }

  broadcast(msg) {
    for (const w of this.workers) w.postMessage(msg);
  }

  request(msg, getPriority, onDone) {
    const id = this.nextId++;
    msg.id = id;
    const job = { id, msg, getPriority, onDone, cancelled: false, priority: 0 };
    this.queue.push(job);
    return job;
  }

  cancel(job) {
    if (job) job.cancelled = true;
  }

  pump() {
    if (this.queue.length === 0) return;
    this.queue = this.queue.filter((j) => !j.cancelled);
    for (const j of this.queue) j.priority = j.getPriority ? j.getPriority() : 0;
    this.queue.sort((a, b) => a.priority - b.priority);
    for (const w of this.workers) {
      while (w.busy < this.maxPerWorker && this.queue.length > 0) {
        const job = this.queue.shift();
        w.busy++;
        this.pending.set(job.id, job);
        w.postMessage(job.msg);
      }
    }
  }

  onResult(w, data) {
    w.busy--;
    const job = this.pending.get(data.id);
    this.pending.delete(data.id);
    if (!job || job.cancelled) return;
    if (data.error) return;
    job.onDone(data);
  }

  get busy() {
    return this.queue.length + this.pending.size;
  }
}
