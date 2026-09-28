import { el, setText } from './dom.js';
import { swatchStyle } from '../game/facts.js';

// DOM overlay for everything shown during play. The game pushes plain values
// in each frame and this only touches the DOM when something changed.

// matches the banner animation in style.css
const BANNER_MS = 4000;

function fmtDist(m) {
  if (m < 1000) return `${Math.round(m)} m`;
  if (m < 100000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000)} km`;
}

function fmtSpeed(v) {
  if (v < 1000) return `${Math.round(v)}`;
  return `${(v / 1000).toFixed(1)}k`;
}

export { fmtDist };

export class HUD {
  constructor(root) {
    this.root = el('div', 'hud', root);
    this.markerLayer = el('div', 'markers', this.root);
    this.markerEls = new Map();

    const tl = el('div', 'hud-tl', this.root);
    this.loc = el('div', 'loc', tl);
    this.locSystem = el('div', 'loc-system', this.loc);
    this.locBody = el('div', 'loc-body', this.loc);
    this.locSub = el('div', 'loc-sub', this.loc);
    this.locRoute = el('div', 'loc-route', this.loc);
    this.obj = el('div', 'objective', tl);
    this.objTitle = el('div', 'obj-title', this.obj);
    this.objText = el('div', 'obj-text', this.obj);

    this.center = el('div', 'hud-center', this.root);
    this.crosshair = el('div', 'crosshair', this.center);
    this.nose = el('div', 'nose', this.root);
    // flight path marker: where the ship is actually moving
    this.fpm = el('div', 'fpm', this.root);
    this.scanRing = el('div', 'scan-ring', this.center);
    this.target = el('div', 'target-info', this.root);
    this.targetName = el('div', 'ti-name', this.target);
    this.targetSub = el('div', 'ti-sub', this.target);
    this.targetBar = el('div', 'bar ti-bar', this.target);
    this.targetFill = el('div', 'bar-fill', this.targetBar);

    this.promptEl = el('div', 'prompt', this.root);
    this.bannerEl = el('div', 'banner', this.root);
    this.bannerTitle = el('div', 'banner-title', this.bannerEl);
    this.bannerSub = el('div', 'banner-sub', this.bannerEl);
    this.centerMsg = el('div', 'center-msg', this.root);

    const bottom = el('div', 'hud-bottom', this.root);
    this.flight = el('div', 'flight', bottom);
    this.flightMode = el('div', 'flight-mode', this.flight);
    this.flightSub = el('div', 'flight-sub', this.flight);
    const fr = el('div', 'flight-row', this.flight);
    const sp = el('div', 'readout', fr);
    this.speedVal = el('div', 'readout-val', sp);
    el('div', 'readout-label', sp, 'm/s');
    const al = el('div', 'readout', fr);
    this.altVal = el('div', 'readout-val', al);
    el('div', 'readout-label', al, 'altitude');
    this.throttleBar = el('div', 'bar throttle', this.flight);
    this.throttleFill = el('div', 'bar-fill', this.throttleBar);
    this.energyBar = el('div', 'bar energy', this.flight);
    this.energyFill = el('div', 'bar-fill', this.energyBar);

    this.suit = el('div', 'suit', bottom);
    this.hazardRow = el('div', 'suit-row', this.suit);
    this.hazardIcon = el('div', 'suit-label', this.hazardRow);
    this.hazardBar = el('div', 'bar hazard', this.hazardRow);
    this.hazardFill = el('div', 'bar-fill', this.hazardBar);
    const hr = el('div', 'suit-row', this.suit);
    el('div', 'suit-label', hr, 'Life');
    this.healthBar = el('div', 'bar health', hr);
    this.healthFill = el('div', 'bar-fill', this.healthBar);
    const jr = el('div', 'suit-row', this.suit);
    el('div', 'suit-label', jr, 'Jet');
    this.jetBar = el('div', 'bar jet', jr);
    this.jetFill = el('div', 'bar-fill', this.jetBar);

    this.card = el('div', 'dcard', this.root);
    this.feed = el('div', 'feed', this.root);
    this.hint = el('div', 'hint', this.root);
    this.vignette = el('div', 'hazard-vignette', this.root);
    // outside the HUD root, which photo mode hides
    const keys = [['WASD', 'Fly'], ['R</kbd><kbd>F', 'Up, down'], ['Q</kbd><kbd>E', 'Roll'], ['Shift', 'Fast'], ['Wheel', 'Speed'], ['Z</kbd><kbd>X', 'Time of day'], ['1</kbd><kbd>2', 'Zoom'], ['B', 'Focus blur'], ['V', 'Filter'], ['H', 'Hide ship'], ['Enter', 'Save'], ['P', 'Exit']];
    this.photoHint = el('div', 'photo-hint', root, `<b>Photo mode</b>${keys.map(([k, d]) => `<span><kbd>${k}</kbd>${d}</span>`).join('')}`);
    this.photoStatusEl = el('div', 'photo-status', root);
    this.mode = null;
    this.visible = true;
    this.bannerQueue = [];
    this.bannerOn = false;
  }

  setVisible(v) {
    this.visible = v;
    this.root.style.display = v ? '' : 'none';
    if (v && !this.bannerOn) this.nextBanner();
  }

  // fades out on its own so it isn't in the screenshots
  showPhotoHint(v) {
    clearTimeout(this._photoT);
    this.photoHint.classList.toggle('show', v);
    if (v) this._photoT = setTimeout(() => this.photoHint.classList.remove('show'), 6000);
  }

  // short readout when a photo setting changes, fades so it stays out of shots
  photoStatus(text) {
    setText(this.photoStatusEl, text);
    this.photoStatusEl.classList.add('show');
    clearTimeout(this._photoS);
    this._photoS = setTimeout(() => this.photoStatusEl.classList.remove('show'), 1400);
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.root.dataset.mode = mode;
  }

  setLocation(system, body, sub) {
    setText(this.locSystem, system || '');
    setText(this.locBody, body || '');
    setText(this.locSub, sub || '');
  }

  setRoute(html) {
    if (this.locRoute._t === html) return;
    this.locRoute._t = html;
    this.locRoute.innerHTML = html || '';
    this.locRoute.style.display = html ? '' : 'none';
  }

  setObjective(title, text) {
    this.obj.style.display = title ? '' : 'none';
    setText(this.objTitle, title || '');
    if (this.objText._t !== text) {
      this.objText._t = text;
      this.objText.innerHTML = text || '';
    }
  }

  updateFlight(f) {
    setText(this.flightMode, f.mode);
    setText(this.flightSub, f.sub || '');
    this.flight.classList.toggle('orbiting', !!f.orbit);
    this.root.dataset.orbit = f.orbit ? '1' : '';
    setText(this.speedVal, fmtSpeed(f.speed));
    setText(this.altVal, f.alt === Infinity || f.alt > 1e7 ? '--' : fmtDist(Math.max(0, f.alt)));
    this.throttleFill.style.width = `${Math.max(0, f.throttle) * 100}%`;
    this.energyFill.style.width = `${f.energy * 100}%`;
    this.flight.classList.toggle('pulsing', !!f.pulse);
  }

  updateSuit(s) {
    setText(this.hazardIcon, s.hazardLabel);
    this.hazardFill.style.width = `${s.shield * 100}%`;
    this.healthFill.style.width = `${s.health * 100}%`;
    this.jetFill.style.width = `${s.jet * 100}%`;
    this.hazardRow.classList.toggle('warn', s.shield < 0.25 && s.hazardActive);
    this.vignette._h = null;
    this.vignette.style.opacity = s.danger.toFixed(2);
    this.vignette.style.setProperty('--vig', s.dangerColor || '255,60,40');
  }

  setVelocity(x, y, visible) {
    this.fpm.style.display = visible ? '' : 'none';
    if (visible) this.fpm.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }

  // entry heat tints the screen edges, shares the element with suit hazards
  setHeat(k) {
    const v = (Math.min(1, k) * 0.9).toFixed(2);
    if (this.vignette._h === v) return;
    this.vignette._h = v;
    this.vignette.style.opacity = v;
    this.vignette.style.setProperty('--vig', '255,120,40');
  }

  setNose(x, y, visible) {
    this.nose.style.display = visible ? '' : 'none';
    if (visible) this.nose.style.transform = `translate(${x}px, ${y}px)`;
  }

  prompt(text) {
    if (this.promptEl._t === text) return;
    this.promptEl._t = text;
    this.promptEl.innerHTML = text || '';
    this.promptEl.classList.toggle('show', !!text);
  }

  setHint(text) {
    if (this.hint._t === text) return;
    this.hint._t = text;
    this.hint.innerHTML = text || '';
    this.hint.classList.toggle('show', !!text);
  }

  setTarget(info) {
    this.target.classList.toggle('show', !!info);
    if (!info) return;
    setText(this.targetName, info.name);
    setText(this.targetSub, info.sub || '');
    const bar = info.progress !== undefined;
    this.targetBar.style.display = bar ? '' : 'none';
    if (bar) this.targetFill.style.width = `${info.progress * 100}%`;
  }

  notify(text, color = '#cfe8ff') {
    const n = el('div', 'feed-item', this.feed);
    n.innerHTML = text;
    n.style.setProperty('--c', color);
    requestAnimationFrame(() => n.classList.add('show'));
    setTimeout(() => n.classList.add('hide'), 3600);
    setTimeout(() => n.remove(), 4300);
    while (this.feed.children.length > 6) this.feed.firstChild.remove();
  }

  // Banners queue so the planet banner doesn't replace the system name a frame
  // later. They wait while the HUD is hidden, a hidden element restarts its
  // animation when shown again.
  banner(title, sub) {
    if (this.bannerQueue.some((b) => b.title === title)) return;
    this.bannerQueue.push({ title, sub });
    if (!this.bannerOn) this.nextBanner();
  }

  nextBanner() {
    const b = this.visible ? this.bannerQueue.shift() : null;
    this.bannerOn = !!b;
    if (!b) return;
    setText(this.bannerTitle, b.title);
    setText(this.bannerSub, b.sub || '');
    this.bannerEl.classList.remove('show');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('show');
    this._bannerT = setTimeout(() => {
      this.bannerEl.classList.remove('show');
      this.nextBanner();
    }, BANNER_MS);
  }

  // facts from game/facts.js, kicker is the small line on top
  showCard(f, kicker) {
    const rows = f.rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    const tags = f.tags.length ? `<div class="dcard-tags">${f.tags.map((t) => `<i>${t}</i>`).join('')}</div>` : '';
    this.card.innerHTML = `<div class="dcard-kicker">${kicker}</div><div class="dcard-head"><div class="dcard-orb" style="${swatchStyle(f.colors, f.gas)}"></div><div><div class="dcard-name">${f.name}</div><div class="dcard-type">${f.type}</div></div></div><div class="dcard-rows">${rows}</div>${tags}`;
    this.card.classList.remove('show');
    void this.card.offsetWidth;
    this.card.classList.add('show');
    clearTimeout(this._cardT);
    this._cardT = setTimeout(() => this.card.classList.remove('show'), 9000);
  }

  clearBanners() {
    clearTimeout(this._bannerT);
    this.bannerQueue.length = 0;
    this.bannerOn = false;
    this.bannerEl.classList.remove('show');
  }

  clearMessage() {
    clearTimeout(this._msgT);
    this.centerMsg.classList.remove('show');
  }

  message(text, dur = 2200) {
    setText(this.centerMsg, text);
    this.centerMsg.classList.add('show');
    clearTimeout(this._msgT);
    this._msgT = setTimeout(() => this.centerMsg.classList.remove('show'), dur);
  }

  // markers: [{ id, x, y, visible, label, sub, kind, color }]
  setMarkers(list) {
    const seen = new Set();
    for (const m of list) {
      seen.add(m.id);
      let e = this.markerEls.get(m.id);
      if (!e) {
        e = el('div', 'marker', this.markerLayer);
        e.icon = el('div', 'marker-icon', e);
        e.label = el('div', 'marker-label', e);
        e.sub = el('div', 'marker-sub', e);
        this.markerEls.set(m.id, e);
      }
      // a planet marker turns into the signal marker when its spire becomes the goal
      if (e._k !== m.kind) {
        e._k = m.kind;
        e.className = `marker ${m.kind || ''}`;
      }
      if (!m.visible) {
        e.style.display = 'none';
        continue;
      }
      e.style.display = '';
      e.style.transform = `translate(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px)`;
      if (m.color && e._c !== m.color) {
        e._c = m.color;
        e.style.setProperty('--mc', m.color);
      }
      e.classList.toggle('edge', !!m.edge);
      setText(e.label, m.label || '');
      setText(e.sub, m.sub || '');
    }
    for (const [id, e] of this.markerEls) {
      if (!seen.has(id)) {
        e.remove();
        this.markerEls.delete(id);
      }
    }
  }

  scanPulse() {
    this.scanRing.classList.remove('go');
    void this.scanRing.offsetWidth;
    this.scanRing.classList.add('go');
  }
}
