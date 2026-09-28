// Keyboard/mouse state with per-frame edge detection. Everything reads keys by
// KeyboardEvent.code so layouts like AZERTY still map by position.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouseDown = new Set();
    this.mousePressed = new Set();
    this.mouseReleased = new Set();
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.locked = false;
    this.enabled = true;
    this.sensitivity = 1;
    this.invertY = false;

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
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
      this.mousePressed.add(e.button);
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseDown.delete(e.button);
      this.mouseReleased.add(e.button);
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
    if (!this.locked && this.canvas.requestPointerLock) {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  key(code) {
    return this.enabled && this.down.has(code);
  }

  hit(code) {
    return this.enabled && this.pressed.has(code);
  }

  mouse(b) {
    return this.enabled && this.mouseDown.has(b);
  }

  click(b) {
    return this.enabled && this.mousePressed.has(b);
  }

  axis(neg, pos) {
    return (this.key(pos) ? 1 : 0) - (this.key(neg) ? 1 : 0);
  }

  look() {
    const s = 0.0022 * this.sensitivity;
    return { x: this.dx * s, y: this.dy * s * (this.invertY ? -1 : 1) };
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mousePressed.clear();
    this.mouseReleased.clear();
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
  }
}
