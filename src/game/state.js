import { RESOURCES } from './resources.js';

// the game's old name, kept so existing saves still load
const SAVE_KEY = 'starsong-save-v1';

// Everything that persists between sessions. Plain data only so it can go
// straight to JSON.
export class GameState {
  constructor(seed = 1337) {
    this.version = 1;
    this.seed = seed;
    this.worldTime = 0;
    this.playTime = 0;
    this.systemIndex = -1;
    this.inventory = {};
    for (const k of Object.keys(RESOURCES)) this.inventory[k] = 0;
    this.capacity = 250;
    this.warpCells = 0;
    this.data = 0;
    this.upgrades = {};
    this.visited = [];
    this.discoveries = {};
    this.species = {};
    this.lore = [];
    this.mined = [];
    this.pois = {};
    this.story = { stage: 'repair', resonance: 0, flags: {} };
    this.suit = { shield: 1, health: 1 };
    this.player = null;
  }

  count(res) {
    return this.inventory[res] || 0;
  }

  cap(res) {
    if (res === 'relic') return 99;
    return this.capacity;
  }

  // returns how many were actually added
  add(res, n) {
    const have = this.count(res);
    const room = Math.max(0, this.cap(res) - have);
    const added = Math.min(room, n);
    this.inventory[res] = have + added;
    return added;
  }

  has(cost) {
    for (const [k, v] of Object.entries(cost)) {
      if (k === 'data') {
        if (this.data < v) return false;
      } else if (this.count(k) < v) return false;
    }
    return true;
  }

  spend(cost) {
    if (!this.has(cost)) return false;
    for (const [k, v] of Object.entries(cost)) {
      if (k === 'data') this.data -= v;
      else this.inventory[k] -= v;
    }
    return true;
  }

  markVisited(i) {
    if (!this.visited.includes(i)) {
      this.visited.push(i);
      return true;
    }
    return false;
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this));
      return true;
    } catch (e) {
      console.warn('save failed', e);
      return false;
    }
  }

  static load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      const s = new GameState(data.seed);
      Object.assign(s, data);
      for (const k of Object.keys(RESOURCES)) if (s.inventory[k] === undefined) s.inventory[k] = 0;
      return s;
    } catch (e) {
      console.warn('load failed', e);
      return null;
    }
  }

  static clear() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // storage can be blocked, nothing to clear then
    }
  }
}
