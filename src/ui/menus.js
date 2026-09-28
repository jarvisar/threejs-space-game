import { RESOURCES, RESOURCE_ORDER } from '../game/resources.js';
import { UPGRADES, UPGRADE_ORDER, RECIPES, level, nextUpgrade } from '../game/upgrades.js';
import { canInstall, updateReady, promptInstall, applyUpdate, onPwaChange } from '../pwa.js';
import { el } from './dom.js';
import { swatchStyle } from '../game/facts.js';
import { WONDERS } from '../world/wonders.js';
import { device, canFullscreen, toggleFullscreen } from '../core/device.js';

// have/need, same as the objective panel
function costHtml(state, cost) {
  return Object.entries(cost)
    .map(([k, v]) => {
      const have = k === 'data' ? state.data : state.count(k);
      const name = k === 'data' ? 'Data' : RESOURCES[k].name;
      const color = k === 'data' ? '#9fe8ff' : RESOURCES[k].color;
      return `<span class="cost ${have >= v ? 'ok' : 'short'}" style="--c:${color}"><i></i>${name} <em>${Math.min(have, v)}/${v}</em></span>`;
    })
    .join('');
}

function fmtPlayTime(seconds) {
  const m = Math.floor(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

const CONTROLS = [
  ['On foot', [['WASD', 'Move'], ['Mouse', 'Look'], ['Shift', 'Sprint'], ['Space', 'Jump, hold for jetpack'], ['Left Mouse', 'Mine'], ['Right Mouse', 'Analyze plants and creatures'], ['F', 'Scanner pulse'], ['E', 'Interact, board ship'], ['R', 'Recharge shield with Lumen']]],
  ['In the ship', [['Mouse', 'Steer'], ['W / S', 'Throttle'], ['A / D', 'Roll'], ['Shift', 'Boost'], ['Space', 'Pulse drive, away from planets'], ['E', 'Land, exit ship'], ['Left Mouse', 'Mining lasers'], ['F', 'Planet scan'], ['Wheel', 'Camera distance']]],
  ['Anywhere', [['Tab', 'Inventory'], ['J', 'Journal'], ['G', 'Galaxy map'], ['P', 'Photo mode'], ['Esc', 'Pause']]],
  ['Photo mode', [['WASD', 'Fly'], ['R / F', 'Up, down'], ['Q / E', 'Roll'], ['Shift', 'Fast'], ['Wheel', 'Speed'], ['Z / X', 'Time of day'], ['1 / 2', 'Zoom'], ['B', 'Focus blur'], ['V', 'Filter'], ['H', 'Hide ship'], ['Enter', 'Save a screenshot'], ['P', 'Back to the game']]],
];

// same layout as CONTROLS, the first column is a button or a part of the screen
const TOUCH_CONTROLS = [
  ['On foot', [['Left side', 'Move, push all the way to sprint'], ['Right side', 'Look'], ['Jump', 'Hold for jetpack'], ['Mine', 'Hold, drag it to aim'], ['Analyze', 'Hold on plants and creatures'], ['Scan', 'Scanner pulse']]],
  ['In the ship', [['Right side', 'Steer, the further you drag the faster it turns'], ['Left side', 'Throttle and roll'], ['Boost', 'Hold for speed'], ['Pulse', 'Pulse drive, away from planets'], ['Fire', 'Mining lasers, shows up on asteroids'], ['Pinch', 'Camera distance']]],
  ['Anywhere', [['Top right', 'Galaxy map, inventory, photo mode and pause'], ['Pop-up buttons', 'Land, board, orbit and interact when you can']]],
];

const SETTINGS = [
  ['sensitivity', 'Look sensitivity', 'range', 0.3, 2.5, 0.05, (v) => v.toFixed(2)],
  ['invertY', 'Invert look Y', 'checkbox'],
  ['quality', 'Graphics', 'range', 0, 2, 1, (v) => ['Low', 'Medium', 'High'][v]],
  ['renderScale', 'Render scale', 'range', 0.5, 1, 0.05, (v) => `${Math.round(v * 100)}%`],
  ['autoScale', 'Adaptive resolution', 'checkbox'],
  ['shadows', 'Shadows', 'checkbox'],
  ['ao', 'Ambient occlusion', 'checkbox'],
  ['dof', 'Depth of field', 'checkbox'],
  ['volume', 'Volume', 'range', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`],
  ['music', 'Music', 'range', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`],
];

// hover text for the settings that aren't obvious from the name
const SETTING_TIPS = {
  quality: 'Low and Medium draw less detail in the distance and use cheaper sky and shadows.',
  renderScale: 'Resolution of the 3D view. Lower runs faster, the HUD stays sharp.',
  autoScale: 'Lowers the render scale on its own while the frame rate is low.',
  ao: 'Soft shading in corners and under plants. Fairly expensive.',
  dof: 'Softens the distance a little while on foot.',
};

export class Menus {
  constructor(root, game) {
    this.game = game;
    this.root = el('div', 'menus', root);
    this.current = null;
    this.buildTitle();
    onPwaChange(() => this.renderPwa());
    this.renderPwa();
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
    const btns = el('div', 'title-buttons', inner);
    this.btnContinue = el('button', 'btn primary', btns, 'Continue');
    this.btnNew = el('button', 'btn', btns, 'New Game');
    this.btnControls = el('button', 'btn', btns, 'Controls');
    this.saveInfo = el('div', 'save-info', inner);
    const seedRow = el('label', 'seed-row', inner);
    el('span', '', seedRow, 'Galaxy seed');
    this.seedInput = el('input', 'seed-input', seedRow);
    this.seedInput.inputMode = 'numeric';
    this.seedInput.maxLength = 9;
    this.seedInput.value = String(Math.floor(Math.random() * 90000) + 10000);
    this.titleControls = el('div', 'controls-panel', inner);
    this.titleControls.style.display = 'none';
    this.titleControls.innerHTML = this.controlsHtml();
    // iPhones can't go fullscreen from the page, only from the home screen
    const home = !canFullscreen() && !device.standalone ? ' Add it to your home screen to play fullscreen.' : '';
    el('div', 'title-foot', t, `<span class="no-touch">Click the view to capture the mouse. Best with a mouse and keyboard.</span><span class="only-touch">Best played in landscape.${home}</span>`);
    const pwa = el('div', 'title-pwa', t);
    this.btnInstall = el('button', 'btn small', pwa, 'Install app');
    this.btnUpdate = el('button', 'btn small primary', pwa, 'Restart to update');
    this.btnInstall.onclick = () => promptInstall();
    this.btnUpdate.onclick = () => applyUpdate();
    // browsers only allow audio after a user gesture, so any click starts the music
    t.addEventListener('pointerdown', () => this.game.audio.init());
    this.btnContinue.onclick = () => this.game.startFromTitle('continue');
    this.btnNew.onclick = () => this.newJourney();
    this.seedInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.newJourney();
    });
    this.btnControls.onclick = () => {
      const show = this.titleControls.style.display === 'none';
      this.titleControls.style.display = show ? '' : 'none';
      this.btnControls.classList.toggle('on', show);
      t.classList.toggle('ctl-open', show);
    };
  }

  // only shown when the browser offers an install or a new version is waiting
  renderPwa() {
    this.btnInstall.style.display = canInstall() ? '' : 'none';
    this.btnUpdate.style.display = updateReady() ? '' : 'none';
  }

  // save is null or { system, playTime } for the line under the buttons
  showTitle(save) {
    this.save = save;
    this.btnContinue.style.display = save ? '' : 'none';
    this.btnNew.classList.toggle('primary', !save);
    this.resetNewJourney();
    this.open('title');
  }

  // There is only one save slot, so with a save the first click asks first
  newJourney() {
    if (this.save && !this.confirmNew) {
      this.confirmNew = true;
      this.btnNew.textContent = 'Replace save?';
      this.btnNew.classList.add('warn');
      this.saveInfo.textContent = `${device.touch ? 'Tap' : 'Click'} again to start over. This deletes your current save.`;
      this.saveInfo.classList.add('warn');
      clearTimeout(this.confirmT);
      this.confirmT = setTimeout(() => this.resetNewJourney(), 5000);
      return;
    }
    this.resetNewJourney();
    const seed = parseInt(this.seedInput.value.replace(/\D/g, ''), 10) || 1337;
    this.game.startFromTitle('new', seed);
  }

  resetNewJourney() {
    clearTimeout(this.confirmT);
    this.confirmNew = false;
    this.btnNew.textContent = 'New Game';
    this.btnNew.classList.remove('warn');
    this.saveInfo.classList.remove('warn');
    this.saveInfo.textContent = this.save ? `${this.save.system} · ${fmtPlayTime(this.save.playTime)} played` : '';
  }

  // both sets are in the page, CSS shows the one for the current input
  controlsHtml() {
    const group = (cls) => ([name, rows]) => `<div class="ctl-group ${cls}"><h4>${name}</h4><div class="ctl-grid">${rows.map(([k, d]) => `<kbd>${k}</kbd><span>${d}</span>`).join('')}</div></div>`;
    return CONTROLS.map(group('no-touch')).join('') + TOUCH_CONTROLS.map(group('only-touch')).join('');
  }

  // ---------------------------------------------------------------- pause
  buildPause() {
    const p = el('div', 'screen pause-screen', this.root);
    const panel = el('div', 'panel pause', p);
    const main = el('div', 'pause-main', panel);
    el('h2', '', main, 'Paused');
    const resume = el('button', 'btn primary', main, 'Resume');
    const save = el('button', 'btn', main, 'Save');
    const quit = el('button', 'btn', main, 'Save and quit to title');
    if (canFullscreen()) {
      const fs = el('button', 'btn only-touch', main, 'Fullscreen');
      fs.onclick = () => toggleFullscreen();
      document.addEventListener('fullscreenchange', () => (fs.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen'));
    }
    el('h4', '', main, 'Settings');
    const settings = el('div', 'settings', main);
    settings.innerHTML = SETTINGS.map(([k, label, type, min, max, step]) => {
      const tip = SETTING_TIPS[k] ? ` title="${SETTING_TIPS[k]}"` : '';
      return type === 'range'
        ? `<label${tip}>${label}<input type="range" min="${min}" max="${max}" step="${step}" data-k="${k}"><output data-k="${k}"></output></label>`
        : `<label${tip}>${label}<input type="checkbox" data-k="${k}"></label>`;
    }).join('');
    this.settingsEl = settings;
    const controls = el('div', 'controls-panel small', panel);
    controls.innerHTML = this.controlsHtml();
    resume.onclick = () => this.game.closeMenus();
    this.tapOutside(p);
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
      this.showSettingValue(k, v);
    });
  }

  // With touch, tapping the dimmed area around a panel closes it. The mouse
  // doesn't get this, a stray click there would resume the game.
  tapOutside(screen) {
    screen.addEventListener('click', (e) => {
      if (device.touch && e.target === screen) this.game.closeMenus();
    });
  }

  showSettingValue(k, v) {
    const fmt = SETTINGS.find((s) => s[0] === k)[6];
    const out = this.settingsEl.querySelector(`output[data-k="${k}"]`);
    if (fmt && out) out.textContent = fmt(v);
  }

  syncSettings(s) {
    for (const inp of this.settingsEl.querySelectorAll('input')) {
      const k = inp.dataset.k;
      if (inp.type === 'checkbox') inp.checked = !!s[k];
      else {
        inp.value = s[k];
        this.showSettingValue(k, s[k]);
      }
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
    el('button', 'inv-close', head, '<kbd>Tab</kbd> close').onclick = () => this.game.closeMenus();
    this.tapOutside(s);
    this.invBody = el('div', 'inv-body', panel);
    this.tab = 'cargo';
    this.invBody.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      if (b.dataset.act === 'craft') this.game.craft(b.dataset.id);
      if (b.dataset.act === 'upgrade') this.game.buyUpgrade(b.dataset.id);
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
    const st = this.game.state;
    const species = Object.values(st.species);
    const worlds = Object.values(st.discoveries);
    const wonders = st.wonders || [];
    const stat = (n, what) => `<div class="j-stat"><b>${n}</b><span>${what}</span></div>`;
    let h = `<div class="j-stats">${stat(st.visited.length, 'Systems')}${stat(worlds.length, 'Worlds')}${stat(species.length, 'Species')}${stat(wonders.length, 'Landmarks')}${stat(st.lore.length, 'Logs')}${stat(fmtPlayTime(st.playTime), 'Played')}</div>`;
    h += '<div class="journal"><div class="j-col"><h4>Worlds</h4>';
    for (const w of [...worlds].reverse()) {
      // saves from before the atlas have no colors
      const colors = w.colors || ['#9aa4b4', '#5c6474', '#262b36'];
      const chips = [];
      if (w.life) chips.push(`<i class="${(w.found || 0) >= w.life ? 'done' : ''}">Life ${w.found || 0}/${w.life}</i>`);
      if (w.wonderTotal) chips.push(`<i class="${(w.wonders || 0) >= w.wonderTotal ? 'done' : ''}">Landmarks ${w.wonders || 0}/${w.wonderTotal}</i>`);
      h += `<div class="j-world"><div class="j-orb" style="${swatchStyle(colors, w.gas)}"></div><div class="j-world-text"><b>${w.name}</b><span>${w.type}${w.moon ? ' moon' : ''} · ${w.system}</span>${chips.length ? `<div class="j-chips">${chips.join('')}</div>` : ''}</div></div>`;
    }
    h += '</div><div class="j-col"><h4>Landmarks</h4>';
    for (const w of [...wonders].reverse()) h += `<div class="j-row"><b>${w.name}</b><span>${w.kind === 'comet' ? 'Comet' : WONDERS[w.kind] ? WONDERS[w.kind].label : 'Landmark'} · ${w.planet}</span></div>`;
    if (!wonders.length) h += '<div class="j-empty">Walk or fly close to a landmark to log it.</div>';
    h += '<h4>Species</h4>';
    for (const sp of [...species].reverse()) h += `<div class="j-row"><b>${sp.name}</b><span>${sp.label ? `${sp.label} · ` : ''}${sp.planet}</span></div>`;
    if (!species.length) h += `<div class="j-empty">Hold ${device.touch ? 'Analyze' : 'Right Mouse'} on a plant or creature to catalogue it.</div>`;
    h += '</div><div class="j-col"><h4>Logs</h4>';
    for (const l of [...st.lore].reverse()) h += `<div class="j-lore"><div class="j-lore-title">${l.title}</div>${l.text.map((p) => `<p>${p}</p>`).join('')}</div>`;
    if (!st.lore.length) h += '<div class="j-empty">Messages from Echo Stones, ruins, wrecks and spires are saved here.</div>';
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
    this.dlgBtn = el('button', 'btn primary', panel, 'Continue');
    this.dlgBtn.onclick = () => this.game.closeMenus();
  }

  showDialog(title, paragraphs, reward) {
    this.dlgTitle.textContent = title;
    this.dlgBody.innerHTML = paragraphs.map((p) => `<p>${p}</p>`).join('');
    this.dlgReward.innerHTML = reward || '';
    this.open('dialog');
    // so Enter or Space closes it without reaching for the mouse
    this.dlgBtn.focus({ preventScroll: true });
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
    // a button left focused on a hidden screen would still take Space and Enter
    if (this.root.contains(document.activeElement)) document.activeElement.blur();
    this.current = name;
    this.root.dataset.open = name || '';
    if (name === 'inventory') this.showTab(this.tab);
  }

  close() {
    this.open(null);
  }
}
