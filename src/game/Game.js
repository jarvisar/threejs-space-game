import * as THREE from 'three';
import { Pipeline, LAYER_MAIN } from '../render/pipeline.js';
import { env } from '../render/materials.js';
import { Effects } from '../render/effects.js';
import { WarpTunnel } from '../render/warp.js';
import { SpaceDust } from '../render/spaceDust.js';
import { AsteroidField } from '../world/asteroids.js';
import { buildWarmup, prepareView, afterFrames } from '../render/warmup.js';
import { loader } from '../ui/loader.js';
import { Galaxy, STAR_CLASSES, CORE_INDEX } from '../gen/galaxy.js';
import { generateSystem, generateCoreSystem } from '../gen/system.js';
import { StarSystem, soiRadius } from '../world/starSystem.js';
import { Planet, findLand, surfaceNormal } from '../world/planet.js';
import { Sky } from '../world/sky.js';
import { Weather } from '../world/weather.js';
import { WorkerPool } from '../world/workerPool.js';
import { POI_INFO } from '../world/pois.js';
import { WONDERS } from '../world/wonders.js';
import { Meteors } from '../world/meteors.js';
import { worldFacts, worldColors } from './facts.js';
import { planRoute } from '../gen/route.js';
import { faunaSpecies } from '../world/fauna.js';
import { planetSpecies } from '../gen/flora.js';
import { Input } from '../core/input.js';
import { device, onDeviceChange, toggleFullscreen } from '../core/device.js';
import { PRESETS, detail } from '../render/quality.js';
import { TouchControls } from '../ui/touch.js';
import { Ship } from '../player/ship.js';
import { OrbitLine, orbitFloor, timeToRadius } from '../player/orbit.js';
import { EntryFx } from '../render/entryFx.js';
import { Walker } from '../player/walker.js';
import { CameraRig, portraitFov } from '../player/cameraRig.js';
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
import { RESONANCES, ENDING, echoText, wreckLog } from './lore.js';
import { DebugCam } from './debugCam.js';
import { RNG } from '../core/rng.js';
import { smoothstep } from '../core/math.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

const SETTINGS_KEY = 'starsong-settings';

