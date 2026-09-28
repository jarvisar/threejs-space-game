// DOM overlay for everything shown during play. The game pushes plain values
// in each frame and this only touches the DOM when something changed.

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

function setText(e, t) {
  if (e._t !== t) {
    e._t = t;
    e.textContent = t;
  }
}

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
    this.obj = el('div', 'objective', tl);
    this.objTitle = el('div', 'obj-title', this.obj);
    this.objText = el('div', 'obj-text', this.obj);

    this.center = el('div', 'hud-center', this.root);
    this.crosshair = el('div', 'crosshair', this.center);
    this.nose = el('div', 'nose', this.root);
    this.scanRing = el('div', 'scan-ring', this.center);
    this.target = el('div', 'target-info', this.root);

    this.promptEl = el('div', 'prompt', this.root);
    this.bannerEl = el('div', 'banner', this.root);
    this.bannerTitle = el('div', 'banner-title', this.bannerEl);
    this.bannerSub = el('div', 'banner-sub', this.bannerEl);
    this.centerMsg = el('div', 'center-msg', this.root);

    const bottom = el('div', 'hud-bottom', this.root);
    this.flight = el('div', 'flight', bottom);
    this.flightMode = el('div', 'flight-mode', this.flight);
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

    this.feed = el('div', 'feed', this.root);
    this.hint = el('div', 'hint', this.root);
    this.vignette = el('div', 'hazard-vignette', this.root);
    this.mode = null;
  }

  setVisible(v) {
    this.root.style.display = v ? '' : 'none';
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
    this.vignette.style.opacity = s.danger.toFixed(2);
    this.vignette.style.setProperty('--vig', s.dangerColor || '255,60,40');
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
    if (!info) {
      this.target.classList.remove('show');
      return;
    }
    this.target.classList.add('show');
    const html = `<div class="ti-name">${info.name}</div><div class="ti-sub">${info.sub || ''}</div>${
      info.progress !== undefined ? `<div class="bar ti-bar"><div class="bar-fill" style="width:${info.progress * 100}%"></div></div>` : ''
    }`;
    if (this.target._h !== html) {
      this.target._h = html;
      this.target.innerHTML = html;
    }
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

  banner(title, sub, dur = 4000) {
    setText(this.bannerTitle, title);
    setText(this.bannerSub, sub || '');
    this.bannerEl.classList.remove('show');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('show');
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => this.bannerEl.classList.remove('show'), dur);
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
        e = el('div', `marker ${m.kind || ''}`, this.markerLayer);
        e.icon = el('div', 'marker-icon', e);
        e.label = el('div', 'marker-label', e);
        e.sub = el('div', 'marker-sub', e);
        this.markerEls.set(m.id, e);
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
