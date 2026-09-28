import { el } from './dom.js';
import { device } from '../core/device.js';

// On-screen controls for phones and tablets. Nothing here drives the game
// directly, it writes into the same Input the keyboard and mouse use: held
// buttons go into input.down / input.mouseDown, taps into input.pressed, the
// stick into input.analog and drags into the look deltas. That keeps every
// mode (walking, flying, orbit, photo) on one code path.

// A phone screen is only a few hundred px wide, so drags turn faster than the mouse
const LOOK_GAIN = 2.4;
// px of stick travel for full deflection
const STICK_R = 52;
// aim turn rate in rad/s at full deflection while flying. The hull tops out
// around 1.8, a bit more keeps the aim leading it.
const STEER_RATE = 2.3;
// how much a pinch has to change before it counts as one wheel step
const PINCH_STEP = 1.14;

const ICONS = {
  map: '<path d="M4 6.5l5-2 6 2 5-2v13l-5 2-6-2-5 2z"/><path d="M9 4.5v13M15 6.5v13"/>',
  bag: '<rect x="4.5" y="8" width="15" height="12" rx="2"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8M4.5 13h15"/>',
  photo: '<rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13.5" r="3.5"/><path d="M8.5 7l1.5-2.5h4L15.5 7"/>',
  pause: '<path d="M9 6v12M15 6v12"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

// slot is the position in the cluster (style.css), `when` hides a button unless it's useful right now
const ACTIONS = [
  { slot: 1, label: 'Mine', mouse: 0, hold: true, in: ['foot'] },
  { slot: 2, label: 'Jump', code: 'Space', hold: true, in: ['foot'] },
  { slot: 3, label: 'Analyze', mouse: 2, hold: true, in: ['foot'] },
  { slot: 1, label: 'Boost', code: 'ShiftLeft', hold: true, in: ['fly'] },
  { slot: 1, label: 'Fast fwd', code: 'ShiftLeft', hold: true, in: ['orbit'] },
  { slot: 2, label: 'Pulse', code: 'Space', in: ['fly', 'orbit'] },
  { slot: 3, label: 'Fire', mouse: 0, hold: true, in: ['fly'], when: (g) => !!g.shipTarget },
  { slot: 4, label: 'Scan', code: 'KeyF', in: ['foot', 'fly', 'orbit'] },
];

const PHOTO = [
  { label: 'Time −', code: 'KeyZ', hold: true },
  { label: 'Time +', code: 'KeyX', hold: true },
  { label: 'Zoom −', code: 'Digit2' },
  { label: 'Zoom +', code: 'Digit1' },
  { label: 'Blur', code: 'KeyB' },
  { label: 'Filter', code: 'KeyV' },
  { label: 'Ship', code: 'KeyH' },
  { label: 'Fast', code: 'ShiftLeft', hold: true },
];

export class TouchControls {
  constructor(game, parent, before) {
    this.game = game;
    this.input = game.input;
    this.root = el('div', 'touch-ui');
    parent.insertBefore(this.root, before);
    this.state = '';
    // codes and mouse buttons held by on-screen buttons, and what was last
    // written into input so it can be taken back out
    this.held = new Map();
    this.heldMouse = new Map();
    this.owned = new Set();
    this.ownedMouse = new Set();
    this.ptrs = new Map();
    this.stick = null;
    this.look = null;
    this.pinch = null;
    this.actionsKey = '';

    this.zone = el('div', 'touch-zone', this.root);
    this.stickEl = el('div', 'stick', this.root);
    this.knob = el('div', 'stick-knob', this.stickEl);
    this.steerEl = el('div', 'stick steer', this.root);
    this.steerKnob = el('div', 'stick-knob', this.steerEl);

    const top = el('div', 'touch-top', this.root);
    for (const [name, code, label] of [['map', 'KeyG', 'Galaxy map'], ['bag', 'Tab', 'Inventory'], ['photo', 'KeyP', 'Photo mode'], ['pause', 'Escape', 'Pause']]) {
      const b = this.button(top, 'tbtn icon', icon(name), { code });
      b.setAttribute('aria-label', label);
    }

    const cluster = el('div', 'touch-actions', this.root);
    this.actions = ACTIONS.map((a) => ({ ...a, el: this.button(cluster, `tbtn round slot${a.slot}`, a.label, a) }));
    this.context = el('div', 'touch-context', this.root);

    const bar = el('div', 'touch-photo', this.root);
    for (const p of PHOTO) this.button(bar, 'tbtn pill', p.label, p);
    this.button(this.root, 'tbtn round shutter', '', { code: 'Enter' }).setAttribute('aria-label', 'Save photo');
    this.button(this.root, 'tbtn pill photo-exit', 'Done', { code: 'KeyP' });

    this.bindZone();
    this.setState('');
  }

  // A hold button keeps its key down until released, a tap button fires once.
  // Dragging a held button also looks around, so a thumb can mine and aim at
  // the same time like a fire button in a shooter.
  button(parent, cls, html, def) {
    const b = el('button', cls, parent, html);
    b.type = 'button';
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      b.setPointerCapture(e.pointerId);
      this.game.audio.init();
      const code = def.code;
      if (code) this.input.pressed.add(code);
      if (def.hold) {
        if (code) this.held.set(e.pointerId, code);
        else this.heldMouse.set(e.pointerId, def.mouse);
        b.last = { x: e.clientX, y: e.clientY };
        b.classList.add('on');
      } else {
        b.classList.add('on');
        setTimeout(() => b.classList.remove('on'), 120);
      }
      this.sync();
    });
    b.addEventListener('pointermove', (e) => {
      if (!b.last || (!this.held.has(e.pointerId) && !this.heldMouse.has(e.pointerId))) return;
      this.addLook(e.clientX - b.last.x, e.clientY - b.last.y);
      b.last = { x: e.clientX, y: e.clientY };
    });
    const up = (e) => {
      if (!this.held.delete(e.pointerId) && !this.heldMouse.delete(e.pointerId)) return;
      b.last = null;
      b.classList.remove('on');
      this.sync();
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  }

  // Left part of the screen is a floating stick, the rest looks around. A
  // second finger on the look side turns it into a pinch.
  bindZone() {
    const z = this.zone;
    z.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      z.setPointerCapture(e.pointerId);
      this.game.audio.init();
      const p = { x: e.clientX, y: e.clientY };
      if (!this.stick && e.clientX < this.game.viewW * 0.4) {
        this.stick = { id: e.pointerId, ox: p.x, oy: p.y, vx: 0, vy: 0 };
        this.ptrs.set(e.pointerId, 'stick');
        this.drawStick();
      } else if (!this.look && !this.pinch) {
        // flying turns at a rate set by how far the finger is from where it
        // landed, a mouse-like drag would need endless swiping for a long turn
        this.look = { id: e.pointerId, x: p.x, y: p.y, ox: p.x, oy: p.y, steer: this.state === 'fly' };
        this.ptrs.set(e.pointerId, 'look');
        this.drawSteer();
      } else if (this.look && !this.pinch) {
        const l = this.look;
        this.pinch = { a: l.id, b: e.pointerId, pos: { [l.id]: { x: l.x, y: l.y }, [e.pointerId]: p } };
        this.pinch.d = this.pinchDist();
        this.ptrs.set(e.pointerId, 'pinch');
        this.ptrs.set(l.id, 'pinch');
        this.look = null;
        this.drawSteer();
      }
    });
    z.addEventListener('pointermove', (e) => {
      const role = this.ptrs.get(e.pointerId);
      if (role === 'stick') {
        const s = this.stick;
        let dx = e.clientX - s.ox, dy = e.clientY - s.oy;
        const len = Math.hypot(dx, dy);
        // past full deflection the base follows the thumb
        if (len > STICK_R) {
          s.ox += (dx / len) * (len - STICK_R);
          s.oy += (dy / len) * (len - STICK_R);
          dx = e.clientX - s.ox;
          dy = e.clientY - s.oy;
        }
        s.vx = dx / STICK_R;
        s.vy = dy / STICK_R;
        this.drawStick();
      } else if (role === 'look') {
        const l = this.look;
        if (!l.steer) this.addLook(e.clientX - l.x, e.clientY - l.y);
        l.x = e.clientX;
        l.y = e.clientY;
        this.drawSteer();
      } else if (role === 'pinch') {
        const pc = this.pinch;
        pc.pos[e.pointerId] = { x: e.clientX, y: e.clientY };
        const d = this.pinchDist();
        const r = d / pc.d;
        if (r > PINCH_STEP || r < 1 / PINCH_STEP) {
          this.onPinch(r > 1 ? 1 : -1);
          pc.d = d;
        }
      }
    });
    const up = (e) => {
      const role = this.ptrs.get(e.pointerId);
      if (!role) return;
      this.ptrs.delete(e.pointerId);
      if (role === 'stick') {
        this.stick = null;
        this.drawStick();
      } else if (role === 'look') {
        this.look = null;
        this.drawSteer();
      } else if (role === 'pinch') {
        // the finger left over goes back to looking
        const pc = this.pinch;
        const other = pc.a === e.pointerId ? pc.b : pc.a;
        const p = pc.pos[other];
        this.pinch = null;
        if (this.ptrs.has(other)) {
          this.look = { id: other, x: p.x, y: p.y, ox: p.x, oy: p.y, steer: this.state === 'fly' };
          this.ptrs.set(other, 'look');
        }
        this.drawSteer();
      }
    };
    z.addEventListener('pointerup', up);
    z.addEventListener('pointercancel', up);
    z.addEventListener('lostpointercapture', up);
    z.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  pinchDist() {
    const pc = this.pinch;
    const a = pc.pos[pc.a], b = pc.pos[pc.b];
    return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  }

  // fingers apart zooms in: the ship camera moves closer, photo mode narrows the lens
  onPinch(dir) {
    if (this.state === 'photo') this.input.pressed.add(dir > 0 ? 'Digit1' : 'Digit2');
    else this.input.wheel -= dir;
  }

  addLook(dx, dy) {
    this.input.dx += dx * LOOK_GAIN;
    this.input.dy += dy * LOOK_GAIN;
  }

  stateFor(g) {
    if (!device.touch || g.screen !== 'play' || g.warp || g.holdRender || g.loadingGame) return '';
    if (g.photo) return 'photo';
    if (g.menuOpen || g.paused) return '';
    if (g.mode === 'foot') return 'foot';
    const s = g.ship;
    if (s.orbit) return 'orbit';
    return s.state === 'flying' ? 'fly' : 'landed';
  }

  setState(state) {
    this.state = state;
    this.root.dataset.state = state;
    for (const a of this.actions) a.el.hidden = !a.in.includes(state);
    if (!state) this.releaseAll();
    else if (this.look) {
      // e.g. taking off mid-drag, start steering from where the finger is now
      Object.assign(this.look, { steer: state === 'fly', ox: this.look.x, oy: this.look.y });
    }
    this.drawSteer();
  }

  releaseAll() {
    this.held.clear();
    this.heldMouse.clear();
    this.ptrs.clear();
    this.stick = this.look = this.pinch = null;
    this.input.analog.clear();
    for (const b of this.root.querySelectorAll('.tbtn.on')) b.classList.remove('on');
    this.sync();
    this.drawStick();
    this.setActions(null);
  }

  // puts the held buttons into input. Runs every frame too, since losing
  // window focus clears input.down while a finger may still be on a button.
  sync() {
    const input = this.input;
    const want = new Set(this.held.values());
    const s = this.stick;
    // pushing the stick all the way forward sprints on foot
    if (s && this.state === 'foot' && s.vy < -0.5 && Math.hypot(s.vx, s.vy) > 0.92) want.add('ShiftLeft');
    for (const c of this.owned) if (!want.has(c)) input.down.delete(c);
    for (const c of want) input.down.add(c);
    this.owned = want;
    const mouse = new Set(this.heldMouse.values());
    for (const b of this.ownedMouse) if (!mouse.has(b)) input.mouseDown.delete(b);
    for (const b of mouse) input.mouseDown.add(b);
    this.ownedMouse = mouse;
  }

  update(dt) {
    const g = this.game;
    const state = this.stateFor(g);
    if (state !== this.state) this.setState(state);
    if (!state) return;
    const input = this.input;
    const a = input.analog;
    a.clear();
    const s = this.stick;
    if (s) {
      let vx = s.vx, vy = s.vy;
      const len = Math.hypot(vx, vy);
      if (len < 0.15) vx = vy = 0;
      else if (len > 1) {
        vx /= len;
        vy /= len;
      }
      // In the ship the stick is throttle and roll, keep a push for throttle
      // from rolling the ship at the same time
      if (state === 'fly' && Math.abs(vx) < 0.4) vx = 0;
      if (vy < 0) a.set('KeyW', -vy);
      else if (vy > 0) a.set('KeyS', vy);
      if (vx < 0) a.set('KeyA', -vx);
      else if (vx > 0) a.set('KeyD', vx);
    }
    const l = this.look;
    if (l && l.steer) {
      // squared so small offsets give fine control
      const k = (v) => Math.sign(v) * Math.min(1, Math.abs(v)) ** 2;
      const sx = k((l.x - l.ox) / (STICK_R * 1.2)), sy = k((l.y - l.oy) / (STICK_R * 1.2));
      input.dx += (sx * STEER_RATE * dt) / 0.0022;
      input.dy += (sy * STEER_RATE * dt) / 0.0022;
    }
    this.sync();
    for (const b of this.actions) {
      // a held button stays until it's let go
      if (b.when && !b.el.hidden) b.el.classList.toggle('off', !b.when(g) && !b.el.classList.contains('on'));
    }
  }

  // contextual buttons, the same list the desktop prompt is built from
  setActions(list) {
    const key = list ? list.map((a) => `${a.code}|${a.label}`).join(',') : '';
    if (key === this.actionsKey) return;
    this.actionsKey = key;
    this.context.textContent = '';
    for (const a of list || []) {
      if (a.code) this.button(this.context, 'tbtn pill ctx', a.label, { code: a.code });
      else el('div', 'ctx-note', this.context, a.label);
    }
  }

  drawStick() {
    const s = this.stick;
    this.stickEl.classList.toggle('active', !!s);
    if (!s) {
      this.stickEl.style.transform = '';
      this.knob.style.transform = '';
      return;
    }
    this.stickEl.style.transform = `translate(${s.ox}px, ${s.oy}px)`;
    const len = Math.hypot(s.vx, s.vy);
    const k = len > 1 ? 1 / len : 1;
    this.knob.style.transform = `translate(${s.vx * k * STICK_R}px, ${s.vy * k * STICK_R}px)`;
  }

  drawSteer() {
    const l = this.look;
    const show = !!l && l.steer;
    this.steerEl.classList.toggle('active', show);
    if (!show) return;
    this.steerEl.style.transform = `translate(${l.ox}px, ${l.oy}px)`;
    let dx = l.x - l.ox, dy = l.y - l.oy;
    const len = Math.hypot(dx, dy), max = STICK_R * 1.2;
    if (len > max) {
      dx *= max / len;
      dy *= max / len;
    }
    this.steerKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
}
