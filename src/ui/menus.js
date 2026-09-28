import { RESOURCES, RESOURCE_ORDER } from '../game/resources.js';
import { UPGRADES, UPGRADE_ORDER, RECIPES, level, nextUpgrade } from '../game/upgrades.js';

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

function costHtml(state, cost) {
  return Object.entries(cost)
    .map(([k, v]) => {
      const have = k === 'data' ? state.data : state.count(k);
      const name = k === 'data' ? 'Data' : RESOURCES[k].name;
      const color = k === 'data' ? '#9fe8ff' : RESOURCES[k].color;
      return `<span class="cost ${have >= v ? 'ok' : 'short'}" style="--c:${color}"><i></i>${v} ${name} <em>(${have})</em></span>`;
    })
    .join('');
}

export const CONTROLS = [
  ['On foot', [['WASD', 'Move'], ['Mouse', 'Look'], ['Shift', 'Sprint'], ['Space', 'Jump, hold for jetpack'], ['Left Mouse', 'Mining beam'], ['Right Mouse', 'Analysis visor'], ['F', 'Scanner pulse'], ['E', 'Interact, board ship'], ['R', 'Recharge hazard shield with Lumen']]],
  ['In the ship', [['Mouse', 'Steer'], ['W / S', 'Throttle'], ['A / D', 'Roll'], ['Shift', 'Boost'], ['Space', 'Pulse drive (in space)'], ['E', 'Land, exit ship'], ['F', 'Planet scan'], ['Wheel', 'Camera distance']]],
  ['Anywhere', [['Tab', 'Inventory, crafting, upgrades'], ['G', 'Galaxy map'], ['J', 'Journal'], ['P', 'Photo mode'], ['Esc', 'Pause']]],
];

export class Menus {
  constructor(root, game) {
    this.game = game;
    this.root = el('div', 'menus', root);
    this.current = null;
    this.buildTitle();
    this.buildPause();
    this.buildInventory();
    this.buildDialog();
    this.buildOverlay();
  }

  // ---------------------------------------------------------------- title
  buildTitle() {
    const t = el('div', 'screen title-screen', this.root);
    const inner = el('div', 'title-inner', t);
    el('div', 'title-name', inner, 'STARSONG');
    el('div', 'title-tag', inner, 'Follow the Chorus to the heart of the galaxy');
    const btns = el('div', 'title-buttons', inner);
    this.btnContinue = el('button', 'btn primary', btns, 'Continue');
    this.btnNew = el('button', 'btn', btns, 'New Journey');
    this.btnControls = el('button', 'btn', btns, 'Controls');
    const seedRow = el('div', 'seed-row', inner);
    el('span', '', seedRow, 'Galaxy seed');
    this.seedInput = el('input', 'seed-input', seedRow);
    this.seedInput.value = String(Math.floor(Math.random() * 90000) + 10000);
    this.titleControls = el('div', 'controls-panel', inner);
    this.titleControls.style.display = 'none';
    this.titleControls.innerHTML = this.controlsHtml();
    el('div', 'title-foot', t, 'Click the view to capture the mouse. Best with a mouse and keyboard.');
    // browsers only allow audio after a user gesture, so any click starts the music
    t.addEventListener('pointerdown', () => this.game.audio.init());
    this.btnContinue.onclick = () => this.game.startFromTitle('continue');
    this.btnNew.onclick = () => this.game.startFromTitle('new', parseInt(this.seedInput.value, 10) || 1337);
    this.btnControls.onclick = () => {
      this.titleControls.style.display = this.titleControls.style.display === 'none' ? '' : 'none';
    };
    this.titleEl = t;
  }

  showTitle(hasSave) {
    this.btnContinue.style.display = hasSave ? '' : 'none';
    this.btnNew.classList.toggle('primary', !hasSave);
    this.open('title');
  }

  controlsHtml() {
    return CONTROLS.map(([group, rows]) => `<div class="ctl-group"><h4>${group}</h4>${rows.map(([k, d]) => `<div class="ctl"><kbd>${k}</kbd><span>${d}</span></div>`).join('')}</div>`).join('');
  }

