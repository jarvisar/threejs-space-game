import { planetSpecies } from '../gen/flora.js';
import { faunaSpecies } from '../world/fauna.js';
import { RESOURCES } from './resources.js';

// What the discovery card and the journal say about a world. Everything comes
// from the generated definition, so it works before the player has landed.

const WEATHER = { rain: 'Rain', snow: 'Snow', dust: 'Dust storms', ash: 'Ash fall', spores: 'Drifting spores' };
const OCEANS = { water: 'Water', lava: 'Lava', ice: 'Frozen', acid: 'Acid' };
const HAZARD = { heat: 'Heat', cold: 'Cold', toxic: 'Toxic air', radiation: 'Radiation' };

function atmosphere(def) {
  const a = def.atmosphere;
  if (!a) return 'None';
  if (def.kind === 'gas') return 'Crushing';
  if (a.density < 0.75) return 'Thin';
  if (a.density > 1.1) return 'Dense';
  return 'Moderate';
}

function climate(def) {
  const h = def.hazard;
  if (!h || h.type === 'none') return def.atmosphere ? 'Temperate' : 'Airless';
  if (h.type === 'heat') return h.level > 0.75 ? 'Scorching' : 'Hot';
  if (h.type === 'cold') return h.level > 0.65 ? 'Frigid' : 'Cold';
  return HAZARD[h.type];
}

// three colors for the little planet swatch: highlight, body, shadow side
export function worldColors(def) {
  if (def.kind === 'gas') return [def.bands[4], def.bands[0], def.bands[3]];
  const p = def.palette;
  const land = def.floraDensity > 0.3 ? p.veg : p.low;
  const edge = def.ocean ? def.ocean.deep : p.cliff;
  return [def.ocean ? p.sand : p.peak, land, edge];
}

export function swatchStyle(colors, gas) {
  const [a, b, c] = colors;
  if (gas) return `background: radial-gradient(circle at 34% 30%, rgba(255,255,255,0.35), transparent 45%), repeating-linear-gradient(-12deg, ${a} 0 10%, ${b} 10% 22%, ${c} 22% 30%, ${b} 30% 38%);`;
  return `background: radial-gradient(circle at 34% 30%, ${a} 0%, ${b} 38%, ${c} 78%, #05070c 100%);`;
}

export function worldFacts(body) {
  const def = body.def;
  const rows = [];
  const tags = [];
  rows.push(['Diameter', `${((def.radius * 2) / 1000).toFixed(1)} km`]);
  if (body.dayLength) rows.push(['Day', `${Math.round(body.dayLength / 60)} min`]);
  rows.push(['Atmosphere', atmosphere(def)]);
  if (def.kind === 'rocky') {
    rows.push(['Climate', climate(def)]);
    if (def.weather) rows.push(['Weather', WEATHER[def.weather] || def.weather]);
    rows.push(['Oceans', def.ocean ? OCEANS[def.ocean.mode] || 'Water' : 'None']);
    const flora = planetSpecies(def).filter((s) => s.plant).length;
    const fauna = faunaSpecies(def).length;
    rows.push(['Life', flora + fauna ? `${flora} flora, ${fauna} fauna` : 'None found']);
    if (def.resource) rows.push(['Resource', RESOURCES[def.resource].name]);
  } else {
    rows.push(['Storms', def.storm ? 'One great storm' : 'Calm bands']);
  }
  if (def.rings) tags.push('Rings');
  if (def.isMoon) tags.push('Moon');
  if (def.spire) tags.push('Chorus Spire');
  if (def.ocean && def.ocean.mode === 'water' && def.type === 'ocean') tags.push('Ocean world');
  return { name: def.name, type: `${def.typeLabel}${def.isMoon ? ' moon' : ''}`, colors: worldColors(def), gas: def.kind === 'gas', rows, tags };
}
