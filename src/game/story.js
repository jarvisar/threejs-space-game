import { STAR_CLASSES } from '../gen/galaxy.js';
import { stats, level, UPGRADES, RECIPES } from './upgrades.js';
import { Planet } from '../world/planet.js';

// Objective chain. Stages move forward on events from the game, and
// objective() describes what the HUD should show for the current stage.

const REPAIR = { ferrite: 40, carbon: 25 };
const WARP_CELL = RECIPES.find((r) => r.id === 'warpcell').cost;

export class Story {
  constructor(game) {
    this.game = game;
  }

  get s() {
    return this.game.state.story;
  }

  set(stage) {
    this.s.stage = stage;
    this.game.onStage(stage);
  }

  get repairCost() {
    return REPAIR;
  }

  resonanceStar(i) {
    return this.game.galaxy.story.resonances[i];
  }

  objective() {
    const g = this.game;
    const st = g.state;
    const inv = st.inventory;
    const k = (res, need) => {
      const have = Math.min(need, inv[res] || 0);
      return `<span class="${have >= need ? 'done' : ''}">${have}/${need}</span>`;
    };
    switch (this.s.stage) {
      case 'repair':
        if (inv.ferrite >= REPAIR.ferrite && inv.carbon >= REPAIR.carbon)
          return { title: 'Repair Your Ship', text: 'Return to your ship and press <b>E</b> to repair the launch thrusters.' };
        return {
          title: 'Repair Your Ship',
          text: `Your launch thrusters are damaged. Hold <b>Left Mouse</b> to mine.<br>Ferrite from rocks ${k('ferrite', REPAIR.ferrite)}<br>Carbon from plants ${k('carbon', REPAIR.carbon)}`,
        };
      case 'launch':
        return { title: 'Take Off', text: 'Board your ship, press <b>W</b> to take off, then climb out of the atmosphere.' };
      case 'explore':
        return { title: 'Land on Another Planet', text: 'Press <b>Space</b> away from planets to use the pulse drive. Fly to another planet and land on it.' };
      case 'fuel': {
        const cells = st.warpCells;
        return {
          title: 'Craft a Warp Cell',
          text: `Warp jumps use Warp Cells. Mine <b>Hydrogel</b> from blue crystals, then craft a cell in the inventory (<b>Tab</b>).<br>Hydrogel ${k('hydrogel', WARP_CELL.hydrogel)} Ferrite ${k('ferrite', WARP_CELL.ferrite)}<br>Warp Cells ${cells}/1`,
        };
      }
      case 'signal': {
        const idx = this.s.resonance;
        const star = this.resonanceStar(idx);
        if (star === undefined) return { title: 'Core Jump', text: 'Craft a <b>Harmonic Lens</b> (Tab), then open the galaxy map and make the <b>Core Jump</b>.' };
        const info = g.galaxy.info(star);
        const s = stats(st);
        const tierOk = s.warpClasses.includes(info.cls);
        const extra = tierOk ? '' : `<br>Your drive can't reach ${STAR_CLASSES[info.cls].label.toLowerCase()}s yet. Install the next drive upgrade.`;
        return {
          title: `Signal ${idx + 1} of ${g.galaxy.story.resonances.length}`,
          text: `The signal is coming from <b>${info.name}</b>. Open the galaxy map (<b>G</b>) and warp to the marked star. Distant stars may take several jumps.${extra}`,
        };
      }
      case 'spire': {
        const host = g.system.bodies.find((b) => b.def.spire);
        return { title: 'Find the Spire', text: `Find the Chorus Spire on <b>${host ? host.def.name : 'a nearby world'}</b>. Look for the pillar of light.` };
      }
      case 'upgrade': {
        const next = UPGRADES.drive.levels[level(st, 'drive') - 1];
        return { title: 'Upgrade Your Drive', text: `Install the <b>${next ? next.name : 'next drive'}</b> from the Upgrades tab (<b>Tab</b>). Relic Shards come from Echo Stones and ruins.` };
      }
      case 'core':
        return { title: 'Core Jump', text: 'Craft a <b>Harmonic Lens</b> (Tab), then open the galaxy map and make the <b>Core Jump</b>.' };
      case 'end':
        return { title: 'Story Complete', text: 'You reached the core. Keep exploring, or start a new galaxy from the title screen.' };
    }
    return null;
  }

  // called every frame, cheap checks only
  update() {
    const g = this.game;
    const st = g.state;
    switch (this.s.stage) {
      case 'launch': {
        const s = g.ship;
        if (g.mode === 'ship' && s.state === 'flying') {
          const high = !s.frame || s.pos.length() - s.frame.radius > s.frame.atmoRadius - s.frame.radius + 150;
          if (high) this.set('explore');
        }
        break;
      }
      case 'fuel':
        if (st.warpCells >= 1) this.set(this.game.galaxy.story.resonances.length ? 'signal' : 'core');
        break;
      case 'upgrade':
        if (level(st, 'drive') >= this.s.resonance + 1) this.set('signal');
        break;
    }
  }

  onLanded(body) {
    if (this.s.stage !== 'explore' || !(body instanceof Planet)) return;
    const startPlanet = this.game.systemDef.isStart && body.index === 0;
    if (!startPlanet) this.set('fuel');
  }

  onArrive(index) {
    if (this.s.stage === 'signal' && index === this.resonanceStar(this.s.resonance)) this.set('spire');
  }

  onSpire(poi) {
    // only the spire for the current resonance counts, in either stage
    if (poi.story !== this.s.resonance) return false;
    if (this.s.stage !== 'spire' && this.s.stage !== 'signal') return false;
    const i = this.s.resonance;
    this.s.resonance = i + 1;
    if (i + 1 >= this.game.galaxy.story.resonances.length) this.set('core');
    else this.set('upgrade');
    return true;
  }
}