  // ---------------------------------------------------------------- pause
  buildPause() {
    const p = el('div', 'screen pause-screen', this.root);
    const panel = el('div', 'panel narrow', p);
    el('h2', '', panel, 'Paused');
    const resume = el('button', 'btn primary', panel, 'Resume');
    const save = el('button', 'btn', panel, 'Save');
    const settings = el('div', 'settings', panel);
    settings.innerHTML = `
      <label>Mouse sensitivity <input type="range" min="0.3" max="2.5" step="0.05" data-k="sensitivity"></label>
      <label>Invert mouse Y <input type="checkbox" data-k="invertY"></label>
      <label>Render scale <input type="range" min="0.5" max="1" step="0.05" data-k="renderScale"></label>
      <label>Shadows <input type="checkbox" data-k="shadows"></label>
      <label>Volume <input type="range" min="0" max="1" step="0.05" data-k="volume"></label>
      <label>Music <input type="range" min="0" max="1" step="0.05" data-k="music"></label>`;
    this.settingsEl = settings;
    const controls = el('div', 'controls-panel small', panel);
    controls.innerHTML = this.controlsHtml();
    const quit = el('button', 'btn', panel, 'Save and quit to title');
    resume.onclick = () => this.game.closeMenus();
    save.onclick = () => {
      this.game.saveGame();
      save.textContent = 'Saved';
      setTimeout(() => (save.textContent = 'Save'), 1200);
    };
    quit.onclick = () => this.game.quitToTitle();
    settings.addEventListener('input', (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      const v = e.target.type === 'checkbox' ? e.target.checked : parseFloat(e.target.value);
      this.game.setSetting(k, v);
    });
  }

  syncSettings(s) {
    for (const inp of this.settingsEl.querySelectorAll('input')) {
      const k = inp.dataset.k;
      if (inp.type === 'checkbox') inp.checked = !!s[k];
      else inp.value = s[k];
    }
  }

