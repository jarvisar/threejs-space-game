import * as THREE from 'three';
import { Pipeline, LAYER_MAIN } from '../render/pipeline.js';
import { env } from '../render/materials.js';
import { Effects } from '../render/effects.js';
import { WarpTunnel } from '../render/warp.js';
import { SpaceDust } from '../render/spaceDust.js';
import { AsteroidField } from '../world/asteroids.js';
import { buildWarmup, disposeWarmup } from '../render/warmup.js';
import { Galaxy, STAR_CLASSES, CORE_INDEX } from '../gen/galaxy.js';
import { generateSystem, generateCoreSystem } from '../gen/system.js';
import { StarSystem } from '../world/starSystem.js';
import { Planet, findLand, surfaceNormal } from '../world/planet.js';
import { Sky } from '../world/sky.js';
import { Weather } from '../world/weather.js';
import { WorkerPool } from '../world/workerPool.js';
import { POI_INFO } from '../world/pois.js';
import { faunaSpecies } from '../world/fauna.js';
import { planetSpecies } from '../gen/flora.js';
import { Input } from '../core/input.js';
import { Ship } from '../player/ship.js';
import { Walker } from '../player/walker.js';
import { CameraRig } from '../player/cameraRig.js';
import { Multitool } from '../player/multitool.js';
import { HUD, fmtDist } from '../ui/hud.js';
import { Menus } from '../ui/menus.js';
import { GalaxyMap } from '../ui/galaxyMap.js';
import { AudioEngine } from '../audio/audio.js';
import { GameState } from './state.js';
import { Surface } from './surface.js';
import { Story } from './story.js';
import { stats, level, UPGRADES, RECIPES } from './upgrades.js';
import { RESOURCES } from './resources.js';
import { RESONANCES, ENDING, echoText } from './lore.js';
import { DebugCam } from './debugCam.js';
import { RNG } from '../core/rng.js';
import { smoothstep } from '../core/math.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

const SETTINGS_KEY = 'starsong-settings';
const HAZARD_LABEL = { heat: 'Heat', cold: 'Cold', toxic: 'Toxic', radiation: 'Radiation', none: 'Shield' };
const HAZARD_COLOR = { heat: '255,110,40', cold: '90,170,255', toxic: '150,255,60', radiation: '230,255,60' };

