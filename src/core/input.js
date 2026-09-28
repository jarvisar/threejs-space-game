import { device } from './device.js';

// Keyboard/mouse state with per-frame edge detection. Everything reads keys by
// KeyboardEvent.code so layouts like AZERTY still map by position. The touch
// controls (ui/touch.js) feed the same sets, plus analog values for the stick.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();
    this.mouseDown = new Set();
    // 0..1 per key code, from the touch stick
    this.analog = new Map();
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.locked = false;
    this.enabled = true;
    this.sensitivity = 1;
    this.invertY = false;

    window.addEventListener('keydown', (e) => {
      const t = e.target;
      const tag = t && t.tagName;
      // typing in the seed box shouldn't move anything, but Esc still works
      if (((tag === 'INPUT' && t.type === 'text') || tag === 'TEXTAREA') && e.code !== 'Escape') return;
      // menu controls keep their keys: Tab moves focus, Space presses, arrows move sliders
      const onControl = tag === 'BUTTON' || tag === 'INPUT';
      if (!onControl && (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow'))) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.down.clear();
      this.mouseDown.clear();
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    canvas.addEventListener('mousedown', (e) => {
      this.mouseDown.add(e.button);
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseDown.delete(e.button);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      // the click that captured the mouse shouldn't also fire the beam
      if (this.locked) this.mouseDown.clear();
    });
  }

  lock() {
    if (device.touch) return;
    if (!this.locked && this.canvas.requestPointerLock) {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  key(code) {
    return this.enabled && this.raw(code);
  }

  // ignores `enabled`, photo mode reads keys while the game is paused
  raw(code) {
    return this.down.has(code) || (this.analog.get(code) || 0) > 0.3;
  }

  hit(code) {
    return this.enabled && this.pressed.has(code);
  }

  mouse(b) {
    return this.enabled && this.mouseDown.has(b);
  }

  axis(neg, pos) {
    if (!this.enabled) return 0;
    const v = (code) => (this.down.has(code) ? 1 : this.analog.get(code) || 0);
    return v(pos) - v(neg);
  }

  look() {
    const s = 0.0022 * this.sensitivity;
    return { x: this.dx * s, y: this.dy * s * (this.invertY ? -1 : 1) };
  }

  endFrame() {
    this.pressed.clear();
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
  }
}