  // ---------------------------------------------------------------- inventory
  buildInventory() {
    const s = el('div', 'screen inv-screen', this.root);
    const panel = el('div', 'panel wide', s);
    const head = el('div', 'inv-head', panel);
    this.tabs = {};
    for (const [id, label] of [['cargo', 'Cargo'], ['craft', 'Crafting'], ['upgrades', 'Upgrades'], ['journal', 'Journal']]) {
      const b = el('button', 'tab', head, label);
      b.onclick = () => this.showTab(id);
      this.tabs[id] = b;
    }
    this.invStatus = el('div', 'inv-status', head);
    el('div', 'inv-close', head, '<kbd>Tab</kbd> close').onclick = () => this.game.closeMenus();
    this.invBody = el('div', 'inv-body', panel);
    this.tab = 'cargo';
    this.invEl = s;
    this.invBody.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      const act = b.dataset.act;
      if (act === 'craft') this.game.craft(b.dataset.id);
      if (act === 'upgrade') this.game.buyUpgrade(b.dataset.id);
      if (act === 'shield') this.game.rechargeShield();
      this.render();
    });
  }

  showTab(id) {
    this.tab = id;
    for (const [k, b] of Object.entries(this.tabs)) b.classList.toggle('on', k === id);
    this.render();
  }

  render() {
    if (this.current !== 'inventory') return;
    const st = this.game.state;
    this.invStatus.innerHTML = `<span class="data">${st.data} Data</span><span class="cells">${st.warpCells} Warp Cell${st.warpCells === 1 ? '' : 's'}</span>`;
    let html = '';
    if (this.tab === 'cargo') {
      html += '<div class="res-grid">';
      for (const k of RESOURCE_ORDER) {
        const r = RESOURCES[k];
        const n = st.count(k);
        const cap = st.cap(k);
        html += `<div class="res ${n ? '' : 'empty'}" style="--c:${r.color}"><div class="res-icon"></div><div class="res-name">${r.name}</div><div class="res-count">${n}<span>/${cap}</span></div><div class="bar"><div class="bar-fill" style="width:${(n / cap) * 100}%"></div></div><div class="res-desc">${r.desc}</div></div>`;
      }
      html += '</div>';
    } else if (this.tab === 'craft') {
      html += '<div class="cards">';
      for (const r of RECIPES) {
        if (r.story && !['core', 'end'].includes(st.story.stage)) continue;
        const done = r.id === 'lens' && st.story.flags.lens;
        const ok = st.has(r.cost) && !done;
        let extra = '';
        if (r.id === 'warpcell') extra = `<div class="card-note">You have ${st.warpCells}</div>`;
        if (r.id === 'lens') extra = `<div class="card-note">${st.story.flags.lens ? 'Crafted' : 'Needed for the Core Jump'}</div>`;
        html += `<div class="card"><div class="card-title">${r.name}</div><div class="card-desc">${r.desc}</div>${extra}<div class="costs">${costHtml(st, r.cost)}</div><button class="btn small" data-act="craft" data-id="${r.id}" ${ok ? '' : 'disabled'}>${done ? 'Crafted' : 'Craft'}</button></div>`;
      }
      html += '</div>';
    } else if (this.tab === 'upgrades') {
      html += '<div class="upgrades">';
      for (const id of UPGRADE_ORDER) {
        const u = UPGRADES[id];
        const lv = level(st, id);
        const next = nextUpgrade(st, id);
        const pips = Array.from({ length: u.levels.length + 1 }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('');
        html += `<div class="upg"><div class="upg-name">${u.name}<div class="pips">${pips}</div></div>`;
        if (next) {
          const ok = st.has(next.cost);
          html += `<div class="upg-next"><b>${next.name}</b><div class="card-desc">${next.desc}</div><div class="costs">${costHtml(st, next.cost)}</div></div><button class="btn small" data-act="upgrade" data-id="${id}" ${ok ? '' : 'disabled'}>Install</button>`;
        } else html += '<div class="upg-next"><b>Fully upgraded</b></div><div></div>';
        html += '</div>';
      }
      html += '</div>';
    } else if (this.tab === 'journal') {
      html += this.journalHtml();
    }
    if (this.invBody._h !== html) {
      this.invBody._h = html;
      this.invBody.innerHTML = html;
    }
  }

  journalHtml() {
    const g = this.game;
    const st = g.state;
    const species = Object.values(st.species);
    let h = '<div class="journal">';
    h += `<div class="j-col"><h4>Travel</h4><div class="j-stat"><b>${st.visited.length}</b> systems visited</div><div class="j-stat"><b>${Object.keys(st.discoveries).length}</b> worlds discovered</div><div class="j-stat"><b>${species.length}</b> species catalogued</div><div class="j-stat"><b>${Math.floor(st.playTime / 60)}</b> minutes played</div>`;
    h += '<h4>Worlds</h4>';
    const worlds = Object.values(st.discoveries).slice(-14).reverse();
    for (const w of worlds) h += `<div class="j-row"><b>${w.name}</b><span>${w.type} · ${w.system}</span></div>`;
    h += '</div><div class="j-col"><h4>Species</h4>';
    for (const s of species.slice(-16).reverse()) h += `<div class="j-row"><b>${s.name}</b><span>${s.planet}</span></div>`;
    if (!species.length) h += '<div class="j-empty">Hold Right Mouse on a plant to catalogue it.</div>';
    h += '</div><div class="j-col wide"><h4>Echoes</h4>';
    for (const l of st.lore.slice(-10).reverse()) h += `<div class="j-lore"><div class="j-lore-title">${l.title}</div>${l.text.map((p) => `<p>${p}</p>`).join('')}</div>`;
    if (!st.lore.length) h += '<div class="j-empty">Echo Stones and spires record what you find here.</div>';
    h += '</div></div>';
    return h;
  }

  // ---------------------------------------------------------------- dialog
  buildDialog() {
    const d = el('div', 'screen dialog-screen', this.root);
    const panel = el('div', 'panel dialog', d);
    this.dlgTitle = el('div', 'dlg-title', panel);
    this.dlgBody = el('div', 'dlg-body', panel);
    this.dlgReward = el('div', 'dlg-reward', panel);
    const b = el('button', 'btn primary', panel, 'Continue');
    b.onclick = () => this.game.closeMenus();
    this.dialogEl = d;
  }

  showDialog(title, paragraphs, reward) {
    this.dlgTitle.textContent = title;
    this.dlgBody.innerHTML = paragraphs.map((p) => `<p>${p}</p>`).join('');
    this.dlgReward.innerHTML = reward || '';
    this.open('dialog');
  }

  // ---------------------------------------------------------------- overlay
  buildOverlay() {
    this.fade = el('div', 'fade', this.root);
    this.deathEl = el('div', 'screen death-screen', this.root);
    const inner = el('div', 'death-inner', this.deathEl);
    el('div', 'death-title', inner, 'Suit failure');
    this.deathText = el('div', 'death-text', inner, '');
  }

  setFade(v) {
    this.fade.style.opacity = v;
  }

  open(name) {
    this.current = name;
    this.root.dataset.open = name || '';
    if (name === 'inventory') {
      this.showTab(this.tab);
    }
  }

  close() {
    this.open(null);
  }
}