// photo mode looks, cycled with V. The first one is the normal game grade.
const FILTERS = [
  { name: 'Natural', sat: 1.1, vig: 0.35, bloom: 0.9, grain: 0.012, tint: [1, 1, 1], contrast: 1, lift: 0 },
  { name: 'Warm', sat: 1.15, vig: 0.4, bloom: 1.0, grain: 0.012, tint: [1.07, 1.0, 0.88], contrast: 1.03, lift: 0.01 },
  { name: 'Cool', sat: 1.05, vig: 0.4, bloom: 0.9, grain: 0.012, tint: [0.9, 0.99, 1.1], contrast: 1.02, lift: 0.01 },
  { name: 'Vivid', sat: 1.5, vig: 0.3, bloom: 1.0, grain: 0.01, tint: [1, 1, 1], contrast: 1.12, lift: 0 },
  { name: 'Dreamy', sat: 1.2, vig: 0.25, bloom: 1.9, grain: 0.01, tint: [1.03, 0.98, 1.05], contrast: 0.88, lift: 0.05 },
  { name: 'Film', sat: 0.88, vig: 0.6, bloom: 1.0, grain: 0.035, tint: [1.03, 1.0, 0.94], contrast: 1.08, lift: 0.035 },
  { name: 'Noir', sat: 0, vig: 0.75, bloom: 0.8, grain: 0.04, tint: [1, 1, 1], contrast: 1.3, lift: 0.02 },
];
const BLUR_NAMES = ['Focus blur off', 'Focus blur soft', 'Focus blur strong'];
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
    // Faceted terrain uses flat varyings. D3D takes them from the first vertex
    // and ANGLE emulates the GL default (last vertex) with a geometry shader,
    // which is slow. Without the extension it still works, just slower.
    const pv = this.renderer.getContext().getExtension('WEBGL_provoking_vertex');
    if (pv) pv.provokingVertexWEBGL(pv.FIRST_VERTEX_CONVENTION_WEBGL);
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
    // phones report 8 cores but most are small ones, and every worker holds its own terrain generator
    this.pool = new WorkerPool(Math.max(2, Math.min(device.mobile ? 3 : 6, (navigator.hardwareConcurrency || 4) - 2)));
    // adaptive resolution on top of the render scale setting, see updateAutoScale()
    this.autoScale = 1;
    this.perf = { t: 0, n: 0, good: 0 };

    this.input = new Input(this.renderer.domElement);
    this.hud = new HUD(uiRoot);
    this.menus = new Menus(uiRoot, this);
    this.map = new GalaxyMap(this, uiRoot);
    this.touch = new TouchControls(this, uiRoot, this.menus.root);
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
    this.entryFx = new EntryFx(this.scene);
    this.orbitLine = new OrbitLine(this.scene);
    this.meteors = new Meteors(this.scene);
    this.fields = [];
    this.ship = null;
    this.warp = null;
    this.stepPhase = 0;
    this.gainBuffer = new Map();
    this.lastSave = 0;

    this.applySettings();
    this.onResize();
    window.addEventListener('resize', () => {
      this.onResize();
      // phones can report the old size on the resize after a rotation
      clearTimeout(this.resizeT);
      this.resizeT = setTimeout(() => this.onResize(), 300);
    });
    // after the page was in the background, the next touch brings the sound back
    window.addEventListener('pointerdown', () => this.audio.ctx && this.audio.init(), true);
    document.addEventListener('visibilitychange', () => this.onVisibility());
    // a tap while "Click to resume" is up would never get the pointer lock it waits for
    onDeviceChange(() => {
      if (!device.touch || !this.awaitLock) return;
      this.hud.clearMessage();
      this.resume();
    });
    // mobile browsers can drop a backgrounded page without a beforeunload
    window.addEventListener('pagehide', () => {
      if (this.screen === 'play' && !this.warp) this.saveGame();
    });
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
    const d = { sensitivity: 1, invertY: false, renderScale: 1, shadows: true, ao: true, dof: true, volume: 0.8, music: 0.55, quality: 2, autoScale: false };
    // Phones and tablets start on the low preset with adaptive resolution. AO
    // is the most expensive pass after the atmosphere, so it starts off there.
    if (device.mobile) Object.assign(d, { quality: 0, autoScale: true, ao: false });
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
    if (k === 'autoScale') this.autoScale = 1;
    this.applySettings();
    if (k === 'renderScale' || k === 'quality' || k === 'autoScale') this.onResize();
  }

  applySettings() {
    const s = this.settings;
    this.input.sensitivity = s.sensitivity;
    this.input.invertY = s.invertY;
    this.audio.volume = s.volume;
    this.audio.musicVolume = s.music;
    this.sunLight.castShadow = s.shadows;
    this.applyQuality();
  }

  applyQuality() {
    const q = PRESETS[this.settings.quality] || PRESETS[2];
    this.quality = q;
    this.pipeline.samples = this.params.has('msaa') ? parseInt(this.params.get('msaa'), 10) : q.samples;
    const sh = this.sunLight.shadow;
    if (sh.mapSize.x !== q.shadowMap) {
      sh.mapSize.set(q.shadowMap, q.shadowMap);
      // three only sizes the map when it creates it
      if (sh.map) {
        sh.map.dispose();
        sh.map = null;
        this.pipeline.shadowInit = false;
      }
    }
    const a = this.pipeline.atmoUniforms;
    [a.uViewSteps.value, a.uLightSteps.value, a.uAuroraSteps.value] = q.atmo;
    detail.lod = q.lod;
    detail.scatter = q.scatter;
  }

  onResize() {
    const scale = parseFloat(this.params.get('scale') || '1') * (this.settings.renderScale || 1) * this.autoScale;
    const pr = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio) * scale;
    const w = window.innerWidth;
    const h = window.innerHeight;
    // every size change reallocates all the render targets, and phones fire
    // resize a lot (rotation, browser bars)
    const key = `${w}x${h}@${pr}/${this.pipeline.samples}`;
    if (key === this.sizeKey) return;
    this.sizeKey = key;
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

  // resolves when the fade starts lifting
  startFromTitle(kind, seed) {
    // a second click while the first one is still loading
    if (this.loadingGame) return this.loadingGame;
    this.audio.init();
    this.audio.click();
    // browser bars take a lot of a phone screen. Has to happen inside the tap.
    if (device.touch) toggleFullscreen(true);
    this.menus.setFade(1);
    this.loadingGame = new Promise((resolve) => setTimeout(() => {
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
      // Stay on black until the shaders and the ground around the player are
      // ready. Drawing earlier compiles on the main thread and the game
      // fades in on a stutter with terrain popping in.
      this.holdRender = true;
      loader.showMini('Loading');
      prepareView(this, { extra: this.warmupGroup(), onProgress: (p, label) => loader.progress(p, label), terrainMs: 5000 }).catch((err) => console.error(err)).then(async () => {
        this.holdRender = false;
        // the first frames upload the new geometry, keep those behind the fade too
        await afterFrames(2);
        loader.hide();
        loader.showView();
        this.menus.setFade(0);
        this.loadingGame = null;
        resolve();
      });
    }, 650));
    return this.loadingGame;
  }

  // Stand-ins for things that only show up mid-game (flora, creatures, POIs),
  // compiled with the rest of the view. Never drawn and never disposed,
  // disposing would drop their programs too.
  warmupGroup() {
    if (!this.warm) this.warm = buildWarmup();
    return this.warm;
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
    this.cometSeen = false;
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
    if (this.state.route === index) this.state.route = null;
    this.refreshRoute();
    if (index >= 0) {
      const first = this.state.markVisited(index);
      if (first && arrival !== 'spawn') this.addData(25, 'New system');
      this.hud.banner(this.systemDef.name, `${STAR_CLASSES[this.systemDef.cls].label}${first && arrival !== 'spawn' ? ' · New system' : ''}`);
      if (arrival === 'warp') this.hud.showCard(this.systemFacts(), first ? 'New system' : 'Arrived');
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
    const look = toShip.lerp(heading, 0.6).normalize();
    this.walker.place(planet, standDir, look);
    this.state.story.flags.spawn = { dir: standDir.toArray(), look: look.toArray() };
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
    this.ship.resetMotion();
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
    this.ship.resetMotion();
    // terrain changes between versions can put a saved spot in a new river or sea
    const wet = (dir) => body.seaLevel !== null && body.heightAt(dir) < 1;
    if (this.ship.state === 'landed') {
      // re-seat on the ground in case the terrain moved since the save
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.ship.quat);
      let dir = this.ship.pos.clone().normalize();
      if (wet(dir)) dir = findLand(body, dir, 2);
      this.ship.placeLanded(body, dir, fwd);
    } else if (p.orbit && this.ship.canOrbit() === null) {
      this.ship.enterOrbit(true);
    }
    if (p.mode === 'foot' && body) {
      this.walker.frame = body;
      this.walker.pos.fromArray(p.walkerPos);
      this.walker.heading.fromArray(p.walkerHeading);
      this.walker.vel.set(0, 0, 0);
      // make sure we are not under the ground after terrain tweaks
      let dir = this.walker.pos.clone().normalize();
      if (wet(dir)) {
        // stand next to the ship rather than wherever the land search ends up
        const side = new THREE.Vector3(1, 0, 0).applyQuaternion(this.ship.quat);
        dir = this.ship.pos.clone().addScaledVector(side, 6).normalize();
        if (wet(dir)) dir = findLand(body, dir, 2);
        this.walker.pos.copy(dir).multiplyScalar(this.walker.floorAt(dir));
      }
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
      orbit: !!s.orbit,
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
      this.refreshRoute();
    }
    this.menus.close();
    this.menuOpen = null;
    if (this.screen === 'play') this.resume();
  }

  // Unpause once the mouse is captured again. Chrome refuses pointer lock
  // after a keyboard-only close (Esc), so the game waits for a click instead
  // of running with a dead mouse.
  resume() {
    // touch has no pointer lock to wait for
    if (document.pointerLockElement || this.params.has('capture') || device.touch) {
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

  // Phones background the page without a pointer lock to lose, so this is
  // what pauses the game there. The music would keep playing otherwise.
  onVisibility() {
    const ctx = this.audio.ctx;
    if (!document.hidden) {
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
      return;
    }
    if (ctx) ctx.suspend().catch(() => {});
    if (this.screen !== 'play' || this.warp) return;
    this.saveGame();
    if (this.menuOpen) return;
    if (this.photo) this.exitPhoto();
    this.openMenu('pause');
  }

  // Adaptive resolution. Drops the render scale when frames run slow for a
  // couple of seconds and only creeps back up after a longer stretch of
  // headroom, so it doesn't bounce. Each change reallocates the render
  // targets, which is why it only looks every 2.5 s.
  updateAutoScale(dt) {
    const p = this.perf;
    if (!this.settings.autoScale || this.screen !== 'play' || this.paused || this.holdRender || this.warp) {
      p.t = p.n = 0;
      return;
    }
    p.t += dt;
    p.n++;
    if (p.t < 2.5) return;
    const avg = p.t / p.n;
    p.t = p.n = 0;
    if (avg > 1 / 40 && this.autoScale > 0.5) {
      this.autoScale = Math.max(0.5, this.autoScale - 0.1);
      p.good = 0;
      this.onResize();
    } else if (avg < 1 / 54 && this.autoScale < 1) {
      if (++p.good < 3) return;
      this.autoScale = Math.min(1, this.autoScale + 0.1);
      p.good = 0;
      this.onResize();
    } else p.good = 0;
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

  // The start planet puts its first wonder a few hundred meters out in the
  // opening view, so there's somewhere to head for. Older saves have no spawn
  // record and just get the usual random wonders.
  wonderHint(planet) {
    const sp = this.state.story.flags.spawn;
    if (!sp || !this.systemDef.isStart || planet.index !== 0) return null;
    const up = new THREE.Vector3().fromArray(sp.dir);
    const look = new THREE.Vector3().fromArray(sp.look).projectOnPlane(up).normalize();
    const side = new THREE.Vector3().crossVectors(look, up);
    // spots in the opening view, best first
    const dirs = [];
    for (const d of [330, 400, 280, 480, 560, 650]) {
      for (const s of [0, 50, -50, 110, -110]) dirs.push(up.clone().multiplyScalar(planet.radius).addScaledVector(look, d).addScaledVector(side, s).normalize());
    }
    return { kind: 'tree', dirs };
  }

  discoverWonder(poi, planet) {
    const st = this.state;
    if (!st.wonders) st.wonders = [];
    st.wonders.push({ name: poi.name, kind: poi.kind, planet: planet.def.name, system: this.systemDef.name });
    const world = st.discoveries[planet.def.id];
    if (world) world.wonders = (world.wonders || 0) + 1;
    this.hud.banner(poi.name, `${WONDERS[poi.kind].label} discovered`);
    this.addData(50, 'Landmark');
    this.audio.chorus();
    this.saveSoon = true;
  }

  discoverBody(body) {
    const d = body.def;
    if (this.state.discoveries[d.id]) return;
    // how many plants and creatures there are to catalogue, for the journal
    const life = d.kind === 'rocky' ? planetSpecies(d).filter((s) => s.plant).length + faunaSpecies(d).length : 0;
    this.state.discoveries[d.id] = { name: d.name, type: d.typeLabel, system: this.systemDef.name, life, found: 0, colors: worldColors(d), gas: d.kind === 'gas', moon: !!d.isMoon };
    this.hud.banner(d.name, `${d.typeLabel}${d.isMoon ? ' moon' : ''} discovered`);
    // the surface can come up before the discovery when flying in low
    if (this.surface.planet === body && this.surface.pois) this.state.discoveries[d.id].wonderTotal = this.surface.pois.wonders.length;
    this.hud.showCard(this.bodyFacts(body), 'New world discovered');
    this.addData(15, 'New world');
    this.audio.discovery();
  }

  // the arrival card: every world in the system and what's been explored
  systemFacts() {
    const sys = this.systemDef;
    const cls = STAR_CLASSES[sys.cls];
    const rows = this.system.bodies.filter((b) => !b.def.isMoon).map((b) => {
      const moons = this.system.bodies.filter((m) => m.def.isMoon && m.def.parent === b.index).length;
      const seen = this.state.discoveries[b.def.id] ? '' : ' · new';
      return [b.def.name, `${b.def.typeLabel}${moons ? ` +${moons}` : ''}${seen}`];
    });
    const tags = [];
    if (sys.comet) tags.push('Comet');
    if (this.fields.length) tags.push(`${this.fields.length} asteroid field${this.fields.length > 1 ? 's' : ''}`);
    if (sys.resonance >= 0) tags.push('Chorus signal');
    return { name: sys.name, type: sys.starLabel || cls.label, colors: [cls.color, cls.color, '#3a2a18'], gas: false, rows, tags };
  }

  // worldFacts plus things only the system knows, like how many moons
  bodyFacts(body) {
    const f = worldFacts(body);
    const moons = this.system.bodies.filter((b) => b.def.isMoon && b.def.parent === body.index).length;
    if (moons) f.tags.push(`${moons} moon${moons > 1 ? 's' : ''}`);
    const w = this.state.discoveries[body.def.id];
    if (w && w.wonderTotal) f.rows.push(['Landmarks', `${w.wonders || 0} of ${w.wonderTotal} found`]);
    return f;
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
    this.touch.update(dt);
    this.handleGlobalKeys();
    this.updateAutoScale(dt);

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
      this.rig.fov = this.photoFov || 60;
      this.updatePhoto(dt);
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
    this.updateFlightFx(dt, camWorld);
    this.effects.update(dt);
    const inSpace = this.screen === 'play' && this.mode === 'ship' && !this.photo;
    const dustAmt = inSpace && !this.warp ? 1 - (this.ship.inAtmo || 0) : 0;
    const wv = this.ship.frame ? _v.copy(this.ship.vel).applyQuaternion(this.ship.frame.quat) : this.ship.vel;
    this.dust.update(camWorld, wv, dustAmt);
    this.weather.update(dt, this.surface.planet, this.rig.frame === this.surface.planet ? this.rig.localPos : null, this.stormK || 0);
    const onPlanet = this.screen === 'play' && !this.warp && this.rig.frame instanceof Planet && this.rig.frame.def.atmosphere ? this.rig.frame : null;
    this.meteors.update(this.paused ? 0 : dt, onPlanet, onPlanet ? _v2.copy(this.rig.localPos).normalize() : null);

    this.camera.position.set(0, 0, 0);
    this.camera.quaternion.copy(this.rig.worldQuat);
    const fov = portraitFov(this.rig.fov * (this.visor ? 0.62 : 1), this.camera.aspect);
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
    this.updateDof(dt);
    this.updateAO(dt);
    this.profMark('hud');
    this.pipeline.setAtmospheres(this.system.atmosphereList());
    // Behind a menu the world is paused, so on the low preset a few frames a
    // second is plenty and saves a phone's battery. Frames that aren't drawn
    // just leave the last one on screen.
    const idle = this.quality === PRESETS[0] && this.screen === 'play' && this.paused && this.menuOpen && !this.photo;
    // held while prepareView() compiles shaders and waits for terrain
    if (!this.holdRender && !(idle && this.frame % 6)) this.pipeline.render(this.time, this.shadowsActive, dt);
    if (this.snapNext) {
      this.snapNext = false;
      this.savePhoto();
    }
    this.profMark('render');

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
    this.photoFov = 60;
    this.photoBlur = 0;
    this.photoFilter = this.photoFilter || 0;
    this.applyFilter(FILTERS[this.photoFilter]);
    this.hud.clearMessage();
    this.hud.setVisible(false);
    this.hud.showPhotoHint(true);
    this.tool.setVisible(false);
    this.input.lock();
  }

  exitPhoto() {
    this.photo = false;
    this.applyFilter(FILTERS[0]);
    this.ship.model.root.visible = true;
    this.hud.setVisible(true);
    this.hud.showPhotoHint(false);
    this.tool.setVisible(this.mode === 'foot');
    this.rig.transition = null;
  }

  applyFilter(f) {
    const u = this.pipeline.finalUniforms;
    u.uSaturation.value = f.sat;
    u.uVignette.value = f.vig;
    u.uBloom.value = f.bloom;
    u.uGrain.value = f.grain;
    u.uTint.value.fromArray(f.tint);
    u.uContrast.value = f.contrast;
    u.uLift.value = f.lift;
  }

  // Photo mode keys. The game is paused, so this reads raw key state like
  // the free camera does.
  updatePhoto(dt) {
    const k = this.input.pressed;
    const hud = this.hud;
    const t = (this.input.raw('KeyX') ? 1 : 0) - (this.input.raw('KeyZ') ? 1 : 0);
    if (t) {
      this.shiftTimeOfDay(t * dt);
      const f = this.system.focus;
      if (f instanceof Planet) hud.photoStatus(`Time ${this.localTime(f, f.toLocal(this.debugCam.pos, new THREE.Vector3()))}`);
    }
    if (k.has('Digit1') || k.has('Digit2')) {
      this.photoFov = Math.min(100, Math.max(12, this.photoFov * (k.has('Digit1') ? 0.8 : 1.25)));
      hud.photoStatus(`Zoom ${Math.round(this.photoFov)}°`);
    }
    if (k.has('KeyB')) {
      this.photoBlur = (this.photoBlur + 1) % 3;
      hud.photoStatus(BLUR_NAMES[this.photoBlur]);
    }
    if (k.has('KeyV')) {
      this.photoFilter = (this.photoFilter + 1) % FILTERS.length;
      this.applyFilter(FILTERS[this.photoFilter]);
      hud.photoStatus(FILTERS[this.photoFilter].name);
    }
    if (k.has('KeyH')) {
      const m = this.ship.model.root;
      m.visible = !m.visible;
      hud.photoStatus(m.visible ? 'Ship shown' : 'Ship hidden');
    }
    if (k.has('Enter') || k.has('NumpadEnter')) this.snapNext = true;
  }

  // spins the nearest planet forward or back a bit of a day, carrying the
  // camera along so the shot stays framed while the sun moves
  shiftTimeOfDay(k) {
    const f = this.system.focus;
    if (!f) return;
    const cam = this.debugCam;
    const local = f.toLocal(cam.pos, new THREE.Vector3());
    const lq = f.invQuat.clone().multiply(cam.quat);
    this.state.worldTime += (k * (f.dayLength || 1200)) / 14;
    this.system.updateRotations(this.state.worldTime);
    f.toWorld(local, cam.pos);
    cam.quat.copy(f.quat).multiply(lq);
  }

  // the canvas still holds this frame right after rendering it, so no
  // preserveDrawingBuffer is needed
  savePhoto() {
    const body = this.system.focus;
    const name = `starsong-${this.systemDef.name}${body ? '-' + body.def.name : ''}`.replace(/[^\w-]+/g, '-').toLowerCase();
    this.renderer.domElement.toBlob((blob) => {
      if (!blob) return;
      const download = () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${name}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      };
      // on phones the share sheet is how a picture ends up in the photo library
      const file = new File([blob], `${name}.png`, { type: 'image/png' });
      if (device.touch && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file] }).catch((err) => err.name !== 'AbortError' && download());
      } else download();
    }, 'image/png');
    this.audio.click();
    this.hud.photoStatus('Saved');
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
      // starts past the multitool's tip, from behind it the tool took the full
      // beam at point blank and bloomed into a white blob
      lamp.position.set(0, 0.05, -1.1).applyQuaternion(camInv);
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

  // Autofocus under the crosshair. On foot it only softens what's well behind
  // the focus point. In the ship it stays off, it would blur the planets
  // you're flying toward.
  updateDof(dt) {
    const d = this.pipeline.dof;
    let want = 0;
    if (this.photo) {
      // near and far blur around whatever is under the center of the frame
      want = [0, 0.85, 1][this.photoBlur];
      d.range.set(this.photoBlur === 2 ? 0.06 : 0.18, this.photoBlur === 2 ? 0.5 : 1.3, 1);
      d.spread = this.photoBlur === 2 ? 2.8 : 1.8;
      d.manualFocus = 0;
    } else if (this.screen === 'play' && this.mode === 'foot' && !this.warp && this.settings.dof) {
      want = 0.75;
      d.range.set(1.2, 7, 0);
      d.spread = 1.6;
      d.manualFocus = 0;
    }
    d.amount += (want - d.amount) * Math.min(1, dt * 4);
    if (d.amount < 0.002) d.amount = 0;
  }

  // AO only matters near the ground, from a few hundred meters up there's
  // nothing it can resolve, so the passes are skipped entirely
  updateAO(dt) {
    let want = 0;
    const f = this.system.focus;
    if (this.settings.ao && f && f.heightAt && f.camDist - f.radius - f.maxH < 400) want = 1;
    const p = this.pipeline;
    p.aoAmount += (want - p.aoAmount) * Math.min(1, dt * 3);
    if (p.aoAmount < 0.01 && want === 0) p.aoAmount = 0;
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
    // entry roars even before the surface is streamed in
    if (inShip) wind = Math.max(wind, s.heat * 0.6);
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

  // entry plasma and the orbit line, after the camera has settled for the frame
  updateFlightFx(dt, camWorld) {
    const ship = this.ship;
    const pos = _v.subVectors(ship.worldPos(_v2), camWorld);
    const vel = ship.worldVel(new THREE.Vector3());
    const speed = vel.length();
    const dir = speed > 1 ? vel.divideScalar(speed) : new THREE.Vector3(0, 0, -1).applyQuaternion(ship.worldQuat(_q));
    const heat = this.screen === 'play' && this.mode === 'ship' && !this.warp ? ship.heat : 0;
    this.entryFx.update(pos, dir, heat, this.time);
    // the path hides in photo mode with the rest of the HUD
    if (ship.orbit) {
      this.orbitBody = ship.frame;
      this.orbitEl = ship.orbit.el;
    }
    const show = !!ship.orbit && this.screen === 'play' && this.mode === 'ship' && !this.photo;
    this.orbitLine.update(dt, this.orbitBody, this.orbitEl, show, camWorld);
    const u = this.pipeline.finalUniforms;
    if (!this.warp) u.uAberration.value = heat * 0.35;
  }

  // distance to the nearest atmosphere (or the star's glow), and the world
  // position of that body's center in `near`
  clearanceFor(worldPos, near) {
    let best = Infinity;
    for (const b of this.system.bodies) {
      const d = _v.subVectors(worldPos, b.position).length() - b.atmoRadius;
      if (d < best) {
        best = d;
        if (near) near.copy(b.position);
      }
    }
    const ds = worldPos.length() - this.system.star.radius * 3;
    if (ds < best && near) near.set(0, 0, 0);
    return Math.min(best, ds);
  }

  toggleOrbit() {
    const ship = this.ship;
    if (ship.orbit) return ship.leaveOrbit('manual');
    if (ship.pulse) ship.dropPulse('manual');
    const why = ship.canOrbit();
    if (why === null) return ship.enterOrbit();
    const f = ship.frame;
    if (why === 'space' || why === 'far') this.hud.message('Get closer to a planet to orbit it', 1800);
    else if (why === 'low') this.hud.message(f.def.atmosphere ? 'Climb above the atmosphere to orbit' : 'Climb higher to orbit', 1800);
  }

  // body the pulse drive is homing in on: whatever is close to the aim, and it
  // stays locked until the aim wanders well off it
  updatePulseLock(ship) {
    if (!ship.pulse) {
      this.pulseLock = null;
      return null;
    }
    const wp = ship.worldPos(_v2);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.frame ? _q.multiplyQuaternions(ship.frame.quat, ship.aim) : ship.aim);
    let best = null;
    let bestA = 0.13;
    for (const b of this.system.bodies) {
      const to = _v.subVectors(b.position, wp);
      const d = to.length();
      if (d < b.atmoRadius * 1.2 && b !== this.pulseLock) continue;
      const a = Math.acos(Math.min(1, to.dot(fwd) / d)) - Math.asin(Math.min(1, b.radius / d)) * 0.5;
      const limit = b === this.pulseLock ? 0.35 : bestA;
      if (a < limit && (!best || a < bestA)) {
        bestA = a;
        best = b;
      }
    }
    this.pulseLock = best;
    if (!best) return null;
    // direction to the center, in the ship's frame
    const dir = ship.frame ? ship.frame.toLocal(best.position, new THREE.Vector3()).sub(ship.pos) : best.position.clone().sub(ship.pos);
    return dir.normalize();
  }

  updateShipMode(dt) {
    const ship = this.ship;
    const input = this.input;
    this.visor = false;
    const wp = ship.worldPos(_v2);
    const near = new THREE.Vector3();
    const clearance = this.clearanceFor(wp, near);
    // toward the nearest body, in the ship's frame
    const nearDir = near.sub(wp).normalize();
    if (ship.frame) nearDir.applyQuaternion(ship.frame.invQuat);
    const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.rig.localQuat);
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
          const site = ship.findLandingSite();
          if (site) ship.startLanding(site);
          else this.hud.message('No flat ground here');
        } else if (why === 'fast') this.hud.message('Slow down to land');
        else if (why === 'high') this.hud.message('Get closer to the ground to land');
        else if (why === 'orbit') this.hud.message('Press C to leave orbit first');
      }
      if (input.hit('KeyC')) this.toggleOrbit();
      if (input.hit('KeyF')) this.shipScan();
      // Landing spot preview. Checks straight ahead most of the time and does the
      // full search now and then. False means it looked and found nothing.
      if (ship.canLand() !== null) this.landSite = null;
      else if (this.frame % 10 === 0) {
        const quick = ship.findLandingSite(true);
        if (quick) this.landSite = quick;
        else if (this.frame % 30 === 0 || this.landSite == null) this.landSite = ship.findLandingSite() || false;
      }
    }

    const lockDir = this.updatePulseLock(ship);
    ship.update(dt, input, { clearance, nearDir, lockDir, camDir, time: this.time });

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

    if (input.wheel && ship.orbit) {
      // in orbit the wheel goes from the ship out to a view of the whole orbit
      const max = (soiRadius(ship.frame) * 1.6) / 30;
      this.rig.orbitZoom = Math.max(1, Math.min(max, this.rig.orbitZoom * (input.wheel > 0 ? 1.5 : 1 / 1.5)));
    } else if (input.wheel) this.rig.zoom = Math.max(0.6, Math.min(2.2, this.rig.zoom * (input.wheel > 0 ? 1.1 : 0.9)));
    if (ship.heat > 0.02) this.rig.shake(ship.heat * dt * 2.5);
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
    const firing = ship.state === 'flying' && !ship.pulse && !ship.orbit && this.input.mouse(0);
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
        if (e.reason === 'proximity') {
          const f = this.ship.frame;
          this.hud.message(f && f === this.pulseLock ? `Arrived at ${f.def.name}` : 'Pulse drive disengaged', 1800);
        }
        this.audio.whoosh(0.8, 0.15);
        break;
      case 'pulseBlocked':
        if (e.reason === 'atmo') this.hud.message('Leave the atmosphere to use the pulse drive', 1800);
        else if (e.reason === 'reverse') this.hud.message('Throttle up to use the pulse drive', 1800);
        else this.hud.message('Too close to a planet. Aim away from it', 1800);
        this.audio.error();
        break;
      case 'orbitStart': {
        if (e.instant) break;
        this.rig.orbitYaw = 0.35;
        this.rig.orbitPitch = -0.25;
        this.rig.orbitZoom = 1;
        this.hud.message(`Orbiting ${this.ship.frame.def.name}`, 2000);
        this.audio.whoosh(1.2, 0.14);
        break;
      }
      case 'orbitEnd':
        if (e.reason === 'entry') this.hud.message(this.ship.frame && this.ship.frame.def.atmosphere ? 'Atmospheric entry' : 'Leaving orbit', 1800);
        else if (e.reason === 'escape') this.hud.message('Escaped orbit', 1800);
        this.audio.whoosh(0.7, 0.12);
        break;
      case 'entry':
        this.rig.shake(0.35);
        this.audio.whoosh(3.0, 0.3);
        break;
      case 'roll':
        this.audio.whoosh(0.45, 0.12);
        break;
      case 'boost':
        this.rig.shake(0.12);
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
      // out in space the scanner reads whatever world is under the reticle
      const body = this.bodyUnderReticle();
      if (body) this.hud.showCard(this.bodyFacts(body), this.state.discoveries[body.def.id] ? 'Scan' : 'Scan · Undiscovered');
      else this.hud.message('Point at a planet to scan it');
      return;
    }
    const local = this.ship.pos;
    const fresh = this.surface.pois.reveal(local, 4000, ['monolith', 'ruin', 'cache', 'beacon', 'deposit', 'wonder']);
    this.reportScan(fresh);
  }

  // jumps left on the route set in the galaxy map, for the HUD
  refreshRoute() {
    const st = this.state;
    this.routeInfo = null;
    if (st.route === null || st.route === undefined || !this.galaxy) return;
    const s = stats(st);
    const plan = planRoute(this.galaxy, st.systemIndex, st.route, s.warpRange, s.warpClasses);
    if (plan && plan.length > 1) this.routeInfo = { name: this.galaxy.name(st.route), jumps: plan.length - 1, next: this.galaxy.name(plan[1]) };
  }

  // closest body to the center of the view, within about 12 degrees
  bodyUnderReticle() {
    const fwd = _v.set(0, 0, -1).applyQuaternion(this.rig.worldQuat);
    let best = null;
    let bestA = 0.21;
    for (const b of this.system.bodies) {
      const to = _v2.subVectors(b.position, this.rig.worldPos);
      const d = to.length();
      // angular size helps big planets that fill the view
      const a = Math.acos(Math.min(1, to.dot(fwd) / d)) - Math.asin(Math.min(1, b.radius / d));
      if (a < bestA) {
        bestA = a;
        best = b;
      }
    }
    return best;
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
        if (used) return this.hud.message('Echo Stone already used');
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
        if (used) return this.hud.message('Ruins already searched');
        pois.markUsed(poi);
        const text = echoText(poi.seed + 7, planet.def.name, this.systemDef.name);
        this.state.lore.push({ title: 'Chorus Ruins', text });
        this.gain('relic', 2, true);
        this.state.data += 60;
        this.audio.chorus();
        this.menus.showDialog('Chorus Ruins', text, '+2 Relic Shards · +60 Data');
        this.openDialog();
        break;
      }
      case 'cache': {
        if (used) return this.hud.message('Supply pod already opened');
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
      case 'wonder': {
        if (used) return this.hud.message('Wreck already searched');
        pois.markUsed(poi);
        const text = wreckLog(poi.seed, poi.name, planet.def.name);
        this.state.lore.push({ title: poi.name, text });
        const rng = new RNG(poi.seed ^ 0x3e1);
        this.gain(rng.pick(['ferrite', 'lumen', 'hydrogel']), 40 + rng.int(0, 30), true);
        let extra = '';
        if (rng.chance(0.6)) {
          this.state.warpCells++;
          extra = ' · +1 Warp Cell';
        }
        this.state.data += 80;
        this.audio.chorus();
        this.menus.showDialog(poi.name, text, `+80 Data${extra}`);
        this.openDialog();
        break;
      }
      case 'beacon': {
        if (used) return this.hud.message('Beacon already used');
        pois.markUsed(poi);
        const fresh = pois.reveal(this.walker.pos, 5000, ['monolith', 'ruin', 'cache']);
        this.audio.ping();
        this.hud.message('Beacon scan complete', 2000);
        this.reportScan(fresh);
        break;
      }
      case 'spire': {
        const i = poi.story;
        if (!this.story.onSpire(poi)) {
          this.audio.chorus();
          return this.hud.message(i < this.state.story.resonance ? 'Spire already activated' : 'Spire not active yet');
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
      const how = device.touch ? 'tap Recharge shield' : 'press R to recharge';
      this.hud.message(this.state.count('lumen') >= 10 ? `Hazard shield low, ${how}` : 'Hazard shield low, find Lumen or return to your ship', 3500);
    } else if (suit.shield > 0.4) this.shieldWarned = false;
    if (suit.health <= 0) this.die();
  }

  die() {
    if (this.dying) return;
    this.dying = true;
    this.menus.deathText.textContent = 'Respawned at your ship. Some cargo was lost.';
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
    const comet = this.system.comet;
    if (comet && this.mode === 'ship' && !this.cometSeen) {
      const d = this.ship.worldPos(_v).distanceTo(comet.position);
      if (d < 3500) {
        this.cometSeen = true;
        if (!this.state.wonders) this.state.wonders = [];
        if (!this.state.wonders.some((w) => w.kind === 'comet' && w.name === comet.name && w.system === this.systemDef.name)) {
          this.state.wonders.push({ name: comet.name, kind: 'comet', planet: this.systemDef.name, system: this.systemDef.name });
          this.hud.banner(comet.name, 'Comet discovered');
          this.addData(60, 'Comet');
          this.audio.discovery();
          this.saveSoon = true;
        }
      }
    }
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
    else if (!s.warpClasses.includes(this.galaxy.classOf(star))) err = "Your drive can't reach that star yet.";
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
    this.ship.resetMotion();
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
      if (!document.pointerLockElement && !this.params.has('capture') && !device.touch) this.openMenu('pause');
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
      if (found && found.wonderTotal) sub += ` · Landmarks ${found.wonders || 0}/${found.wonderTotal}`;
      if (body instanceof Planet && frameBody) {
        const local = this.mode === 'foot' ? this.walker.pos : this.ship.pos;
        sub += ` · ${this.localTime(body, local)}`;
      }
    }
    hud.setLocation(`${sys.name} · ${sys.starLabel || cls.label}`, body ? body.def.name : 'Deep space', sub);
    const r = this.routeInfo;
    hud.setRoute(r ? `Route to <b>${r.name}</b> · ${r.jumps} jump${r.jumps > 1 ? 's' : ''} left · next ${r.next}` : null);
    const obj = this.story.objective();
    hud.setObjective(obj ? obj.title : null, obj ? obj.text : null);

    if (this.mode === 'ship') {
      const s = this.ship;
      const o = s.orbit;
      let mode = 'Impulse';
      let sub = '';
      if (o) {
        mode = o.settle < 1 ? 'Entering orbit' : o.warp > 1.5 ? 'Orbit · Fast forward' : 'Orbit';
        sub = this.orbitSub(s);
      } else if (s.pulse) {
        mode = 'Pulse drive';
        const t = this.pulseLock;
        if (t) sub = `${t.def.name} · ${this.pulseEta(s, t)}`;
      } else if (s.queuedPulse) mode = 'Pulse drive';
      else if (s.state === 'landed') mode = 'Landed';
      else if (s.state === 'landing') mode = 'Landing';
      else if (s.state === 'takeoff') mode = 'Launching';
      else if (s.heat > 0.25) mode = 'Atmospheric entry';
      else if (s.inAtmo > 0.5) mode = 'Atmospheric flight';
      else if (s.boost > 0.2) mode = 'Boost';
      hud.updateFlight({ mode, sub, speed: o ? o.v.length() : s.speed, alt: s.frame ? s.altitude : Infinity, throttle: s.throttle, energy: s.energy, pulse: s.pulse, orbit: !!o });
      hud.setHeat(s.heat);
      let actions = [];
      const flying = s.state === 'flying';
      const exit = { code: 'KeyE', key: 'E', label: 'Exit ship' };
      // no take off prompt while the thrusters are still broken
      if (s.state === 'landed') actions = this.state.story.stage === 'repair' ? [exit] : [exit, { code: 'KeyW', key: 'W', label: 'Take off' }];
      else if (flying && s.canLand() === null) actions = [this.landSite === false ? { label: 'No flat ground here' } : { code: 'KeyE', key: 'E', label: 'Land' }];
      else if (flying && !s.pulse && s.canOrbit() === null) actions = [{ code: 'KeyC', key: 'C', label: 'Orbit' }];
      hud.prompt(promptHtml(actions));
      // the keyboard hint lists C for leaving orbit, touch needs a button
      this.touch.setActions(o ? [{ code: 'KeyC', label: 'Leave orbit' }] : actions);
      if (flying) {
        const wp = s.worldPos(new THREE.Vector3());
        const wq = s.worldQuat(new THREE.Quaternion());
        const nose = this.project(wp.clone().addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(wq), 3000), {});
        hud.setNose(nose.x - this.viewW / 2, nose.y - this.viewH / 2, !nose.edge && !o);
        // where the ship is actually going, when that's not where it points
        const v = s.worldVel(new THREE.Vector3());
        const vs = v.length();
        const fpm = this.project(wp.addScaledVector(v, 3000 / Math.max(vs, 1)), {});
        const off = Math.hypot(fpm.x - nose.x, fpm.y - nose.y);
        hud.setVelocity(fpm.x - this.viewW / 2, fpm.y - this.viewH / 2, vs > 20 && !fpm.edge && !s.pulse && (off > 14 || !!o));
      } else {
        hud.setNose(0, 0, false);
        hud.setVelocity(0, 0, false);
      }
      hud.setTarget(this.shipTarget);
    } else {
      let actions = [];
      if (this.nearPoi) actions = [{ code: 'KeyE', key: 'E', label: POI_INFO[this.nearPoi.type].verb || 'Interact' }];
      else if (this.nearShip) actions = [{ code: 'KeyE', key: 'E', label: this.state.story.stage === 'repair' ? 'Repair and board ship' : 'Board ship' }];
      hud.prompt(promptHtml(actions));
      const hz = this.walker.frame.def.hazard;
      const suit = this.state.suit;
      // R has no prompt on desktop, the low shield warning names the key
      const recharge = this.hazardActive && suit.shield < 0.5 && this.state.count('lumen') >= 10;
      this.touch.setActions(recharge ? [...actions, { code: 'KeyR', label: 'Recharge shield' }] : actions);
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
        const known = this.state.discoveries[b.def.id];
        markers.push({ id: `b${b.index}`, x: p.x, y: p.y, visible, edge: p.edge, label: b.def.name + (isGoal ? ' · Signal' : ''), sub: `${known ? '' : 'Unexplored · '}${fmtDist(p.dist - b.radius)}`, kind: isGoal ? 'signal' : 'body', color: isGoal ? '#e6d4ff' : b.def.kind === 'gas' ? '#ffd9a0' : '#cfe9ff' });
      }
      const comet = this.system.comet;
      if (comet) {
        const p = this.project(comet.position, tmp);
        const seen = this.state.wonders && this.state.wonders.some((w) => w.kind === 'comet' && w.name === comet.name && w.system === sys.name);
        if (p.dist > comet.radius * 6 && p.dist < 400000) markers.push({ id: 'comet', x: p.x, y: p.y, visible: !p.edge || p.dist < 120000, edge: p.edge, label: seen ? comet.name : 'Comet', sub: fmtDist(p.dist), kind: 'poi', color: '#bfe6ff' });
      }
      const s = this.ship;
      if (s.orbit && s.frame) {
        const el = s.orbit.el;
        const f = s.frame;
        const sp = this.project(s.worldPos(new THREE.Vector3()), tmp);
        if (sp.dist > 400) markers.push({ id: 'ship', x: sp.x, y: sp.y, visible: true, edge: sp.edge, label: 'Ship', sub: '', kind: 'ship', color: '#ffb45e' });
        const apsis = [];
        if (el.ecc > 0.01 && el.pe > f.radius) apsis.push(['pe', 'Pe', this.orbitLine.pe, el.pe]);
        if (el.ecc > 0.01 && el.ecc < 1 && el.ap < orbitFloor(f) * 3) apsis.push(['ap', 'Ap', this.orbitLine.ap, el.ap]);
        for (const [id, label, local, r] of apsis) {
          const wp = f.toWorld(local, new THREE.Vector3());
          // hidden behind the planet
          const cam = this.rig.worldPos;
          const d = _v.subVectors(wp, cam);
          const t = Math.max(0, Math.min(1, _v2.subVectors(f.position, cam).dot(d) / d.lengthSq()));
          if (d.multiplyScalar(t).add(cam).distanceTo(f.position) < f.radius) continue;
          const p = this.project(wp, tmp);
          if (!p.edge) markers.push({ id, x: p.x, y: p.y, visible: true, label, sub: fmtDist(r - f.radius), kind: 'apsis', color: r < orbitFloor(f) ? '#ffb080' : '#9fdcff' });
        }
      }
      if (s.state === 'flying' && this.landSite && s.canLand() === null && s.frame instanceof Planet) {
        const f = s.frame;
        const g = this.landSite.clone().multiplyScalar(f.radius + Math.max(0, f.heightAt(this.landSite)) + 1);
        const p = this.project(f.toWorld(g, new THREE.Vector3()), tmp);
        markers.push({ id: 'land', x: p.x, y: p.y, visible: !p.edge, label: 'Landing site', sub: '', kind: 'land', color: '#9dffb0' });
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
        const lift = poi.type === 'spire' ? 30 : poi.type === 'wonder' ? (poi.height || 30) * 0.7 : 3;
        const wp = frameBody.toWorld(poi.pos.clone().addScaledVector(poi.dir, lift), new THREE.Vector3());
        const p = this.project(wp, {});
        const wonder = poi.type === 'wonder';
        if (p.dist > (wonder ? 7500 : 6000) || p.dist < (wonder ? poi.reach * 0.8 : 6)) continue;
        const info = POI_INFO[poi.type];
        let label = poi.type === 'deposit' ? `${RESOURCES[poi.res].name} Deposit` : info.label;
        if (wonder) label = this.surface.pois.isFound(poi) ? poi.name : 'Unknown landmark';
        markers.push({ id: `p${poi.id}`, x: p.x, y: p.y, visible: true, edge: p.edge, label, sub: fmtDist(p.dist), kind: poi.type === 'spire' ? 'signal' : 'poi', color: poi.type === 'deposit' ? RESOURCES[poi.res].color : info.color });
      }
    }
    hud.setMarkers(markers);

    let hint = null;
    const orbiting = this.mode === 'ship' && this.ship.orbit;
    const footIntro = this.state.playTime < 90 && this.mode === 'foot';
    const shipIntro = this.state.playTime < 400 && this.mode === 'ship' && this.state.story.stage === 'explore' && !this.ship.orbit;
    // the touch buttons are labeled, so these only cover what the screen doesn't show
    if (device.touch) {
      if (orbiting) hint = 'Left stick raises, lowers and tilts the orbit<br>Pulse heads where you look<br>Pinch to zoom out';
      else if (footIntro) hint = 'Left side moves, right side looks<br>Push the stick all the way to sprint<br>Drag on Mine to aim while mining';
      else if (shipIntro && this.ship.state === 'flying') hint = 'Drag on the right to steer<br>Left stick for throttle and roll<br>Pulse to travel between planets';
    } else if (orbiting) hint = '<kbd>W</kbd><kbd>S</kbd>Raise, lower orbit<br><kbd>A</kbd><kbd>D</kbd>Tilt orbit<br><kbd>Shift</kbd>Fast forward<br><kbd>Wheel</kbd>Zoom out<br><kbd>Space</kbd>Pulse where you look<br><kbd>C</kbd>Leave orbit';
    else if (footIntro) hint = '<kbd>LMB</kbd>Mine<br><kbd>RMB</kbd>Analyze<br><kbd>F</kbd>Scan<br><kbd>Tab</kbd>Inventory';
    else if (shipIntro) hint = '<kbd>Space</kbd>Pulse drive<br><kbd>Shift</kbd>Boost<br><kbd>C</kbd>Orbit<br><kbd>RMB</kbd>Look around<br><kbd>F</kbd>Scan planet';
    hud.setHint(hint);
  }

  orbitSub(s) {
    const o = s.orbit;
    const f = s.frame;
    const el = o.el;
    if (o.settle < 1) return 'Matching speed';
    if (el.ecc >= 1) return 'Escape path';
    const floor = orbitFloor(f);
    if (el.pe < floor) {
      const t = timeToRadius(el, floor, o.mu);
      const what = f.def.atmosphere ? 'Entry' : 'Descent';
      return Number.isFinite(t) ? `${what} in ${fmtTime(t)}` : what;
    }
    if (el.ecc < 0.02) return `Circular · ${fmtTime(el.period)} per lap`;
    return `Ap ${fmtDist(el.ap - f.radius)} · Pe ${fmtDist(el.pe - f.radius)}`;
  }

  // rough, the drive speeds up and slows down on its own
  pulseEta(s, body) {
    const d = s.worldPos(_v).distanceTo(body.position) - body.atmoRadius - 600;
    if (d < 1000) return 'arriving';
    const t = s.pulseSpool < 1 ? 3 : 0;
    return `${Math.max(1, Math.round(Math.log(Math.max(1, d / 600)) / 0.9 + t))} s`;
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

// actions are { code, key, label }, one without a code is just a note
function promptHtml(actions) {
  if (!actions.length) return null;
  return actions.map((a) => (a.code ? `<kbd>${a.key}</kbd>${a.label}` : `<span class="dim">${a.label}</span>`)).join(' &nbsp; ');
}

function fmtTime(t) {
  const m = Math.floor(t / 60);
  const sec = Math.floor(t % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
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
