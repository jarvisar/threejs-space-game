// Upgrade tracks. Every track starts at level 1, levels[i] is the cost and
// description for going from level i+1 to i+2.

export const UPGRADES = {
  drive: {
    name: 'Warp Drive',
    icon: 'drive',
    levels: [
      { name: 'Frost Drive', desc: 'Tunes the drive for white stars. Warp range 120 ly.', cost: { relic: 3, cryonite: 50, ferrite: 120, data: 150 } },
      { name: 'Azure Drive', desc: 'Survives the gravity wells of blue giants. Warp range 200 ly.', cost: { relic: 3, uranite: 50, cobalt: 60, data: 300 } },
      { name: 'Chorus Drive', desc: 'Resonates with anomalous stars. Warp range 320 ly.', cost: { relic: 4, pyrocite: 50, vitriol: 50, verdite: 50, data: 500 } },
    ],
  },
  scanner: {
    name: 'Scanner',
    levels: [
      { name: 'Wide Band Scanner', desc: 'Scan range 1.8 km and reveals more sites.', cost: { ferrite: 60, carbon: 40, data: 60 } },
      { name: 'Deep Echo Scanner', desc: 'Scan range 3 km. Echo Stones light up from farther away.', cost: { cobalt: 30, lumen: 40, data: 160 } },
    ],
  },
  mining: {
    name: 'Mining Beam',
    levels: [
      { name: 'Focused Beam', desc: 'Mines 60% faster.', cost: { ferrite: 80, hydrogel: 20, data: 60 } },
      { name: 'Resonant Beam', desc: 'Mines 140% faster.', cost: { pyrocite: 25, silica: 40, data: 180 } },
    ],
  },
  jetpack: {
    name: 'Jetpack',
    levels: [
      { name: 'Extended Tanks', desc: 'Jetpack lasts 50% longer.', cost: { ferrite: 50, lumen: 25, data: 50 } },
      { name: 'Ion Thrusters', desc: 'Jetpack lasts twice as long and climbs faster.', cost: { silica: 40, cryonite: 20, data: 150 } },
    ],
  },
  suit: {
    name: 'Hazard Plating',
    levels: [
      { name: 'Insulated Lining', desc: 'Hazards drain protection 35% slower.', cost: { carbon: 60, ferrite: 60, data: 80 } },
      { name: 'Adaptive Weave', desc: 'Hazards drain protection 60% slower.', cost: { verdite: 40, silica: 40, data: 200 } },
      { name: 'Chorus Mantle', desc: 'Hazards drain protection 80% slower.', cost: { relic: 2, uranite: 40, data: 350 } },
    ],
  },
  thrusters: {
    name: 'Ship Thrusters',
    levels: [
      { name: 'Tuned Thrusters', desc: 'Ship flies 25% faster.', cost: { ferrite: 100, hydrogel: 40, data: 80 } },
      { name: 'Plasma Thrusters', desc: 'Ship flies 50% faster.', cost: { pyrocite: 30, cobalt: 30, data: 220 } },
    ],
  },
  pulse: {
    name: 'Pulse Engine',
    levels: [
      { name: 'Pulse Capacitors', desc: 'Pulse drive tops out 60% higher.', cost: { hydrogel: 60, ferrite: 60, data: 90 } },
      { name: 'Fold Coils', desc: 'Pulse drive tops out 2.4x higher.', cost: { cryonite: 40, cobalt: 40, data: 240 } },
    ],
  },
  cargo: {
    name: 'Cargo Bay',
    levels: [
      { name: 'Cargo Racks', desc: 'Hold 400 of each resource.', cost: { ferrite: 120, carbon: 60, data: 50 } },
      { name: 'Compression Bay', desc: 'Hold 650 of each resource.', cost: { cobalt: 40, silica: 40, data: 150 } },
      { name: 'Fold Storage', desc: 'Hold 1000 of each resource.', cost: { relic: 1, aetherium: 20, data: 300 } },
    ],
  },
};

export const UPGRADE_ORDER = ['drive', 'scanner', 'mining', 'jetpack', 'suit', 'thrusters', 'pulse', 'cargo'];

export const DRIVE_TIERS = [
  null,
  { range: 60, classes: ['M', 'K', 'G'] },
  { range: 120, classes: ['M', 'K', 'G', 'F', 'A'] },
  { range: 200, classes: ['M', 'K', 'G', 'F', 'A', 'B', 'O'] },
  { range: 320, classes: ['M', 'K', 'G', 'F', 'A', 'B', 'O', 'X'] },
];

export function level(state, id) {
  return Math.max(1, state.upgrades[id] || 1);
}

export function nextUpgrade(state, id) {
  const lv = level(state, id);
  const u = UPGRADES[id];
  return u.levels[lv - 1] || null;
}

// derived stats used around the game
export function stats(state) {
  const l = (id) => level(state, id);
  return {
    warpRange: DRIVE_TIERS[l('drive')].range,
    warpClasses: DRIVE_TIERS[l('drive')].classes,
    scanRange: [0, 1000, 1800, 3000][l('scanner')],
    miningPower: [0, 1, 1.6, 2.4][l('mining')],
    jetTime: [0, 2.4, 3.6, 4.8][l('jetpack')],
    jetAccel: [0, 17, 17, 21][l('jetpack')],
    hazardResist: [0, 0, 0.35, 0.6, 0.8][l('suit')],
    shipSpeed: [0, 1, 1.25, 1.5][l('thrusters')],
    pulseSpeed: [0, 1, 1.6, 2.4][l('pulse')],
    capacity: [0, 250, 400, 650, 1000][l('cargo')],
  };
}

export const RECIPES = [
  { id: 'warpcell', name: 'Warp Cell', desc: 'Fuel for one hyperspace jump.', cost: { hydrogel: 40, ferrite: 20 } },
  { id: 'shield', name: 'Shield Charge', desc: 'Refills hazard protection right away.', cost: { lumen: 15, carbon: 5 } },
  { id: 'lens', name: 'Harmonic Lens', desc: 'Focuses the Chorus Drive for the jump to the galactic core.', cost: { aetherium: 40, relic: 3, hydrogel: 60 }, story: true },
];