export class Game {
  constructor(container, uiRoot) {
    this.container = container;
    this.params = new URLSearchParams(location.search);
    this.time = 0;
    this.frame = 0;
    this.paused = true;
    this.screen = 'title';
    this.settings = this.loadSettings();

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance',
      stencil: false,
      preserveDrawingBuffer: this.params.has('capture'),
    });
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1e9);
    this.camera.layers.enable(LAYER_MAIN);
    this.scene.add(this.camera);

    this.sunLight = new THREE.DirectionalLight(0xffffff, 3.0);
    this.sunLight.layers.enableAll();
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    const sc = this.sunLight.shadow.camera;
    sc.left = -60;
    sc.right = 60;
    sc.top = 60;
    sc.bottom = -60;
    sc.near = 1;
    sc.far = 900;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.05;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // headlamp on foot, landing lights in the ship. Always in the scene so
    // switching it on at night doesn't recompile every material
    this.lamp = new THREE.SpotLight(0xfff1dc, 0, 90, 0.6, 0.6, 1.5);
    this.lamp.layers.enableAll();
    this.scene.add(this.lamp);
    this.scene.add(this.lamp.target);
    this.lampK = 0;

    this.pipeline = new Pipeline(this.renderer, this.scene, this.camera);
    if (this.params.has('msaa')) this.pipeline.samples = parseInt(this.params.get('msaa'), 10);
    this.pool = new WorkerPool(Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 2)));

    this.input = new Input(this.renderer.domElement);
    this.hud = new HUD(uiRoot);
    this.menus = new Menus(uiRoot, this);
    this.map = new GalaxyMap(this, uiRoot);
    this.rig = new CameraRig();
    this.debugCam = new DebugCam();
    this.audio = new AudioEngine();
    this.effects = new Effects();
    this.surface = new Surface(this);
    this.story = new Story(this);
    this.tool = new Multitool(this.camera);
    this.tunnel = new WarpTunnel(this.camera);
    this.weather = new Weather();
    this.dust = new SpaceDust(this.scene);
    this.fields = [];
    this.ship = null;
    this.warp = null;
    this.stepPhase = 0;
    this.gainBuffer = new Map();
    this.lastSave = 0;

    this.applySettings();
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    this.renderer.domElement.addEventListener('click', () => {
      this.audio.init();
      if (this.screen === 'play' && !this.menuOpen) this.input.lock();
    });
    document.addEventListener('pointerlockchange', () => {
      const locked = !!document.pointerLockElement;
      if (locked && this.awaitLock && this.screen === 'play' && !this.menuOpen) {
        this.awaitLock = false;
        this.paused = false;
        this.hud.clearMessage();
      }
      // Esc releases pointer lock without a keydown, treat that as pause
      if (locked || this.screen !== 'play' || this.menuOpen || this.warp || this.awaitLock) return;
      if (this.photo) this.exitPhoto();
      this.openMenu('pause');
    });
    window.addEventListener('beforeunload', () => {
      if (this.screen === 'play' && !this.warp) this.saveGame();
    });
    window.__game = this;
  }

  // ---------------------------------------------------------------- settings

  loadSettings() {
    const d = { sensitivity: 1, invertY: false, renderScale: 1, shadows: true, volume: 0.8, music: 0.55 };
    try {
      return Object.assign(d, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
    } catch {
      return d;
    }
  }

  setSetting(k, v) {
    this.settings[k] = v;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // storage blocked, settings just won't persist
    }
    this.applySettings();
    if (k === 'renderScale') this.onResize();
  }

  applySettings() {
    const s = this.settings;
    this.input.sensitivity = s.sensitivity;
    this.input.invertY = s.invertY;
    this.audio.volume = s.volume;
    this.audio.musicVolume = s.music;
    this.sunLight.castShadow = s.shadows;
  }

  onResize() {
    const scale = parseFloat(this.params.get('scale') || '1') * (this.settings.renderScale || 1);
    const pr = Math.min(window.devicePixelRatio || 1, 2) * scale;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pipeline.setSize(Math.floor(w * pr), Math.floor(h * pr));
    if (this.sky) this.sky.setPixelRatio(pr);
    this.viewW = w;
    this.viewH = h;
  }

  // ---------------------------------------------------------------- flow

  // title backdrop: the start system of the saved or default galaxy
  showTitle() {
    const saved = GameState.load();
    this.state = saved || new GameState(1337);
    this.setupGalaxy();
    const idx = saved ? saved.systemIndex : this.galaxy.story.start;
    this.loadSystem(idx);
    this.screen = 'title';
    this.paused = true;
    this.hud.clearBanners();
    this.hud.setVisible(false);
    this.tool.setVisible(false);
    this.titleBody = this.system.bodies.find((b) => b.def.rings) || this.system.bodies[0];
    this.menus.showTitle(saved ? { system: this.systemDef.name, playTime: saved.playTime } : null);
    this.menus.syncSettings(this.settings);
    this.menuOpen = 'title';
  }

  startFromTitle(kind, seed) {
    this.audio.init();
    this.audio.click();
    this.menus.setFade(1);
    setTimeout(() => {
      if (kind === 'continue') {
        const s = GameState.load();
        if (s) {
          this.state = s;
          this.setupGalaxy();
          this.enterSystem(s.systemIndex, 'load');
        } else kind = 'new';
      }
      if (kind === 'new') {
        GameState.clear();
        this.state = new GameState(seed || 1337);
        this.setupGalaxy();
        this.enterSystem(this.galaxy.story.start, 'spawn');
      }
      this.screen = 'play';
      this.menus.close();
      this.menuOpen = null;
      this.paused = false;
      this.hud.setVisible(true);
      this.input.lock();
      this.onStage(this.state.story.stage, true);
      this.warmupShaders();
      setTimeout(() => this.menus.setFade(0), 400);
    }, 650);
  }

  // compile shaders for things that only appear mid-game while the screen is black
  warmupShaders() {
    if (this.warmedUp) return;
    this.warmedUp = true;
    const g = buildWarmup();
    g.position.set(0, 0, -4);
    this.camera.add(g);
    // compile against the HDR target, programs built for the canvas use a
    // different output color space and would be compiled again anyway
    this.renderer.setRenderTarget(this.pipeline.rtScene);
    this.renderer.compile(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    // leave it for a few frames so the shadow depth variants compile too
    this.warm = { group: g, frames: 4 };
  }

  quitToTitle() {
    this.saveGame();
    // leave 'play' first so closing the menu doesn't grab the mouse again
    this.screen = 'title';
    this.awaitLock = false;
    this.pendingEnding = 0;
    this.hud.clearMessage();
    this.closeMenus();
    this.surface.release();
    this.input.unlock();
    this.showTitle();
  }

  setupGalaxy() {
    if (!this.galaxy || this.galaxy.seed !== this.state.seed) {
      this.galaxy = new Galaxy(this.state.seed);
      if (this.sky) {
        this.scene.remove(this.sky.group);
        this.sky.dispose();
      }
      this.sky = new Sky(this.galaxy);
      this.sky.setPixelRatio(this.renderer.getPixelRatio());
      this.scene.add(this.sky.group);
      this.map.setGalaxy(this.galaxy);
      // every galaxy gets its own paint job
      if (this.ship) {
        this.scene.remove(this.ship.model.root);
        this.ship.model.root.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
        this.ship = null;
      }
      this.ship = new Ship(shipColors(this.state.seed));
      this.scene.add(this.ship.model.root);
      if (!this.walker) this.walker = new Walker();
    }
  }

  loadSystem(index) {
    this.surface.release();
    this.effects.clear();
    this.weather.setPlanet(null);
    if (this.system) this.system.dispose();
    this.state.systemIndex = index;
    this.systemDef = index === CORE_INDEX ? generateCoreSystem(this.galaxy) : generateSystem(this.galaxy, index, this.galaxy.story);
    this.system = new StarSystem(this.systemDef, this.pool, this.scene);
    this.system.updateRotations(this.state.worldTime);
    this.sky.setSystem(index);
    for (const f of this.fields) {
      this.scene.remove(f.group);
      f.dispose();
    }
    if (!this.state.asteroids) this.state.asteroids = {};
    this.fields = this.systemDef.asteroidFields.map((d, i) => {
      const key = `${index}:${i}`;
      const f = new AsteroidField(d, new Set(this.state.asteroids[key] || []));
      f.key = key;
      f.name = 'Asteroid Field';
      this.scene.add(f.group);
      return f;
    });
    const s = this.systemDef.star;
    this.sunLight.color.set(s.light);
    this.sunLight.intensity = 4.2 * s.intensity;
    env.uSunColor.value.set(s.light).multiplyScalar(s.intensity);
    this.pipeline.atmoUniforms.uSunColor.value.set(s.light);
    this.ship.frame = null;
    this.walker.frame = null;
  }

  enterSystem(index, arrival) {
    this.loadSystem(index);
    this.applyStats();
    if (arrival === 'spawn') this.spawnOnPlanet(this.system.bodies[0]);
    else if (arrival === 'load' && this.state.player) this.restorePlayer(this.state.player);
    else this.arriveFromWarp();
    if (index >= 0) {
      const first = this.state.markVisited(index);
      if (first && arrival !== 'spawn') this.addData(25, 'New system');
      this.hud.banner(this.systemDef.name, `${STAR_CLASSES[this.systemDef.cls].label}${first && arrival !== 'spawn' ? ' · New system' : ''}`);
    }
    this.lastSave = this.time;
  }

  spawnOnPlanet(planet) {
    const sun = planet.sunDirLocal();
    const later = new THREE.Vector3();
    planet.updateRotation(this.state.worldTime + 60);
    planet.sunDirLocal(later);
    planet.updateRotation(this.state.worldTime);
    // the player starts a few meters to the side of the ship
    const standFor = (d) => {
      const heading = sun.clone().projectOnPlane(d).normalize();
      const right = new THREE.Vector3().crossVectors(heading, d).normalize();
      const dir = d.clone().multiplyScalar(planet.radius).addScaledVector(right, 13).addScaledVector(heading, -9).normalize();
      return { heading, dir };
    };
    // seeded so the same galaxy seed always starts in the same spot
    const rng = new RNG(this.state.seed ^ 0x51a7);
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 900; i++) {
      const z = rng.range(-0.6, 0.6);
      const t = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(1 - z * z);
      const d = new THREE.Vector3(r * Math.cos(t), z, r * Math.sin(t));
      const h = planet.heightAt(d);
      if (h < 6) continue;
      const elev = d.dot(sun);
      const rising = d.dot(later) - elev;
      if (rising <= 0 || elev < 0.3) continue;
      const flat = surfaceNormal(planet, d, 6).dot(d);
      if (flat < 0.97) continue;
      // otherwise the first view can be a wall of hillside
      const stand = standFor(d).dir;
      if (Math.abs(planet.heightAt(stand) - h) > 2 || surfaceNormal(planet, stand, 6).dot(stand) < 0.97) continue;
      const score = -Math.abs(elev - 0.5) * 4 - Math.max(0, h - 60) * 0.01 + flat * 2 + rng.range(0, 0.1);
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }
    if (!best) best = findLand(planet, sun.clone());
    const { heading, dir: standDir } = standFor(best);
    this.ship.placeLanded(planet, best, heading.clone().negate());
    // face the ship with the sunrise off to one side
    const toShip = this.ship.pos.clone().sub(standDir.clone().multiplyScalar(planet.radius)).projectOnPlane(standDir).normalize();
    this.walker.place(planet, standDir, toShip.lerp(heading, 0.6).normalize());
    this.setMode('foot');
  }

  arriveFromWarp() {
    const bodies = this.system.bodies;
    const target = bodies.find((b) => b.def.spire) || bodies.find((b) => b.def.kind === 'rocky' && b.def.atmosphere) || bodies[0];
    const dir = target.position.clone().normalize();
    const side = new THREE.Vector3(0, 1, 0).cross(dir).normalize();
    const dist = target.atmoRadius * 3.5 + 9000;
    const pos = target.position.clone().addScaledVector(dir, -dist * 0.6).addScaledVector(side, dist * 0.8);
    this.ship.frame = null;
    this.ship.pos.copy(pos);
    const m = new THREE.Matrix4().lookAt(pos, target.position, new THREE.Vector3(0, 1, 0));
    this.ship.quat.setFromRotationMatrix(m);
    this.ship.aim.copy(this.ship.quat);
    this.ship.vel.set(0, 0, -600).applyQuaternion(this.ship.quat);
    this.ship.state = 'flying';
    this.ship.throttle = 0.4;
    this.ship.pulse = false;
    this.setMode('ship');
  }

  restorePlayer(p) {
    // look the body up by id, indices can shift if generation changes between versions
    let body = null;
    if (p.frameId) body = this.system.bodies.find((b) => b.def.id === p.frameId) || null;
    else if (p.frame >= 0) body = this.system.bodies[p.frame] || null;
    const onSurface = p.mode === 'foot' || p.shipState === 'landed';
    if ((p.frameId && !body) || (onSurface && !(body instanceof Planet))) {
      this.arriveFromWarp();
      return;
    }
    this.ship.frame = body;
    this.ship.pos.fromArray(p.shipPos);
    this.ship.quat.fromArray(p.shipQuat);
    this.ship.aim.copy(this.ship.quat);
    this.ship.vel.set(0, 0, 0);
    this.ship.state = p.shipState === 'landed' && body ? 'landed' : 'flying';
    this.ship.gear = this.ship.state === 'landed' ? 1 : 0;
    this.ship.throttle = 0;
    this.ship.pulse = false;
    if (this.ship.state === 'landed') {
      // re-seat on the ground in case the terrain moved since the save
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.ship.quat);
      this.ship.placeLanded(body, this.ship.pos.clone().normalize(), fwd);
    }
    if (p.mode === 'foot' && body) {
      this.walker.frame = body;
      this.walker.pos.fromArray(p.walkerPos);
      this.walker.heading.fromArray(p.walkerHeading);
      this.walker.vel.set(0, 0, 0);
      // make sure we are not under the ground after terrain tweaks
      const dir = this.walker.pos.clone().normalize();
      this.walker.pos.copy(dir).multiplyScalar(Math.max(this.walker.pos.length(), this.walker.floorAt(dir)));
      this.setMode('foot');
    } else {
      this.setMode('ship');
    }
  }

  snapshotPlayer() {
    const s = this.ship;
    return {
      mode: this.mode,
      frame: s.frame ? s.frame.index : -1,
      frameId: s.frame ? s.frame.def.id : null,
      shipPos: s.pos.toArray(),
      shipQuat: s.quat.toArray(),
      shipState: s.state === 'landed' ? 'landed' : 'flying',
      walkerPos: this.walker.pos.toArray(),
      walkerHeading: this.walker.heading.toArray(),
    };
  }

  saveGame() {
    if (!this.state || this.screen !== 'play') return false;
    this.flushGains();
    this.state.player = this.snapshotPlayer();
    this.lastSave = this.time;
    return this.state.save();
  }

  setMode(mode) {
    if (this.mode && this.mode !== mode) this.rig.beginTransition(0.8);
    this.mode = mode;
    this.hud.setMode(mode);
    this.tool.setVisible(mode === 'foot' && this.screen === 'play');
  }

  applyStats() {
    const s = stats(this.state);
    this.stats = s;
    this.state.capacity = s.capacity;
    if (this.ship) {
      this.ship.stats.speed = 180 * s.shipSpeed;
      this.ship.stats.boost = 480 * s.shipSpeed;
      this.ship.stats.atmoSpeed = 120 * s.shipSpeed;
      this.ship.stats.atmoBoost = 300 * s.shipSpeed;
      this.ship.stats.pulse = 120000 * s.pulseSpeed;
      this.walker.stats.jetTime = s.jetTime;
      this.walker.stats.jetAccel = s.jetAccel;
    }
  }

  // ---------------------------------------------------------------- menus

  openMenu(name) {
    if (this.screen !== 'play') return;
    this.menuOpen = name;
    this.menuOpenedAt = performance.now();
    this.awaitLock = false;
    this.hud.clearMessage();
    this.paused = true;
    this.input.unlock();
    if (name === 'map') {
      this.map.show();
      this.menus.close();
      this.hud.setVisible(false);
    } else {
      this.menus.open(name);
      if (name === 'pause') this.menus.syncSettings(this.settings);
    }
    this.audio.click();
  }

  closeMenus() {
    if (this.menuOpen === 'map') {
      this.map.hide();
      this.hud.setVisible(true);
    }
    this.menus.close();
    this.menuOpen = null;
    if (this.screen === 'play') this.resume();
  }

  // Unpause once the mouse is captured again. Chrome refuses pointer lock
  // after a keyboard-only close (Esc), so the game waits for a click instead
  // of running with a dead mouse.
  resume() {
    if (document.pointerLockElement || this.params.has('capture')) {
      this.paused = false;
      this.awaitLock = false;
      return;
    }
    this.awaitLock = true;
    this.paused = true;
    this.input.lock();
    setTimeout(() => {
      if (this.awaitLock && !this.menuOpen && this.screen === 'play') this.hud.message('Click to resume', 600000);
    }, 250);
  }

  // ---------------------------------------------------------------- inventory ops

  gain(res, n, quiet) {
    const added = this.state.add(res, n);
    if (added < n) this.warnFull(res);
    if (added <= 0) return 0;
    this.gainBuffer.set(res, (this.gainBuffer.get(res) || 0) + added);
    if (!quiet) this.flushGains();
    this.audio.pickup(this.pickupN = (this.pickupN || 0) + 1);
    return added;
  }

  // mining checks this first so nothing gets destroyed for an empty reward
  isFull(res) {
    if (this.state.count(res) < this.state.cap(res)) return false;
    this.warnFull(res);
    return true;
  }

  warnFull(res) {
    if (this.time - (this.fullWarnAt ?? -Infinity) < 3) return;
    this.fullWarnAt = this.time;
    this.hud.message(`${RESOURCES[res].name} storage full`);
  }

  flushGains() {
    for (const [res, n] of this.gainBuffer) {
      const r = RESOURCES[res];
      this.hud.notify(`+${n} <span class="hl">${r.name}</span>`, r.color);
    }
    this.gainBuffer.clear();
  }

  addData(n, why) {
    this.state.data += n;
    this.hud.notify(`+${n} Data${why ? ` · ${why}` : ''}`, '#9fe8ff');
  }

  craft(id) {
    const r = RECIPES.find((x) => x.id === id);
    if (!r || (id === 'lens' && this.state.story.flags.lens) || !this.state.spend(r.cost)) return this.audio.error();
    if (id === 'warpcell') this.state.warpCells++;
    if (id === 'shield') this.state.suit.shield = 1;
    if (id === 'lens') this.state.story.flags.lens = true;
    this.audio.craft();
    this.hud.notify(`Crafted ${r.name}`, '#ffb45e');
  }

  buyUpgrade(id) {
    const lv = level(this.state, id);
    const next = UPGRADES[id].levels[lv - 1];
    if (!next || !this.state.spend(next.cost)) return this.audio.error();
    this.state.upgrades[id] = lv + 1;
    this.applyStats();
    this.audio.discovery();
    this.hud.notify(`Installed ${next.name}`, '#ffb45e');
    this.story.update();
  }

  rechargeShield() {
    const s = this.state.suit;
    if (s.shield > 0.95) return;
    if (this.state.count('lumen') < 10) {
      this.hud.message('Need 10 Lumen to recharge');
      return this.audio.error();
    }
    this.state.inventory.lumen -= 10;
    s.shield = Math.min(1, s.shield + 0.6);
    this.audio.craft();
    this.hud.notify('Hazard shield recharged', '#6fd0ff');
  }

  discoverSpecies(sp, planet) {
    this.state.species[sp.id] = { name: sp.name, label: sp.label, planet: planet.def.name };
    const world = this.state.discoveries[planet.def.id];
    if (world) world.found = (world.found || 0) + 1;
    this.audio.discovery();
    this.hud.notify(`Catalogued <span class="hl">${sp.name}</span>`, '#7dffb0');
    this.addData(sp.fauna ? 30 : 12 + Math.floor(Math.random() * 10), sp.fauna ? 'New creature' : 'New species');
    const all = planet.species.filter((s) => s.plant).concat(planet.faunaSpecies || []);
    const known = all.filter((s) => this.state.species[s.id]).length;
    if (known === all.length && all.length > 0) {
      this.hud.banner('Life survey complete', planet.def.name);
      this.addData(80, 'Survey bonus');
    }
  }

  discoverBody(body) {
    const d = body.def;
    if (this.state.discoveries[d.id]) return;
    // how many plants and creatures there are to catalogue, for the journal
    const life = d.kind === 'rocky' ? planetSpecies(d).filter((s) => s.plant).length + faunaSpecies(d).length : 0;
    this.state.discoveries[d.id] = { name: d.name, type: d.typeLabel, system: this.systemDef.name, life, found: 0 };
    this.hud.banner(d.name, `${d.typeLabel}${d.isMoon ? ' moon' : ''} discovered`);
    this.addData(15, 'New world');
    this.audio.discovery();
  }

  onStage(stage, silent) {
    if (!silent) this.audio.discovery();
    const o = this.story.objective();
    if (o && !silent) this.hud.message(o.title, 2500);
    this.saveSoon = true;
  }

  // ---------------------------------------------------------------- loop

  start() {
    this.last = performance.now();
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.tick(dt);
    };
    loop();
  }

  // ?prof keeps worst-case ms per section of the frame in window.__game.prof
  profMark(name) {
    if (!this.prof) return;
    const t = performance.now();
    const d = t - this.profT;
    this.prof[name] = Math.max(this.prof[name] || 0, d);
    this.profT = t;
  }

  tick(dt) {
    if (this.params.has('prof')) {
      this.prof = this.prof || {};
      this.profT = performance.now();
    }
    this.time += dt;
    this.frame++;
    env.uTime.value = this.time;
    const input = this.input;
    input.enabled = !this.paused;
    this.handleGlobalKeys();

    if (this.screen === 'play' && !this.paused) {
      this.state.worldTime += dt;
      this.state.playTime += dt;
    } else if (this.screen === 'title') {
      this.state.worldTime += dt * 6;
    }
    this.system.updateRotations(this.state.worldTime);

    if (this.menuOpen === 'map') {
      this.map.render(dt, this.pipeline);
      this.audio.update(this.audioParams(dt));
      input.endFrame();
      return;
    }

    if (this.screen === 'title') {
      const b = this.titleBody;
      this.rig.orbitBody(b, dt, this.time, b.radius * 3.4 + (b.rings ? b.radius * 1.5 : 0), b.radius * 0.9);
    } else if (this.photo) {
      this.debugCam.update(dt, input);
      this.rig.frame = null;
      this.rig.worldPos.copy(this.debugCam.pos);
      this.rig.worldQuat.copy(this.debugCam.quat);
      this.rig.fov = 60;
    } else if (this.warp) {
      this.updateWarp(dt);
    } else if (!this.paused) {
      if (this.mode === 'ship') this.updateShipMode(dt);
      else this.updateFootMode(dt);
      this.story.update();
      this.updateDiscovery();
    } else {
      this.rig.finish(0);
    }
    this.profMark('player');

    const camWorld = this.rig.worldPos;
    const activeFrame = this.mode === 'foot' ? this.walker.frame : this.ship.frame;
    const activeLocal = this.mode === 'foot' ? this.walker.pos : this.ship.pos;
    if (this.screen === 'play' && !this.warp) this.surface.update(dt, activeFrame, activeLocal, this.time);
    this.profMark('surface');
    this.system.update(camWorld, this.time);
    this.profMark('lod');
    this.pool.pump();
    this.system.updateRender(camWorld);
    for (const f of this.fields) f.update(this.time, camWorld, camWorld);
    this.ship.updateModel(camWorld);
    this.effects.update(dt);
    const inSpace = this.screen === 'play' && this.mode === 'ship' && !this.photo;
    const dustAmt = inSpace && !this.warp ? 1 - (this.ship.inAtmo || 0) : 0;
    const wv = this.ship.frame ? _v.copy(this.ship.vel).applyQuaternion(this.ship.frame.quat) : this.ship.vel;
    this.dust.update(camWorld, wv, dustAmt);
    this.weather.update(dt, this.surface.planet, this.rig.frame === this.surface.planet ? this.rig.localPos : null, this.stormK || 0);

    this.camera.position.set(0, 0, 0);
    this.camera.quaternion.copy(this.rig.worldQuat);
    const fov = this.rig.fov * (this.visor ? 0.62 : 1);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 7);
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();

    this.profMark('misc');
    this.updateLighting(camWorld, dt);
    if (this.screen === 'play') this.updateHud(dt);
    this.audio.update(this.audioParams(dt));
    this.updateMood();
    this.profMark('hud');
    this.pipeline.setAtmospheres(this.system.atmosphereList());
    this.pipeline.render(this.time, this.shadowsActive);
    this.profMark('render');

    if (this.warm && --this.warm.frames <= 0) {
      this.camera.remove(this.warm.group);
      disposeWarmup(this.warm.group);
      this.warm = null;
    }
    this.checkEnding();
    if (this.screen === 'play' && !this.paused && !this.warp) {
      if (this.frame % 20 === 0) this.flushGains();
      if (this.saveSoon || this.time - this.lastSave > 45) {
        this.saveSoon = false;
        this.saveGame();
      }
    }
    input.endFrame();
  }

  handleGlobalKeys() {
    const k = this.input.pressed;
    if (this.screen !== 'play' || this.menuOpen === 'death') return;
    if (this.photo) {
      if (k.has('KeyP')) {
        this.exitPhoto();
        this.resume();
      } else if (k.has('Escape')) {
        this.exitPhoto();
        this.openMenu('pause');
      }
      return;
    }
    if (this.warp) return;
    // pointer lock release and the Esc keydown can both arrive, only act once
    if (k.has('Escape') && performance.now() - (this.menuOpenedAt || 0) > 300) {
      if (this.menuOpen) this.closeMenus();
      else this.openMenu('pause');
    }
    if (k.has('Tab')) {
      if (this.menuOpen === 'inventory') this.closeMenus();
      else if (!this.menuOpen) this.openMenu('inventory');
    }
    if (k.has('KeyJ') && !this.menuOpen) {
      this.openMenu('inventory');
      this.menus.showTab('journal');
    }
    if (k.has('KeyG')) {
      if (this.menuOpen === 'map') this.closeMenus();
      else if (!this.menuOpen) this.openMenu('map');
    }
    if (k.has('KeyP') && !this.menuOpen) this.enterPhoto();
    if (this.menuOpen === 'inventory' && this.frame % 10 === 0) this.menus.render();
  }

  // the world holds still while the free camera flies around
  enterPhoto() {
    this.photo = true;
    this.debugCam.pos.copy(this.rig.worldPos);
    this.debugCam.quat.copy(this.rig.worldQuat);
    this.debugCam.speed = 12;
    this.paused = true;
    this.hud.clearMessage();
    this.hud.setVisible(false);
    this.hud.showPhotoHint(true);
    this.tool.setVisible(false);
    this.input.lock();
  }

  exitPhoto() {
    this.photo = false;
    this.hud.setVisible(true);
    this.hud.showPhotoHint(false);
    this.tool.setVisible(this.mode === 'foot');
    this.rig.transition = null;
  }

  updateLighting(camWorld, dt) {
    env.uSunPos.value.copy(camWorld).negate();
    const sunDir = _v.copy(env.uSunPos.value).normalize();
    const focus = this.system.focus;
    this.shadowsActive = false;
    if (this.settings.shadows && focus instanceof Planet && focus.camDist - focus.radius < 450) {
      this.shadowsActive = true;
      const fwd = _v2.set(0, 0, -1).applyQuaternion(this.rig.worldQuat).multiplyScalar(18);
      this.sunLight.target.position.copy(fwd);
      this.sunLight.position.copy(fwd).addScaledVector(sunDir, 400);
    } else {
      this.sunLight.target.position.set(0, 0, 0);
      this.sunLight.position.copy(sunDir).multiplyScalar(-1e5);
    }
    this.sunLight.updateMatrixWorld();
    this.sunLight.target.updateMatrixWorld();

    if (focus) {
      env.uEnvCenter.value.copy(focus.group.position);
      env.uEnvRadius.value = focus.radius;
      if (focus.uniforms && focus.uniforms.sky) {
        const alt = focus.camDist - focus.radius;
        const atmoH = focus.atmoRadius - focus.radius;
        const k = 1 - smoothstep(atmoH, atmoH * 3, alt);
        // a little starlight fill in space so the ship never goes pitch black
        env.uEnvSky.value.setRGB(0.05, 0.055, 0.07).lerp(focus.uniforms.sky.value, k);
        env.uEnvGround.value.setRGB(0.02, 0.02, 0.025).lerp(focus.uniforms.ground.value, k);
      } else {
        env.uEnvSky.value.setRGB(0.05, 0.055, 0.07);
        env.uEnvGround.value.setRGB(0.02, 0.02, 0.025);
      }
    }
    env.uWind.value = 0.4 + (this.stormK || 0) * 1.6;
    this.updateLamp(dt);
  }

  updateLamp(dt) {
    let dark = 0;
    const frame = this.mode === 'foot' ? this.walker.frame : this.ship.frame;
    const local = this.mode === 'foot' ? this.walker.pos : this.ship.pos;
    if (this.screen === 'play' && frame instanceof Planet && local.length() - frame.radius < 1500) {
      const sunUp = frame.sunDirLocal(_v).dot(_v2.copy(local).normalize());
      dark = 1 - smoothstep(-0.1, 0.12, sunUp);
    }
    this.lampK += (dark - this.lampK) * Math.min(1, dt * 1.5);
    const lamp = this.lamp;
    if (this.lampK < 0.01 || this.photo) {
      lamp.intensity = 0;
      return;
    }
    const camInv = this.rig.worldQuat;
    if (this.mode === 'foot') {
      lamp.position.set(0.3, -0.2, 0).applyQuaternion(camInv);
      lamp.target.position.set(0, 0, -20).applyQuaternion(camInv);
      lamp.distance = 90;
      lamp.angle = 0.6;
      lamp.intensity = 45 * this.lampK;
    } else {
      const s = this.ship;
      const nose = s.worldPos(new THREE.Vector3()).sub(this.rig.worldPos);
      const q = s.worldQuat(new THREE.Quaternion());
      const fwd = new THREE.Vector3(0, -0.35, -1).normalize().applyQuaternion(q);
      lamp.position.copy(nose).addScaledVector(fwd, 4);
      lamp.target.position.copy(nose).addScaledVector(fwd, 60);
      lamp.distance = 260;
      lamp.angle = 0.5;
      lamp.intensity = 500 * this.lampK;
    }
    lamp.updateMatrixWorld();
    lamp.target.updateMatrixWorld();
  }

  updateMood() {
    if (!this.audio.ctx) return;
    if (this.screen === 'title') return this.audio.setMood('title', this.state.seed);
    const f = this.mode === 'foot' ? this.walker.frame : this.ship.frame;
    if (f && f.def.kind === 'rocky') this.audio.setMood(f.def.type, f.def.seed);
    else this.audio.setMood('space', this.systemDef.seed);
  }

  audioParams(dt) {
    const s = this.ship;
    const inShip = this.screen === 'play' && this.mode === 'ship' && !this.paused;
    const planet = this.surface.planet;
    let wind = 0;
    if (planet && planet.def.atmosphere && this.screen === 'play' && !this.paused) {
      wind = 0.05 + (this.stormK || 0) * 0.3;
      if (inShip && s.inAtmo > 0) wind += Math.min(0.25, s.speed / 1200) * s.inAtmo;
    }
    if (this.mode === 'foot' && this.walker.grounded && this.walker.moving > 0.5 && !this.paused) {
      const ph = Math.floor(this.walker.bobPhase / Math.PI);
      if (ph !== this.stepPhase) {
        this.stepPhase = ph;
        this.audio.step();
      }
    }
    return {
      shipAudible: inShip || !!this.warp,
      throttle: s ? s.throttle : 0,
      boost: s ? s.boost : 0,
      pulse: (s && s.pulse ? 1 : 0) + (this.warp ? 1 : 0),
      speedK: s ? Math.min(1, s.speed / 500) : 0,
      wind,
      jet: this.mode === 'foot' && this.walker.jetting && !this.paused,
      beam: !!this.beamOn && !this.paused,
      beamProgress: this.beamProgress || 0,
      musicDuck: this.menuOpen === 'dialog',
    };
  }

  // ---------------------------------------------------------------- ship

  clearanceFor(worldPos) {
    let best = Infinity;
    for (const b of this.system.bodies) {
      const d = _v.subVectors(worldPos, b.position).length() - b.atmoRadius;
      if (d < best) best = d;
    }
    const ds = worldPos.length() - this.system.star.radius * 3;
    return Math.min(best, ds);
  }

  updateShipMode(dt) {
    const ship = this.ship;
    const input = this.input;
    this.visor = false;
    const wp = ship.worldPos(_v2);
    const clearance = this.clearanceFor(wp);
    const repaired = this.state.story.stage !== 'repair';

    if (ship.state === 'landed') {
      if (input.hit('KeyE')) this.exitShip();
      else if (input.hit('Space') || input.hit('KeyW')) {
        if (!repaired) {
          this.hud.message('Launch thrusters damaged');
          this.audio.error();
        } else {
          ship.startTakeoff();
          this.audio.whoosh(1.4, 0.2);
        }
      }
    } else if (ship.state === 'flying') {
      if (input.hit('KeyE')) {
        const why = ship.canLand();
        if (why === null) {
          const fail = ship.startLanding();
          if (fail === 'water') this.hud.message('Cannot land on liquid');
          else if (fail === 'steep') this.hud.message('Surface too steep');
        } else if (why === 'fast') this.hud.message('Slow down to land');
        else if (why === 'high') this.hud.message('Get closer to the ground to land');
      }
      if (input.hit('KeyF')) this.shipScan();
    }

    ship.update(dt, input, { clearance, time: this.time });

    if (ship.state === 'flying') {
      const body = this.system.frameBodyFor(ship.worldPos(_v), ship.frame);
      if (body !== ship.frame) ship.setFrame(body);
      // asteroid fields live in system space, only bother when in it
      if (!ship.frame) {
        for (const f of this.fields) {
          const n = f.collide(ship.pos, 5);
          if (n) {
            const into = -ship.vel.dot(n);
            if (into > 0) ship.vel.addScaledVector(n, into * 1.4);
            if (into > 20) {
              this.rig.shake(Math.min(1.2, into / 60));
              this.audio.thud(0.35);
            }
            if (ship.pulse) ship.dropPulse('impact');
          }
        }
      }
      // star proximity
      const ds = ship.worldPos(_v).length();
      if (ds < this.system.star.radius * 2.2) {
        ship.vel.addScaledVector(_v.normalize().applyQuaternion(ship.frame ? ship.frame.invQuat : _q.identity()), 800 * dt);
        if (this.frame % 30 === 0) this.hud.message('Hull temperature critical');
      }
    }

    if (input.wheel) this.rig.zoom = Math.max(0.6, Math.min(2.2, this.rig.zoom * (input.wheel > 0 ? 1.1 : 0.9)));
    this.rig.followShip(ship, dt, input);
    this.updateShipLaser(dt);

    for (const e of ship.events) this.onShipEvent(e);
    ship.events.length = 0;

    // recharge the suit while inside
    const suit = this.state.suit;
    suit.shield = Math.min(1, suit.shield + dt * 0.12);
    suit.health = Math.min(1, suit.health + dt * 0.05);
    this.stormK = this.surface.planet ? this.stormLevel(this.surface.planet) : 0;
    if (this.surface.planet) this.surface.planet.stormK = this.stormK;
  }

  // ship lasers converge where the reticle points, and only mine asteroids
  updateShipLaser(dt) {
    const ship = this.ship;
    this.shipTarget = null;
    this.beamOn = false;
    let target = null;
    const firing = ship.state === 'flying' && !ship.pulse && this.input.mouse(0);
    const origin = this.rig.worldPos.clone();
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.rig.worldQuat);
    const range = 1200;
    let hit = null;
    let field = null;
    for (const f of this.fields) {
      const h = f.raycast(origin, dir, range);
      if (h && (!hit || h.t < hit.t)) {
        hit = h;
        field = f;
      }
    }
    if (hit) this.shipTarget = { name: 'Asteroid', sub: RESOURCES[hit.rock.type.res].name, progress: firing ? 1 - hit.rock.hp : undefined };
    if (firing) {
      this.beamOn = true;
      const end = origin.addScaledVector(dir, hit ? hit.t : range);
      if (hit) this.mineAsteroid(field, hit.rock, dt);
      // into the ship body's space, including the cosmetic bank
      const wq = ship.worldQuat(new THREE.Quaternion());
      const local = end.sub(ship.worldPos(new THREE.Vector3())).applyQuaternion(wq.invert());
      local.applyAxisAngle(new THREE.Vector3(0, 0, 1), -ship.bank);
      target = local;
    }
    ship.model.setLaser(target, this.time);
  }

  mineAsteroid(field, rock, dt) {
    if (this.isFull(rock.type.res)) return;
    rock.hp -= (dt * this.stats.miningPower * 22) / rock.scale;
    if (rock.hp > 0) return;
    rock.alive = false;
    const n = Math.max(4, Math.round(rock.scale * 2.2));
    this.gain(rock.type.res, n);
    this.effects.burst(field, rock.pos.clone(), rock.type.color, 8, 70, false);
    const rec = this.state.asteroids[field.key] || (this.state.asteroids[field.key] = []);
    rec.push(rock.id);
    this.audio.thud(0.2);
  }

  onShipEvent(e) {
    switch (e.type) {
      case 'pulseStart':
        this.hud.message('Pulse drive engaged', 1500);
        this.audio.whoosh(1.5, 0.3);
        break;
      case 'pulseEnd':
        if (e.reason === 'proximity') this.hud.message('Pulse drive disengaged', 1500);
        this.audio.whoosh(0.8, 0.15);
        break;
      case 'pulseBlocked':
        this.hud.message('Pulse drive needs open space', 1800);
        this.audio.error();
        break;
      case 'impact':
        this.rig.shake(Math.min(1.2, e.speed / 40));
        this.audio.thud(0.4);
        break;
      case 'scrape':
        this.rig.shake(0.15);
        this.audio.thud(0.12);
        break;
      case 'landed': {
        this.audio.thud(0.25);
        const p = this.ship.frame;
        if (p instanceof Planet) {
          const ground = this.ship.pos.clone().addScaledVector(this.ship.pos.clone().normalize(), -1.8);
          this.effects.burst(p, ground, p.def.palette.sand, 2.5, 50);
        }
        this.story.onLanded(this.ship.frame);
        this.saveSoon = true;
        break;
      }
      case 'landStart':
        this.audio.whoosh(2.2, 0.12);
        break;
    }
  }

  exitShip() {
    const ship = this.ship;
    const planet = ship.frame;
    if (!(planet instanceof Planet)) return;
    const up = ship.pos.clone().normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(ship.quat);
    const fwd = ship.forward(new THREE.Vector3());
    const p = ship.pos.clone().addScaledVector(right, -4.5).addScaledVector(fwd, 2);
    this.walker.place(planet, p.normalize(), fwd.projectOnPlane(up).normalize());
    this.walker.jetFuel = 1;
    this.setMode('foot');
    this.audio.whoosh(0.5, 0.1);
  }

  enterShip() {
    if (this.state.story.stage === 'repair') {
      const cost = this.story.repairCost;
      if (this.state.has(cost)) {
        this.state.spend(cost);
        this.story.set('launch');
        this.hud.banner('Thrusters repaired', 'Ready for launch');
        this.audio.craft();
      } else {
        const parts = Object.entries(cost).map(([k, n]) => `${n} ${RESOURCES[k].name}`);
        this.hud.message(`Launch thrusters need ${parts.join(' and ')}`);
      }
    }
    this.rig.orbitYaw = 0;
    this.rig.orbitPitch = -0.3;
    this.setMode('ship');
    this.audio.whoosh(0.5, 0.1);
  }

  shipScan() {
    if (this.scanCooldown && this.time < this.scanCooldown) return;
    this.scanCooldown = this.time + 5;
    this.audio.ping();
    this.hud.scanPulse();
    const planet = this.surface.planet;
    if (!planet || !this.surface.pois) {
      this.hud.message('Fly closer to a planet to scan it');
      return;
    }
    const local = this.ship.pos;
    const fresh = this.surface.pois.reveal(local, 4000, ['monolith', 'ruin', 'cache', 'beacon', 'deposit']);
    this.reportScan(fresh);
  }

  reportScan(fresh) {
    if (!fresh.length) return this.hud.message('No new signals nearby', 1800);
    const counts = {};
    for (const p of fresh) counts[p.type] = (counts[p.type] || 0) + 1;
    const parts = Object.entries(counts).map(([t, n]) => `${n} ${POI_INFO[t].label}${n > 1 ? 's' : ''}`);
    this.hud.notify(`Scan: ${parts.join(', ')}`, '#7fe0ff');
  }

  // ---------------------------------------------------------------- foot

  updateFootMode(dt) {
    const w = this.walker;
    const input = this.input;
    const planet = w.frame;
    const colliders = this.surface.colliders(w.pos);
    w.update(dt, input, { colliders });
    this.rig.followWalker(w, dt);

    // aiming and tools
    const origin = w.eye(new THREE.Vector3());
    const dir = w.lookDir(new THREE.Vector3());
    this.visor = input.mouse(2);
    const range = 18;
    const target = this.surface.active ? this.surface.pick(origin, dir, range) : null;
    const firing = input.mouse(0) && !this.visor;
    let endLocal = null;
    let progress = null;
    this.beamOn = firing;
    if (firing) {
      const res = this.surface.mine(target, dt, this.stats.miningPower);
      if (res) progress = res.progress;
      if (target) endLocal = target.kind === 'flora' ? target.hit.center.clone() : origin.clone().addScaledVector(dir, target.t);
      else {
        const th = this.surface.terrainRay(origin, dir, range);
        endLocal = th ? th.point : origin.clone().addScaledVector(dir, range);
      }
    } else {
      this.surface.mine(null);
    }
    this.beamProgress = progress || 0;

    let info = this.surface.describe(target);
    if (this.visor) {
      const a = this.surface.analyze(target, dt);
      if (a && a.fresh) this.audio.discovery();
      if (a && !a.known) info = { name: 'Analyzing...', sub: a.species.fauna ? 'Unknown creature' : 'Unknown flora', progress: a.progress };
      else if (a && a.known) info = { name: a.species.name, sub: a.species.fauna ? a.species.label : `${a.species.label} · ${RESOURCES[a.species.res].name}` };
    } else if (progress !== null && info) info.progress = progress;
    this.targetInfo = info;

    let endCam = null;
    if (endLocal) {
      planet.toWorld(endLocal, _v);
      _v.sub(this.rig.worldPos).applyQuaternion(_q.copy(this.rig.worldQuat).invert());
      endCam = _v.clone();
    }
    this.camera.updateMatrixWorld();
    this.tool.update(dt, this.time, firing, endCam, w.bob, input.enabled ? input.look() : null);

    // interaction
    const nearShip = this.ship.frame === w.frame && _v.subVectors(this.ship.pos, w.pos).length() < 9;
    this.nearShip = nearShip;
    const poi = this.surface.pois ? this.surface.pois.nearestInteractive(w.pos, 5.5) : null;
    this.nearPoi = poi;
    if (input.hit('KeyE')) {
      if (poi) this.interactPoi(poi);
      else if (nearShip) this.enterShip();
    }
    if (input.hit('KeyF')) this.footScan();
    if (input.hit('KeyR')) this.rechargeShield();

    for (const e of w.events) {
      if (e.type === 'hardLanding') this.audio.thud(0.2);
      if (e.type === 'jump') this.audio.step();
    }
    w.events.length = 0;

    this.updateHazard(dt);
    this.updateScanRing(dt);
  }

  footScan() {
    if (this.scanCooldown && this.time < this.scanCooldown) return;
    this.scanCooldown = this.time + 4;
    this.audio.ping();
    this.hud.scanPulse();
    const planet = this.walker.frame;
    planet.uniforms.scanPos.value.copy(this.walker.pos);
    this.scanAnim = { t: 0, range: this.stats.scanRange, planet };
    if (this.surface.pois) {
      const fresh = this.surface.pois.reveal(this.walker.pos, this.stats.scanRange);
      this.reportScan(fresh);
    }
  }

  updateScanRing(dt) {
    const a = this.scanAnim;
    if (!a) return;
    a.t += dt;
    const r = a.t * 900;
    a.planet.uniforms.scanRadius.value = r;
    if (r > a.range * 1.1) {
      a.planet.uniforms.scanRadius.value = 0;
      this.scanAnim = null;
    }
  }

  interactPoi(poi) {
    const pois = this.surface.pois;
    const planet = this.walker.frame;
    const used = pois.isUsed(poi);
    this.flushGains();
    switch (poi.type) {
      case 'monolith': {
        if (used) return this.hud.message('The stone is silent');
        pois.markUsed(poi);
        const text = echoText(poi.seed, planet.def.name, this.systemDef.name);
        this.state.lore.push({ title: 'Echo Stone', text });
        this.gain('relic', 1, true);
        this.state.data += 40;
        this.audio.chorus();
        this.menus.showDialog('Echo Stone', text, '+1 Relic Shard · +40 Data');
        this.openDialog();
        break;
      }
      case 'ruin': {
        if (used) return this.hud.message('Only rubble remains');
        pois.markUsed(poi);
        const text = echoText(poi.seed + 7, planet.def.name, this.systemDef.name);
        text.unshift('The shard at the center of the ruins dims as you take it.');
        this.state.lore.push({ title: 'Chorus Ruins', text });
        this.gain('relic', 2, true);
        this.state.data += 60;
        this.audio.chorus();
        this.menus.showDialog('Chorus Ruins', text, '+2 Relic Shards · +60 Data');
        this.openDialog();
        break;
      }
      case 'cache': {
        if (used) return this.hud.message('The pod is empty');
        pois.markUsed(poi);
        const rng = Math.random;
        const pool = ['ferrite', 'carbon', 'hydrogel', 'lumen', planet.def.resource];
        const res = pool[Math.floor(rng() * pool.length)];
        this.gain(res, 30 + Math.floor(rng() * 40));
        if (rng() < 0.3) {
          this.state.warpCells++;
          this.hud.notify('+1 Warp Cell', '#ffb45e');
        }
        this.addData(20, 'Salvage');
        this.audio.craft();
        break;
      }
      case 'beacon': {
        if (used) return this.hud.message('The beacon has nothing new');
        pois.markUsed(poi);
        const fresh = pois.reveal(this.walker.pos, 5000, ['monolith', 'ruin', 'cache']);
        this.audio.ping();
        this.hud.message('Beacon uplink complete', 2000);
        this.reportScan(fresh);
        break;
      }
      case 'spire': {
        const i = poi.story;
        if (!this.story.onSpire(poi)) {
          this.audio.chorus();
          return this.hud.message('The spire hums quietly');
        }
        const r = RESONANCES[Math.min(i, RESONANCES.length - 1)];
        this.state.lore.push({ title: r.title, text: r.text });
        this.gain('relic', 3, true);
        this.state.data += 150;
        this.audio.chorus();
        this.menus.showDialog(r.title, r.text, '+3 Relic Shards · +150 Data');
        this.openDialog();
        break;
      }
    }
    this.saveSoon = true;
  }

  openDialog() {
    this.menuOpen = 'dialog';
    this.paused = true;
    this.input.unlock();
  }

  // ---------------------------------------------------------------- hazards

  stormLevel(planet) {
    if (!planet.def.atmosphere || planet.def.hazard.type === 'none') return 0;
    // storms follow a deterministic schedule per planet
    const period = 300 + (planet.def.seed % 200);
    const t = (this.state.worldTime + planet.def.seed % 997) % period;
    const len = 80;
    if (t > len) return 0;
    return Math.min(1, t / 8, (len - t) / 8);
  }

  updateHazard(dt) {
    const planet = this.walker.frame;
    const suit = this.state.suit;
    const hz = planet.def.hazard;
    const storm = this.stormLevel(planet);
    if (storm > 0 && !this.stormWarned) {
      this.stormWarned = true;
      this.hud.message('Storm incoming', 3000);
      this.audio.alert();
    } else if (storm === 0) this.stormWarned = false;
    this.stormK = storm;
    planet.stormK = storm;

    const sunUp = planet.sunDirLocal(_v).dot(this.walker.up(_v2));
    const day = smoothstep(-0.15, 0.3, sunUp);
    let k = 0;
    if (hz.type === 'heat') k = hz.level * (0.55 + 0.9 * day);
    else if (hz.type === 'cold') k = hz.level * (0.55 + 0.9 * (1 - day));
    else if (hz.type !== 'none') k = hz.level;
    k *= 1 + storm * 1.6;
    if (this.walker.swimming && hz.type === 'cold') k *= 1.5;
    const drain = k * 0.012 * (1 - this.stats.hazardResist);
    this.hazardActive = drain > 0.0001;
    this.hazardK = k;
    suit.shield = Math.max(0, suit.shield - drain * dt);
    let hurt = 0;
    if (suit.shield <= 0 && drain > 0) hurt += k * 0.03;
    if (this.walker.onLava) hurt += 0.3;
    suit.health = Math.max(0, Math.min(1, suit.health - hurt * dt + (hurt === 0 && suit.shield > 0 ? 0.01 * dt : 0)));
    if (suit.shield < 0.25 && drain > 0 && !this.shieldWarned) {
      this.shieldWarned = true;
      this.audio.alert();
      this.hud.message(this.state.count('lumen') >= 10 ? 'Hazard shield low, press R to recharge' : 'Hazard shield low, find Lumen or return to your ship', 3500);
    } else if (suit.shield > 0.4) this.shieldWarned = false;
    if (suit.health <= 0) this.die();
  }

  die() {
    if (this.dying) return;
    this.dying = true;
    this.menus.deathText.textContent = 'You wake up back at your ship. Some cargo was lost.';
    this.menus.open('death');
    this.menuOpen = 'death';
    this.paused = true;
    this.audio.thud(0.5);
    setTimeout(() => {
      const st = this.state;
      for (const k of ['ferrite', 'carbon', 'lumen', 'hydrogel']) st.inventory[k] = Math.floor(st.inventory[k] * 0.7);
      st.suit.health = 1;
      st.suit.shield = 1;
      if (this.ship.frame === this.walker.frame) this.exitShip();
      this.dying = false;
      if (this.screen !== 'play') return;
      this.menus.close();
      this.menuOpen = null;
      this.resume();
    }, 2600);
  }

  // ---------------------------------------------------------------- discovery

  updateDiscovery() {
    const f = this.mode === 'foot' ? this.walker.frame : this.ship.frame;
    if (!f) return;
    // gas giants count once the ship is in their space, rocky worlds once inside the air
    if (f.def.kind === 'gas') return this.discoverBody(f);
    const local = this.mode === 'foot' ? this.walker.pos : this.ship.pos;
    if (local.length() - f.radius < (f.atmoRadius - f.radius) * 0.9) this.discoverBody(f);
  }

  // ---------------------------------------------------------------- warp

  // why the ship can't jump from where it is right now, or null
  warpBlocker() {
    if (this.mode !== 'ship' || this.ship.state !== 'flying') return 'Take off before warping.';
    if (this.ship.frame && this.ship.inAtmo > 0.1) return 'Leave the atmosphere before warping.';
    return null;
  }

  // the map disables the button for all of these, this is the last check
  requestWarp(star) {
    const st = this.state;
    const s = stats(st);
    let err = this.warpBlocker();
    if (st.warpCells < 1) err = 'No Warp Cells.';
    else if (this.galaxy.dist(st.systemIndex, star) > s.warpRange) err = 'Out of range.';
    else if (!s.warpClasses.includes(this.galaxy.classOf(star))) err = 'Your drive cannot hold that star yet.';
    if (err) {
      this.audio.error();
      this.map.renderInfo(err);
      return;
    }
    st.warpCells--;
    this.closeMenus();
    this.beginWarp(star, false);
  }

  requestCoreJump() {
    const st = this.state;
    const err = this.warpBlocker();
    if (!st.story.flags.lens || st.warpCells < 1 || st.systemIndex === CORE_INDEX || err) {
      this.audio.error();
      if (err) this.map.renderInfo(err);
      return;
    }
    st.warpCells--;
    this.closeMenus();
    this.beginWarp(CORE_INDEX, true);
  }

  beginWarp(target, core) {
    const cls = core ? { color: '#ffe4a0' } : STAR_CLASSES[this.galaxy.classOf(target)];
    const c = new THREE.Color(cls.color);
    this.tunnel.setColors(core ? new THREE.Color(0.5, 0.3, 0.05) : new THREE.Color(0.05, 0.12, 0.35), c.clone().multiplyScalar(1.4));
    this.warp = { t: 0, target, core, loaded: false, dur: core ? 8 : 6 };
    this.ship.pulse = false;
    this.audio.warpCharge();
    this.hud.setVisible(false);
    this.saveSoon = false;
  }

  updateWarp(dt) {
    const w = this.warp;
    w.t += dt;
    const ship = this.ship;
    const t = w.t;
    // charge
    const charge = smoothstep(0, 1.6, t);
    const exit = smoothstep(w.dur - 1.4, w.dur, t);
    ship.vel.copy(ship.forward(_v)).multiplyScalar(200 + charge * 3000 * (1 - exit));
    ship.pos.addScaledVector(ship.vel, dt * (w.loaded ? 0.02 : 1));
    ship.model.setThrust(0.6 + charge * 2, this.time);
    this.rig.followShip(ship, dt, null);
    this.rig.fov = 70 + charge * 35 * (1 - exit);
    this.rig.shake(dt * 3 * charge * (1 - exit));
    const tunnel = smoothstep(1.2, 1.8, t) * (1 - smoothstep(w.dur - 1.2, w.dur - 0.4, t));
    this.tunnel.update(this.time, tunnel, w.core ? 5 : 3.5);
    const flashIn = Math.max(0, 1 - Math.abs(t - 1.6) / 0.35);
    const flashOut = Math.max(0, 1 - Math.abs(t - (w.dur - 1.0)) / 0.35);
    this.pipeline.finalUniforms.uFlash.value = Math.max(flashIn, flashOut) * 0.85;
    this.pipeline.finalUniforms.uAberration.value = charge * (1 - exit) * 1.5;
    if (!w.boomed && t > 1.5) {
      w.boomed = true;
      this.audio.warpBoom();
    }
    if (!w.loaded && t > 2.2) {
      w.loaded = true;
      this.enterSystem(w.target, 'warp');
      this.hud.setVisible(false);
    }
    if (t >= w.dur) {
      this.warp = null;
      this.tunnel.update(this.time, 0, 1);
      this.pipeline.finalUniforms.uFlash.value = 0;
      this.pipeline.finalUniforms.uAberration.value = 0;
      this.hud.setVisible(true);
      this.story.onArrive(w.target);
      this.saveSoon = true;
      if (w.core) this.reachCore();
      // Esc during the jump let go of the mouse without pausing
      if (!document.pointerLockElement && !this.params.has('capture')) this.openMenu('pause');
    }
  }

  // the ending shows a few seconds after arrival, once nothing else is open
  reachCore() {
    this.state.story.stage = 'end';
    this.saveSoon = true;
    this.pendingEnding = this.time + 5;
  }

  checkEnding() {
    if (!this.pendingEnding || this.time < this.pendingEnding) return;
    if (this.screen !== 'play' || this.menuOpen || this.warp || this.photo) return;
    this.pendingEnding = 0;
    this.state.lore.push({ title: ENDING.title, text: ENDING.text });
    this.audio.chorus();
    this.menus.showDialog(ENDING.title, ENDING.text, 'Thank you for playing. Keep exploring, or start a new galaxy from the title screen.');
    this.openDialog();
  }

  // ---------------------------------------------------------------- hud

  project(worldPos, out) {
    const rel = _v.subVectors(worldPos, this.rig.worldPos);
    const dist = rel.length();
    rel.applyQuaternion(_q.copy(this.rig.worldQuat).invert());
    const behind = rel.z > 0;
    const p = rel.clone().applyMatrix4(this.camera.projectionMatrix);
    let x = p.x, y = p.y;
    if (behind) {
      x = -x;
      y = -y;
    }
    const edge = behind || Math.abs(x) > 0.95 || Math.abs(y) > 0.9;
    if (edge) {
      const k = 1 / Math.max(Math.abs(x) / 0.95, Math.abs(y) / 0.9, 1e-6);
      if (behind || k < 1) {
        x *= k;
        y *= k;
      }
    }
    out.x = (x * 0.5 + 0.5) * this.viewW;
    out.y = (-y * 0.5 + 0.5) * this.viewH;
    out.edge = edge;
    out.dist = dist;
    return out;
  }

  updateHud() {
    const hud = this.hud;
    const sys = this.systemDef;
    const frameBody = this.mode === 'foot' ? this.walker.frame : this.ship.frame;
    const cls = STAR_CLASSES[sys.cls];
    let body = frameBody;
    if (!body && this.system.focus) {
      const f = this.system.focus;
      if (f.camDist - f.radius < f.radius * 3) body = f;
    }
    let sub = '';
    if (body) {
      const d = body.def;
      sub = `${d.typeLabel}${d.isMoon ? ' moon' : ''}`;
      if (d.hazard && d.hazard.type !== 'none' && d.kind === 'rocky') sub += ` · ${HAZARD_LABEL[d.hazard.type]} ${Math.round(d.hazard.level * 100)}%`;
      const found = this.state.discoveries[d.id];
      if (found && found.life) sub += ` · Life ${found.found || 0}/${found.life}`;
      if (body instanceof Planet && frameBody) {
        const local = this.mode === 'foot' ? this.walker.pos : this.ship.pos;
        sub += ` · ${this.localTime(body, local)}`;
      }
    }
    hud.setLocation(`${sys.name} · ${sys.starLabel || cls.label}`, body ? body.def.name : 'Deep space', sub);
    const obj = this.story.objective();
    hud.setObjective(obj ? obj.title : null, obj ? obj.text : null);

    if (this.mode === 'ship') {
      const s = this.ship;
      let mode = 'Impulse';
      if (s.pulse) mode = 'Pulse drive';
      else if (s.state === 'landed') mode = 'Landed';
      else if (s.state === 'landing') mode = 'Landing';
      else if (s.state === 'takeoff') mode = 'Launching';
      else if (s.inAtmo > 0.5) mode = 'Atmospheric flight';
      else if (s.boost > 0.2) mode = 'Boost';
      hud.updateFlight({ mode, speed: s.speed, alt: s.frame ? s.altitude : Infinity, throttle: s.throttle, energy: s.energy, pulse: s.pulse });
      let prompt = null;
      if (s.state === 'landed') prompt = '<kbd>E</kbd>Exit ship &nbsp; <kbd>W</kbd>Take off';
      else if (s.state === 'flying' && s.canLand() === null) prompt = '<kbd>E</kbd>Land';
      hud.prompt(prompt);
      if (s.state === 'flying') {
        const wq = s.worldQuat(new THREE.Quaternion());
        const nose = this.project(s.worldPos(new THREE.Vector3()).addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(wq), 3000), {});
        hud.setNose(nose.x - this.viewW / 2, nose.y - this.viewH / 2, !nose.edge);
      } else hud.setNose(0, 0, false);
      hud.setTarget(this.shipTarget);
    } else {
      let prompt = null;
      if (this.nearPoi) prompt = `<kbd>E</kbd>${POI_INFO[this.nearPoi.type].verb || 'Interact'}`;
      else if (this.nearShip) prompt = `<kbd>E</kbd>${this.state.story.stage === 'repair' ? 'Repair and board ship' : 'Board ship'}`;
      hud.prompt(prompt);
      const hz = this.walker.frame.def.hazard;
      const suit = this.state.suit;
      const danger = this.hazardActive ? Math.min(1, (1 - suit.shield) * 0.5 + (1 - suit.health) * 0.8) * Math.min(1, this.hazardK * 2) : 0;
      hud.updateSuit({
        hazardLabel: HAZARD_LABEL[hz.type] || 'Shield',
        shield: suit.shield,
        health: suit.health,
        jet: this.walker.jetFuel,
        hazardActive: this.hazardActive,
        danger: this.walker.onLava ? 0.8 : danger,
        dangerColor: this.walker.onLava ? '255,80,20' : HAZARD_COLOR[hz.type],
      });
      hud.setTarget(this.targetInfo);
    }

    // markers
    const markers = [];
    const tmp = {};
    if (this.mode === 'ship') {
      for (const b of this.system.bodies) {
        if (b === frameBody && b.camDist - b.radius < b.radius * 1.2) continue;
        const p = this.project(b.position, tmp);
        const isGoal = this.state.story.stage === 'spire' && b.def.spire;
        // off-screen bodies only get an edge arrow when they matter
        const visible = !p.edge || isGoal || p.dist - b.radius < 40000;
        markers.push({ id: `b${b.index}`, x: p.x, y: p.y, visible, edge: p.edge, label: b.def.name + (isGoal ? ' · Signal' : ''), sub: fmtDist(p.dist - b.radius), kind: isGoal ? 'signal' : 'body', color: isGoal ? '#e6d4ff' : b.def.kind === 'gas' ? '#ffd9a0' : '#cfe9ff' });
      }
      for (let i = 0; i < this.fields.length; i++) {
        const f = this.fields[i];
        const p = this.project(f.position, tmp);
        if (p.dist < f.radius * 0.8 || p.dist > 150000 || p.edge) continue;
        markers.push({ id: `f${i}`, x: p.x, y: p.y, visible: true, edge: false, label: 'Asteroid Field', sub: fmtDist(p.dist), kind: 'poi', color: '#c9c1b6' });
      }
    } else if (this.ship.frame === this.walker.frame) {
      const sp = this.ship.worldPos(new THREE.Vector3());
      const p = this.project(sp, tmp);
      if (p.dist > 12) markers.push({ id: 'ship', x: p.x, y: p.y, visible: true, edge: p.edge, label: 'Ship', sub: fmtDist(p.dist), kind: 'ship', color: '#ffb45e' });
    }
    if (this.surface.pois && frameBody === this.surface.planet) {
      const local = this.mode === 'foot' ? this.walker.pos : this.ship.pos;
      for (const poi of this.surface.pois.markers(local)) {
        const wp = frameBody.toWorld(poi.pos.clone().addScaledVector(poi.dir, poi.type === 'spire' ? 30 : 3), new THREE.Vector3());
        const p = this.project(wp, {});
        if (p.dist > 6000 || p.dist < 6) continue;
        const info = POI_INFO[poi.type];
        const label = poi.type === 'deposit' ? `${RESOURCES[poi.res].name} Deposit` : info.label;
        markers.push({ id: `p${poi.id}`, x: p.x, y: p.y, visible: true, edge: p.edge, label, sub: fmtDist(p.dist), kind: poi.type === 'spire' ? 'signal' : 'poi', color: poi.type === 'deposit' ? RESOURCES[poi.res].color : info.color });
      }
    }
    hud.setMarkers(markers);

    let hint = null;
    if (this.state.playTime < 90 && this.mode === 'foot') hint = '<kbd>LMB</kbd>Mine<br><kbd>RMB</kbd>Analyze<br><kbd>F</kbd>Scan<br><kbd>Tab</kbd>Inventory';
    else if (this.state.playTime < 400 && this.mode === 'ship' && this.state.story.stage === 'explore') hint = '<kbd>Space</kbd>Pulse drive<br><kbd>Shift</kbd>Boost<br><kbd>F</kbd>Scan planet';
    hud.setHint(hint);
  }

  localTime(body, local) {
    const sun = body.sunDirLocal(_v);
    const ls = Math.atan2(sun.x, sun.z);
    const lp = Math.atan2(local.x, local.z);
    let h = 12 - ((ls - lp) / (Math.PI * 2)) * 24;
    h = ((h % 24) + 24) % 24;
    const hh = Math.floor(h);
    const mm = Math.floor((h - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
}

function shipColors(seed) {
  const rng = new RNG(seed ^ 0x5419);
  return {
    primary: rng.pick(['#d8dde6', '#e8e4da', '#c9d6e3', '#e6d2b8', '#9aa3b0', '#dfe6e0']),
    secondary: rng.pick(['#2b3140', '#3a2f2a', '#1f2a2e', '#34303f']),
    accent: rng.pick(['#ff8a3c', '#3cc8ff', '#ff4f8a', '#b6ff3c', '#ffc93c', '#b58cff']),
    glow: rng.pick(['#6fd6ff', '#ffb45e', '#ff7ad8', '#7dffb0']),
  };
}
