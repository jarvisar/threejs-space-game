import * as THREE from 'three';
import { STAR_CLASSES, CLASS_KEYS, GALAXY_RADIUS, CORE_INDEX } from '../gen/galaxy.js';
import { generateSystem } from '../gen/system.js';
import { stats } from '../game/upgrades.js';
import { RNG } from '../core/rng.js';
import { radialTexture } from '../render/textures.js';

const starVert = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aState;
uniform float uScale;
uniform float uTime;
varying vec3 vColor;
varying float vState;
void main() {
  vColor = aColor;
  vState = aState;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float s = aSize * (1.0 + step(0.5, aState) * 0.7);
  gl_PointSize = clamp(s * uScale * 900.0 / -mv.z, 1.5, 26.0);
  gl_Position = projectionMatrix * mv;
}
`;
const starFrag = /* glsl */ `
varying vec3 vColor;
varying float vState;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float core = smoothstep(0.5, 0.0, d);
  core *= core;
  float dim = vState < -0.5 ? 0.35 : 1.0;
  gl_FragColor = vec4(vColor * core * dim * 1.6, 1.0);
}
`;

function glowTexture(inner, outer) {
  return radialTexture(256, [[0, inner], [0.3, outer], [1, 'rgba(0,0,0,0)']]);
}

function ringTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(s / 2, s / 2, s / 2 - 8, 0, Math.PI * 2);
  g.stroke();
  return new THREE.CanvasTexture(c);
}

// Galaxy map with orbit camera, star picking and the warp button. Rendered
// with its own scene through the pipeline's bloom/tonemap.
export class GalaxyMap {
  constructor(game, uiRoot) {
    this.game = game;
    this.galaxy = null;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.5, 20000);
    this.target = new THREE.Vector3();
    this.goalTarget = new THREE.Vector3();
    this.yaw = 0.6;
    this.pitch = 0.9;
    this.dist = 260;
    this.goalDist = 260;
    this.selected = -1;
    this.hover = -1;
    this.mouse = null;
    this.open = false;
    this.dragging = false;
    this.buildUi(uiRoot);
    this.bindInput();
  }

  setGalaxy(galaxy) {
    if (this.galaxy === galaxy) return;
    this.galaxy = galaxy;
    for (const o of this.scene.children) {
      // sprites share one geometry inside three.js
      if (o.geometry && !o.isSprite) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    }
    this.scene.clear();
    const n = galaxy.count;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(galaxy.positions, 3));
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const tmp = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const cls = STAR_CLASSES[CLASS_KEYS[galaxy.classes[i]]];
      tmp.set(cls.color);
      col[i * 3] = tmp.r;
      col[i * 3 + 1] = tmp.g;
      col[i * 3 + 2] = tmp.b;
      size[i] = cls.tier >= 3 ? 1.5 : cls.tier === 2 ? 1.25 : 1.0;
    }
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.stateAttr = new THREE.BufferAttribute(new Float32Array(n), 1);
    geo.setAttribute('aState', this.stateAttr);
    this.starUniforms = { uScale: { value: 1 }, uTime: { value: 0 } };
    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({ uniforms: this.starUniforms, vertexShader: starVert, fragmentShader: starFrag, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })
    );
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    // faint dust following the same arms, so the spiral reads when zoomed out
    const dustN = 60000;
    const rng = new RNG(galaxy.seed ^ 0xd057);
    const dp = new Float32Array(dustN * 3);
    const dc = new Float32Array(dustN * 3);
    const ds = new Float32Array(dustN);
    const warm = new THREE.Color('#ffcf9a');
    const cool = new THREE.Color('#8fb4ff');
    for (let i = 0; i < dustN; i++) {
      let r = -Math.log(1 - rng.next() * 0.97) * 320 + 20;
      r = Math.min(r, GALAXY_RADIUS * 1.05);
      const arm = rng.int(0, galaxy.arms - 1);
      const spread = 0.12 + 0.3 * (1 - r / GALAXY_RADIUS);
      const th = rng.chance(0.85)
        ? galaxy.armOffset + (arm * Math.PI * 2) / galaxy.arms + Math.log(Math.max(r, 30) / 60) / Math.tan(galaxy.pitch) + rng.gauss() * spread
        : rng.range(0, Math.PI * 2);
      dp[i * 3] = r * Math.cos(th);
      dp[i * 3 + 1] = rng.gauss() * (6 + 30 * Math.exp(-r / 200));
      dp[i * 3 + 2] = r * Math.sin(th);
      const c = cool.clone().lerp(warm, Math.exp(-r / 350));
      const b = rng.range(0.05, 0.16);
      dc[i * 3] = c.r * b;
      dc[i * 3 + 1] = c.g * b;
      dc[i * 3 + 2] = c.b * b;
      ds[i] = rng.range(1.2, 3);
    }
    const dgeo = new THREE.BufferGeometry();
    dgeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    dgeo.setAttribute('aColor', new THREE.BufferAttribute(dc, 3));
    dgeo.setAttribute('aSize', new THREE.BufferAttribute(ds, 1));
    dgeo.setAttribute('aState', new THREE.BufferAttribute(new Float32Array(dustN), 1));
    const dust = new THREE.Points(dgeo, this.points.material);
    dust.frustumCulled = false;
    this.scene.add(dust);

    // soft disc and core glow
    const disc = new THREE.Mesh(
      new THREE.PlaneGeometry(GALAXY_RADIUS * 2.6, GALAXY_RADIUS * 2.6),
      new THREE.MeshBasicMaterial({ map: glowTexture('rgba(255,210,160,0.5)', 'rgba(90,110,200,0.12)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })
    );
    disc.rotation.x = -Math.PI / 2;
    this.scene.add(disc);
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,240,210,1)', 'rgba(255,170,90,0.35)'), color: new THREE.Color(3, 2.6, 2.2), blending: THREE.AdditiveBlending, depthWrite: false }));
    core.scale.setScalar(360);
    this.scene.add(core);

    const ringTex = ringTexture();
    this.hereMarker = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, color: new THREE.Color(1.5, 1.0, 0.4), depthWrite: false, depthTest: false }));
    this.hereMarker.scale.setScalar(8);
    this.scene.add(this.hereMarker);
    this.selMarker = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, color: new THREE.Color(0.6, 1.4, 2.0), depthWrite: false, depthTest: false }));
    this.selMarker.scale.setScalar(7);
    this.scene.add(this.selMarker);
    this.goalMarker = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, color: new THREE.Color(1.6, 1.4, 2.4), depthWrite: false, depthTest: false }));
    this.goalMarker.scale.setScalar(10);
    this.scene.add(this.goalMarker);
    // small fixed-size rings around systems already visited
    this.visitedPts = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ map: ringTex, size: 12, sizeAttenuation: false, color: new THREE.Color(0.75, 0.9, 1.1), transparent: true, opacity: 0.7, depthWrite: false, depthTest: false })
    );
    this.visitedPts.frustumCulled = false;
    this.scene.add(this.visitedPts);

    const rangeGeo = new THREE.RingGeometry(0.985, 1, 96);
    rangeGeo.rotateX(-Math.PI / 2);
    this.rangeRing = new THREE.Mesh(rangeGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 0.7, 0.3), transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
    this.scene.add(this.rangeRing);
    const sphereGeo = new THREE.SphereGeometry(1, 32, 16);
    this.rangeSphere = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.5, 0.2), transparent: true, opacity: 0.025, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending }));
    this.scene.add(this.rangeSphere);

    this.routeGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.route = new THREE.Line(this.routeGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(0.6, 1.4, 2.0), transparent: true, opacity: 0.8 }));
    // the line ends move every frame, a stale bounding sphere would cull them
    this.route.frustumCulled = false;
    this.scene.add(this.route);
    this.goalGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.goalLine = new THREE.Line(this.goalGeo, new THREE.LineDashedMaterial({ color: new THREE.Color(1.2, 1.0, 1.8), dashSize: 4, gapSize: 3, transparent: true, opacity: 0.6 }));
    this.goalLine.frustumCulled = false;
    this.scene.add(this.goalLine);
  }

  buildUi(root) {
    const ui = document.createElement('div');
    ui.className = 'gmap';
    ui.innerHTML = `
      <div class="gmap-title">Galaxy Map</div>
      <div class="gmap-legend">
        <div><i style="--c:#ffb877"></i>Red, orange, yellow stars</div>
        <div><i style="--c:#e8eeff"></i>White stars, needs Frost Drive</div>
        <div><i style="--c:#8fb0ff"></i>Blue giants, needs Azure Drive</div>
        <div><i style="--c:#c07bff"></i>Anomalous stars, needs Chorus Drive</div>
        <div><i class="ring"></i>Visited</div>
        <div class="gmap-keys"><kbd>Drag</kbd>rotate <kbd>Wheel</kbd>zoom <kbd>C</kbd>center <kbd>T</kbd>signal <kbd>G</kbd>close</div>
      </div>
      <div class="gmap-info"></div>
      <div class="gmap-hover"></div>`;
    root.appendChild(ui);
    this.ui = ui;
    this.info = ui.querySelector('.gmap-info');
    this.hoverEl = ui.querySelector('.gmap-hover');
    this.info.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      if (b.dataset.act === 'warp') this.game.requestWarp(this.selected);
      if (b.dataset.act === 'core') this.game.requestCoreJump();
    });
  }

  bindInput() {
    const canvas = this.game.renderer.domElement;
    let lx = 0, ly = 0, moved = 0;
    canvas.addEventListener('mousedown', (e) => {
      if (!this.open) return;
      this.dragging = true;
      moved = 0;
      lx = e.clientX;
      ly = e.clientY;
    });
    window.addEventListener('mouseup', (e) => {
      if (!this.open) return;
      if (this.dragging && moved < 5 && e.target === canvas) {
        const i = this.pick(e.clientX, e.clientY);
        if (i >= 0) this.select(i);
      }
      this.dragging = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.open) return;
      if (this.dragging) {
        const dx = e.clientX - lx, dy = e.clientY - ly;
        moved += Math.abs(dx) + Math.abs(dy);
        lx = e.clientX;
        ly = e.clientY;
        this.yaw -= dx * 0.005;
        this.pitch = Math.max(0.05, Math.min(1.5, this.pitch + dy * 0.005));
        this.mouse = null;
      } else {
        // picking tests every star, so it runs once per frame at most
        this.mouse = { x: e.clientX, y: e.clientY, over: e.target === canvas };
      }
    });
    canvas.addEventListener('wheel', (e) => {
      if (!this.open) return;
      this.goalDist = Math.max(25, Math.min(3200, this.goalDist * (e.deltaY > 0 ? 1.15 : 0.87)));
    }, { passive: true });
    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (e.code === 'KeyC') this.focusStar(this.game.state.systemIndex);
      if (e.code === 'KeyT') {
        const goal = this.goalStar();
        if (goal >= 0) {
          this.focusStar(goal);
          this.select(goal);
        }
      }
    });
  }

  goalStar() {
    const st = this.game.state.story;
    const res = this.galaxy.story.resonances;
    if (['signal', 'upgrade', 'spire'].includes(st.stage) && st.resonance < res.length) return res[st.resonance];
    return -1;
  }

  focusStar(i) {
    if (i < 0) return;
    this.goalTarget.fromArray(this.galaxy.pos(i));
  }

  show() {
    this.open = true;
    this.ui.classList.add('open');
    const here = this.game.state.systemIndex;
    this.target.fromArray(this.galaxy.pos(here));
    this.goalTarget.copy(this.target);
    // open wide so the spiral is visible, then ease in toward the current star
    this.dist = 1500;
    // the core glow fills the screen up close
    this.goalDist = here === CORE_INDEX ? 900 : 260;
    this.refreshStates();
    this.select(this.selected >= 0 ? this.selected : -1);
  }

  hide() {
    this.open = false;
    this.ui.classList.remove('open');
    this.mouse = null;
    this.setHover(-1);
  }

  refreshStates() {
    const g = this.galaxy;
    const st = this.game.state;
    const s = stats(st);
    const here = g.pos(st.systemIndex);
    const arr = this.stateAttr.array;
    for (let i = 0; i < g.count; i++) {
      const dx = g.positions[i * 3] - here[0], dy = g.positions[i * 3 + 1] - here[1], dz = g.positions[i * 3 + 2] - here[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const allowed = s.warpClasses.includes(CLASS_KEYS[g.classes[i]]);
      arr[i] = d <= s.warpRange && allowed ? 1 : d <= s.warpRange ? 0 : -1;
    }
    for (const v of st.visited) arr[v] = Math.max(arr[v], 0.2);
    this.stateAttr.needsUpdate = true;
    const seen = st.visited.filter((v) => v >= 0 && v !== st.systemIndex);
    const vp = new Float32Array(seen.length * 3);
    seen.forEach((v, i) => vp.set(g.pos(v), i * 3));
    this.visitedPts.geometry.dispose();
    this.visitedPts.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(vp, 3));
    this.visitedPts.material.size = 12 * this.game.renderer.getPixelRatio();
    this.range = s.warpRange;
    this.hereMarker.position.fromArray(here);
    this.rangeRing.position.fromArray(here);
    this.rangeRing.scale.setScalar(s.warpRange);
    this.rangeSphere.position.fromArray(here);
    this.rangeSphere.scale.setScalar(s.warpRange);
    const goal = this.goalStar();
    this.goalMarker.visible = goal >= 0;
    this.goalLine.visible = goal >= 0;
    if (goal >= 0) {
      this.goalMarker.position.fromArray(g.pos(goal));
      this.goalGeo.setFromPoints([new THREE.Vector3().fromArray(here), new THREE.Vector3().fromArray(g.pos(goal))]);
      this.goalLine.computeLineDistances();
    }
  }

  // nearest star within 14 px of a screen point, or -1
  pick(x, y) {
    const g = this.galaxy;
    const w = this.game.viewW, h = this.game.viewH;
    const v = new THREE.Vector3();
    let best = -1, bd = 14 * 14;
    for (let i = 0; i < g.count; i++) {
      v.set(g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]).project(this.camera);
      if (v.z > 1 || v.z < -1) continue;
      const sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h;
      const d = (sx - x) * (sx - x) + (sy - y) * (sy - y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  // name, class and distance next to the cursor
  setHover(i, x, y) {
    this.game.renderer.domElement.style.cursor = !this.open ? '' : i >= 0 ? 'pointer' : 'grab';
    if (i < 0) {
      this.hover = -1;
      this.hoverEl.classList.remove('show');
      return;
    }
    if (i !== this.hover) {
      const g = this.galaxy;
      const st = this.game.state;
      const info = g.info(i);
      const cls = STAR_CLASSES[info.cls];
      let sub = 'You are here';
      if (i !== st.systemIndex) sub = `${cls.label} · ${Math.round(g.dist(st.systemIndex, i))} ly${st.visited.includes(i) ? ' · Visited' : ''}`;
      this.hoverEl.innerHTML = `<b style="--c:${cls.color}">${info.name}</b>${sub}`;
    }
    this.hover = i;
    this.hoverEl.classList.add('show');
    this.hoverEl.style.transform = `translate(${Math.round(x + 16)}px, ${Math.round(y + 12)}px)`;
  }

  select(i) {
    this.selected = i;
    const g = this.galaxy;
    const st = this.game.state;
    if (i < 0) {
      this.selMarker.visible = false;
      this.route.visible = false;
      this.renderInfo();
      return;
    }
    this.selMarker.visible = true;
    this.selMarker.position.fromArray(g.pos(i));
    this.route.visible = true;
    this.routeGeo.setFromPoints([new THREE.Vector3().fromArray(g.pos(st.systemIndex)), new THREE.Vector3().fromArray(g.pos(i))]);
    this.renderInfo();
  }

  // err replaces the usual reason, for a jump that failed at the last check
  renderInfo(err) {
    const g = this.galaxy;
    const st = this.game.state;
    const i = this.selected;
    const here = st.systemIndex;
    const blocker = this.game.warpBlocker();
    let html = '';
    const hereInfo = g.info(here);
    html += `<div class="gi-here">Current: <b>${hereInfo.name}</b> · ${Math.round(g.distToCore(here))} ly from the core</div>`;
    if (i >= 0 && i !== here) {
      const info = g.info(i);
      const cls = STAR_CLASSES[info.cls];
      const dist = g.dist(here, i);
      const s = stats(st);
      const sys = generateSystem(g, i, g.story);
      const visited = st.visited.includes(i);
      const allowed = s.warpClasses.includes(info.cls);
      const inRange = dist <= s.warpRange;
      const isGoal = i === this.goalStar();
      let why = err || '';
      if (!why) {
        if (!allowed) why = `Your drive cannot hold ${cls.label.toLowerCase()}s yet.`;
        else if (!inRange) why = `Out of range (${Math.round(s.warpRange)} ly).`;
        else if (st.warpCells < 1) why = 'You need a Warp Cell. Craft one from Hydrogel and Ferrite.';
        else if (blocker) why = blocker;
      }
      const types = sys.planets.map((p) => p.typeLabel);
      const summary = [...new Set(types)].slice(0, 5).join(', ');
      html += `<div class="gi-name" style="--c:${cls.color}">${info.name}${isGoal ? ' <span class="gi-goal">Signal</span>' : ''}</div>
        <div class="gi-row">${cls.label} · ${Math.round(dist)} ly away${visited ? ' · Visited' : ''}</div>
        <div class="gi-row">${sys.planets.length} bodies: ${summary}</div>
        <div class="gi-row">${Math.round(g.distToCore(i))} ly from the core</div>
        ${why ? `<div class="gi-why">${why}</div>` : ''}
        <button class="btn primary" data-act="warp" ${why ? 'disabled' : ''}>Warp (1 cell)</button>`;
    } else {
      html += `<div class="gi-hint">Click a star to plot a jump. Bright stars are in range.</div>`;
    }
    if ((st.story.stage === 'core' || st.story.stage === 'end') && here !== CORE_INDEX) {
      const ready = st.story.flags.lens && st.warpCells >= 1;
      const note = ready && blocker ? `<div class="gi-why">${blocker}</div>` : '';
      html += `<div class="gi-core"><b>Core Jump</b><div>Uses the Harmonic Lens and one Warp Cell.</div>${note}<button class="btn primary" data-act="core" ${ready && !blocker ? '' : 'disabled'}>Jump to the core</button></div>`;
    }
    html += `<div class="gi-cells">${st.warpCells} Warp Cell${st.warpCells === 1 ? '' : 's'} · Range ${Math.round(stats(st).warpRange)} ly</div>`;
    this.info.innerHTML = html;
  }

  render(dt, pipeline) {
    const m = this.mouse;
    if (m) {
      this.mouse = null;
      this.setHover(m.over ? this.pick(m.x, m.y) : -1, m.x, m.y);
    } else if (this.dragging && this.hover >= 0) this.setHover(-1);
    this.target.lerp(this.goalTarget, 1 - Math.exp(-dt * 6));
    this.dist += (this.goalDist - this.dist) * (1 - Math.exp(-dt * 3.5));
    const cp = Math.cos(this.pitch);
    this.camera.position.set(this.target.x + Math.sin(this.yaw) * cp * this.dist, this.target.y + Math.sin(this.pitch) * this.dist, this.target.z + Math.cos(this.yaw) * cp * this.dist);
    this.camera.lookAt(this.target);
    this.camera.aspect = this.game.viewW / this.game.viewH;
    this.camera.updateProjectionMatrix();
    this.starUniforms.uScale.value = this.game.renderer.getPixelRatio();
    const t = performance.now() / 1000;
    this.goalMarker.scale.setScalar(this.dist * 0.045 * (1 + 0.15 * Math.sin(t * 3)));
    this.hereMarker.scale.setScalar(this.dist * 0.035);
    this.selMarker.scale.setScalar(this.dist * 0.03);
    pipeline.renderExternal(this.scene, this.camera);
  }
}
