// Planet archetypes. Ranges are [min, max] and get rolled per planet.
// Palette colors are sRGB hex. sky is the relative Rayleigh scattering per
// channel, which sets the daytime sky tint (sunsets end up complementary).

export const PLANET_TYPES = {
  lush: {
    label: 'Lush',
    hazard: ['none', 0, 0.1],
    atmo: 1, ocean: 0.8, clouds: [0.4, 0.62], thickness: 1.0,
    flora: [0.75, 1], fauna: [0.7, 1],
    resource: 'verdite', weather: 'rain',
    terrain: {
      contBias: [-0.1, 0.25], contAmp: [45, 100], oceanDepth: [50, 110],
      mountAmp: [140, 340], mountCoverage: [0.35, 0.6], mountSharp: [1.6, 2.3],
      hillAmp: [16, 40], hillScale: [180, 360], detailAmp: [1.5, 3.5], warpAmp: [120, 380],
    },
    palettes: [
      { sand: '#d9c68f', low: '#3f7d2a', mid: '#58783a', high: '#6e6a58', cliff: '#5b534b', peak: '#eef2f5', veg: '#3c9a2c', veg2: '#a6a64a', deep: '#2f4148', sky: [0.3, 0.56, 1.0], oceanShallow: '#2ec4b6', oceanDeep: '#0a3264', cloud: '#ffffff', leaf: ['#2f8f3a', '#58b33a', '#8fcf3c'], trunk: '#5a4030', glow: '#7fffd4' },
      { sand: '#e6dcb4', low: '#1e8c78', mid: '#2f7266', high: '#6a7486', cliff: '#474159', peak: '#e8f4ff', veg: '#16b894', veg2: '#7ec9a0', deep: '#223a48', sky: [0.95, 0.5, 0.78], oceanShallow: '#48d6e8', oceanDeep: '#123f7a', cloud: '#fff0f6', leaf: ['#12c29a', '#3fe0c0', '#9af0d8'], trunk: '#3a2f4a', glow: '#ff80d0' },
      { sand: '#e2c48e', low: '#9a4f22', mid: '#8a5a33', high: '#7a6a5a', cliff: '#5a4a3e', peak: '#f5efe6', veg: '#c85a1e', veg2: '#e0a23a', deep: '#3a3a44', sky: [0.34, 0.6, 1.0], oceanShallow: '#3ab0a8', oceanDeep: '#123a5a', cloud: '#fff8f0', leaf: ['#d2551e', '#f08a24', '#f5c542'], trunk: '#4a3226', glow: '#ffe07a' },
      { sand: '#dcd2c2', low: '#5b3b8c', mid: '#4e4470', high: '#6f6a80', cliff: '#3e3850', peak: '#f0ecff', veg: '#8a3fd0', veg2: '#c78ae8', deep: '#242444', sky: [0.42, 0.82, 1.0], oceanShallow: '#40e0d0', oceanDeep: '#10406a', cloud: '#f4f0ff', leaf: ['#9b4be0', '#c86af0', '#6a2fb0'], trunk: '#2a2238', glow: '#60ffff' },
      { sand: '#f0dcc8', low: '#c0567a', mid: '#9a5a70', high: '#8a7a80', cliff: '#5a4a50', peak: '#fff4f8', veg: '#e0689a', veg2: '#f0a0c0', deep: '#3a2a3a', sky: [0.36, 0.74, 1.0], oceanShallow: '#58d8c8', oceanDeep: '#1a3a6a', cloud: '#ffffff', leaf: ['#ff6fa8', '#ff9ec8', '#d84a88'], trunk: '#4a3040', glow: '#a0ffea' },
      { sand: '#cfc79a', low: '#2a6a3a', mid: '#1f5a48', high: '#4a5a5a', cliff: '#353f40', peak: '#e8f0f0', veg: '#1f8a50', veg2: '#5aa870', deep: '#1a3040', sky: [0.5, 0.76, 0.9], oceanShallow: '#2fae8f', oceanDeep: '#0c3a44', cloud: '#eef8f4', leaf: ['#1f9a5a', '#2fbf7a', '#0f6a40'], trunk: '#3a2a20', glow: '#c0ff60' },
    ],
  },

  ocean: {
    label: 'Oceanic',
    hazard: ['none', 0, 0.1],
    atmo: 1, ocean: 1, clouds: [0.45, 0.7], thickness: 1.05,
    flora: [0.6, 0.9], fauna: [0.5, 0.9],
    resource: 'verdite', weather: 'rain',
    terrain: {
      contBias: [-0.42, -0.2], contAmp: [40, 90], oceanDepth: [70, 140],
      mountAmp: [80, 220], mountCoverage: [0.25, 0.45], mountSharp: [1.6, 2.2],
      hillAmp: [12, 30], hillScale: [150, 300], detailAmp: [1.2, 3], warpAmp: [150, 420],
    },
    palettes: [
      { sand: '#ece0b0', low: '#3aa05a', mid: '#4a8a4a', high: '#7a7a6a', cliff: '#5a5a52', peak: '#f4f6f8', veg: '#2fb060', veg2: '#9ac86a', deep: '#2a4a5a', sky: [0.28, 0.58, 1.0], oceanShallow: '#3ad8c8', oceanDeep: '#06407a', cloud: '#ffffff', leaf: ['#2fb060', '#5ad07a', '#1a8a4a'], trunk: '#6a5040', glow: '#80ffe0' },
      { sand: '#f4e8d0', low: '#e07a50', mid: '#c06a50', high: '#9a8070', cliff: '#6a5048', peak: '#fff8f0', veg: '#f09050', veg2: '#f8c080', deep: '#2a3a5a', sky: [0.4, 0.62, 1.0], oceanShallow: '#40e8f0', oceanDeep: '#0a2a8a', cloud: '#ffffff', leaf: ['#ff8a50', '#ffb070', '#e05a3a'], trunk: '#5a3a30', glow: '#60f0ff' },
      { sand: '#d8e8d0', low: '#4a9a8a', mid: '#3a7a7a', high: '#6a8080', cliff: '#3a4a50', peak: '#f0ffff', veg: '#3ac0a0', veg2: '#8ad8c0', deep: '#183a50', sky: [0.6, 0.9, 0.85], oceanShallow: '#5af0d0', oceanDeep: '#0a4a5a', cloud: '#f0fffa', leaf: ['#3ad0b0', '#60f0d0', '#1a9a8a'], trunk: '#304040', glow: '#ffb0f0' },
    ],
  },

  desert: {
    label: 'Arid',
    hazard: ['heat', 0.35, 0.75],
    atmo: 1, ocean: 0.08, clouds: [0.0, 0.25], thickness: 0.9,
    flora: [0.25, 0.5], fauna: [0.2, 0.5],
    resource: 'silica', weather: 'dust',
    terrain: {
      contBias: [0.25, 0.55], contAmp: [40, 90], oceanDepth: [40, 80],
      mountAmp: [90, 260], mountCoverage: [0.2, 0.45], mountSharp: [1.4, 2.0],
      hillAmp: [10, 30], hillScale: [200, 420], detailAmp: [1, 2.5], warpAmp: [100, 300],
      duneAmp: [8, 24], duneScale: [60, 140], terraceStep: [18, 40], terraceMix: [0, 0.9],
    },
    palettes: [
      { sand: '#e8b67a', low: '#dca068', mid: '#c98552', high: '#b06a44', cliff: '#8c5038', peak: '#f0d2a8', veg: '#9a8a3a', veg2: '#c8a860', deep: '#8a5a3a', sky: [1.0, 0.72, 0.45], oceanShallow: '#3ab8c0', oceanDeep: '#1a4a6a', cloud: '#fff0dc', leaf: ['#8a9a3a', '#6a8a4a', '#c8a040'], trunk: '#6a4a2a', glow: '#ffb040' },
      { sand: '#d88a5a', low: '#b8603a', mid: '#a0502e', high: '#8a4a34', cliff: '#6a3426', peak: '#e8b48a', veg: '#6a7a3a', veg2: '#a08040', deep: '#5a2a1a', sky: [0.95, 0.62, 0.5], oceanShallow: '#40b0a0', oceanDeep: '#1a3a4a', cloud: '#ffe8d8', leaf: ['#7a8a3a', '#a0a040', '#5a6a2a'], trunk: '#4a2a1a', glow: '#ff8a30' },
      { sand: '#f0e2c0', low: '#e2d0a8', mid: '#d0b890', high: '#b89c78', cliff: '#907858', peak: '#faf0dc', veg: '#a0a860', veg2: '#d0c080', deep: '#8a7050', sky: [0.45, 0.66, 1.0], oceanShallow: '#40d0d0', oceanDeep: '#104a7a', cloud: '#ffffff', leaf: ['#a0b050', '#80a040', '#c0c060'], trunk: '#7a6040', glow: '#fff080' },
      { sand: '#c8d8b0', low: '#a8c0a0', mid: '#90a890', high: '#788c80', cliff: '#58686a', peak: '#e0ecd8', veg: '#c07aa0', veg2: '#e0a0c0', deep: '#4a5a5a', sky: [1.0, 0.6, 0.85], oceanShallow: '#60d8b0', oceanDeep: '#1a4a4a', cloud: '#fff0f8', leaf: ['#d07aa8', '#f0a0c8', '#a05a80'], trunk: '#4a4a3a', glow: '#ff70c0' },
    ],
  },

  frozen: {
    label: 'Frozen',
    hazard: ['cold', 0.4, 0.85],
    atmo: 1, ocean: 0.45, clouds: [0.3, 0.6], thickness: 0.95,
    flora: [0.25, 0.55], fauna: [0.2, 0.5],
    resource: 'cryonite', weather: 'snow', oceanMode: 'ice',
    terrain: {
      contBias: [0.0, 0.35], contAmp: [50, 110], oceanDepth: [40, 90],
      mountAmp: [200, 460], mountCoverage: [0.4, 0.7], mountSharp: [1.8, 2.8],
      hillAmp: [14, 36], hillScale: [160, 320], detailAmp: [1.5, 3], warpAmp: [150, 420],
    },
    palettes: [
      { sand: '#c9d6e3', low: '#e6eef6', mid: '#d2dfec', high: '#b8cadf', cliff: '#61738a', peak: '#ffffff', veg: '#8ab8d8', veg2: '#c0d8e8', deep: '#40506a', sky: [0.3, 0.56, 1.0], oceanShallow: '#d6f2ff', oceanDeep: '#7ab4e0', cloud: '#ffffff', leaf: ['#a8e0ff', '#80c8f0', '#e0f4ff'], trunk: '#506070', glow: '#80d8ff' },
      { sand: '#d8d0ea', low: '#e8e0f6', mid: '#d0c4ec', high: '#b8a8dc', cliff: '#5a4a78', peak: '#fdfaff', veg: '#b090e0', veg2: '#d8c8f0', deep: '#4a3a6a', sky: [0.62, 0.5, 1.0], oceanShallow: '#e8e0ff', oceanDeep: '#9888e0', cloud: '#fbf8ff', leaf: ['#c0a0f0', '#e0c8ff', '#9070d0'], trunk: '#4a3a5a', glow: '#ff9af0' },
      { sand: '#c8e0dc', low: '#dff2ee', mid: '#c2e4de', high: '#a0cac8', cliff: '#3f6468', peak: '#ffffff', veg: '#6ad0c0', veg2: '#b0e8e0', deep: '#2a5058', sky: [0.35, 0.8, 0.92], oceanShallow: '#d8fff8', oceanDeep: '#70c8c0', cloud: '#ffffff', leaf: ['#70e0d0', '#a0f0e8', '#40b0a8'], trunk: '#3a5a5a', glow: '#a0fff0' },
    ],
  },

  volcanic: {
    label: 'Scorched',
    hazard: ['heat', 0.7, 1.0],
    atmo: 1, ocean: 0.65, clouds: [0.2, 0.5], thickness: 1.0,
    flora: [0.1, 0.35], fauna: [0.0, 0.25],
    resource: 'pyrocite', weather: 'ash', oceanMode: 'lava',
    terrain: {
      contBias: [0.05, 0.4], contAmp: [50, 110], oceanDepth: [40, 90],
      mountAmp: [220, 480], mountCoverage: [0.4, 0.75], mountSharp: [2.0, 3.0],
      hillAmp: [16, 40], hillScale: [150, 300], detailAmp: [1.5, 4], warpAmp: [100, 300],
      craterDensity: [0, 0.3], craterScale: [500, 900], craterDepth: [0.15, 0.3],
    },
    palettes: [
      { sand: '#3a2a24', low: '#2b2320', mid: '#3a2e2a', high: '#4a3a33', cliff: '#1c1716', peak: '#5c4a40', veg: '#6a2418', veg2: '#8a3a20', deep: '#140e0c', sky: [1.0, 0.5, 0.28], oceanShallow: '#ff6a1a', oceanDeep: '#a01e04', cloud: '#7a6a66', leaf: ['#8a2a1a', '#c84a1a', '#3a1a14'], trunk: '#1a1414', glow: '#ff5020' },
      { sand: '#4a4230', low: '#3a3424', mid: '#4a4028', high: '#6a5a2a', cliff: '#2a2418', peak: '#c8b040', veg: '#8a6a1a', veg2: '#b09030', deep: '#1a1810', sky: [1.0, 0.82, 0.36], oceanShallow: '#ffae1a', oceanDeep: '#c04008', cloud: '#8a8060', leaf: ['#b08a2a', '#d0a830', '#6a5018'], trunk: '#2a2418', glow: '#ffd040' },
      { sand: '#2a2432', low: '#1e1a24', mid: '#2a2432', high: '#3a3244', cliff: '#141018', peak: '#5a4a6a', veg: '#6a2a5a', veg2: '#9a3a7a', deep: '#0e0a12', sky: [0.92, 0.42, 0.62], oceanShallow: '#ff4a7a', oceanDeep: '#a01040', cloud: '#6a5a70', leaf: ['#9a2a6a', '#d04a9a', '#5a1a40'], trunk: '#1a141e', glow: '#ff60a0' },
    ],
  },

  toxic: {
    label: 'Toxic',
    hazard: ['toxic', 0.45, 0.9],
    atmo: 1, ocean: 0.55, clouds: [0.35, 0.65], thickness: 1.15,
    flora: [0.5, 0.85], fauna: [0.2, 0.55],
    resource: 'vitriol', weather: 'spores', oceanMode: 'acid',
    terrain: {
      contBias: [-0.05, 0.3], contAmp: [40, 90], oceanDepth: [40, 90],
      mountAmp: [60, 180], mountCoverage: [0.2, 0.45], mountSharp: [1.2, 1.8],
      hillAmp: [25, 60], hillScale: [90, 200], detailAmp: [1.5, 3.5], warpAmp: [200, 500],
      pillarAmp: [0, 40], pillarScale: [60, 120], pillarThreshold: [0.45, 0.6],
    },
    palettes: [
      { sand: '#b8b860', low: '#6a8a28', mid: '#7a8a38', high: '#5a6a38', cliff: '#3f4428', peak: '#c8d070', veg: '#a8d418', veg2: '#d8e040', deep: '#2a3a18', sky: [0.72, 1.0, 0.3], oceanShallow: '#9ae02a', oceanDeep: '#2a6010', cloud: '#e8f0b0', leaf: ['#a8e020', '#d0f040', '#70a018'], trunk: '#4a4a20', glow: '#e0ff40' },
      { sand: '#8a7a8a', low: '#5a3a6a', mid: '#6a4a5a', high: '#7a6a5a', cliff: '#3a2a3a', peak: '#b0a0a8', veg: '#b040c0', veg2: '#d080e0', deep: '#2a1a30', sky: [0.85, 1.0, 0.36], oceanShallow: '#c040e0', oceanDeep: '#401060', cloud: '#e0e8b0', leaf: ['#c040d0', '#e070f0', '#8020a0'], trunk: '#3a2a30', glow: '#f060ff' },
      { sand: '#c0a860', low: '#8a6a28', mid: '#9a7a38', high: '#6a5a3a', cliff: '#40341e', peak: '#d0c080', veg: '#d0b020', veg2: '#e8d060', deep: '#3a3010', sky: [0.9, 0.9, 0.3], oceanShallow: '#c8e030', oceanDeep: '#506010', cloud: '#f0e8b0', leaf: ['#d0b020', '#f0d040', '#a08010'], trunk: '#4a3a20', glow: '#fff040' },
    ],
  },

  radioactive: {
    label: 'Irradiated',
    hazard: ['radiation', 0.5, 0.9],
    atmo: 0.9, ocean: 0.15, clouds: [0.1, 0.4], thickness: 0.9,
    flora: [0.3, 0.6], fauna: [0.1, 0.4],
    resource: 'uranite', weather: 'dust',
    terrain: {
      contBias: [0.1, 0.45], contAmp: [40, 90], oceanDepth: [40, 80],
      mountAmp: [120, 320], mountCoverage: [0.3, 0.6], mountSharp: [1.8, 2.6],
      hillAmp: [12, 34], hillScale: [150, 320], detailAmp: [1.2, 3], warpAmp: [100, 300],
      craterDensity: [0.1, 0.4], craterScale: [300, 700], craterDepth: [0.15, 0.3],
    },
    palettes: [
      { sand: '#8a8a60', low: '#6a7a4a', mid: '#5a6a48', high: '#7a7a6a', cliff: '#3a3a30', peak: '#c8d898', veg: '#b8e040', veg2: '#d0e880', deep: '#2a3020', sky: [0.62, 1.0, 0.55], oceanShallow: '#a0f060', oceanDeep: '#306020', cloud: '#f0ffe0', leaf: ['#b8e040', '#90c030', '#e0ff60'], trunk: '#3a3a2a', glow: '#b0ff40' },
      { sand: '#6a5a7a', low: '#4a3a5a', mid: '#5a4a6a', high: '#6a6a7a', cliff: '#2a2a3a', peak: '#a8a0c0', veg: '#60e0a0', veg2: '#a0f0c8', deep: '#1a1a2a', sky: [0.76, 0.5, 1.0], oceanShallow: '#60f0c0', oceanDeep: '#104a40', cloud: '#f0e8ff', leaf: ['#60e0a0', '#40c080', '#a0ffd0'], trunk: '#2a2a3a', glow: '#60ffb0' },
      { sand: '#9a6a48', low: '#7a4a2a', mid: '#6a4a38', high: '#8a7a6a', cliff: '#3a2a20', peak: '#d0b890', veg: '#e0e040', veg2: '#f0f080', deep: '#2a1a10', sky: [1.0, 0.86, 0.42], oceanShallow: '#e0e040', oceanDeep: '#605010', cloud: '#fff4d0', leaf: ['#e0e040', '#c0c030', '#ffff80'], trunk: '#3a2a1a', glow: '#f8ff40' },
    ],
  },

  barren: {
    label: 'Barren',
    hazard: ['cold', 0.15, 0.45],
    atmo: 0.6, ocean: 0, clouds: [0, 0.1], thickness: 0.6,
    flora: [0.05, 0.2], fauna: [0, 0.15],
    resource: 'cobalt', weather: 'dust',
    terrain: {
      contBias: [0.2, 0.5], contAmp: [40, 90], oceanDepth: [30, 60],
      mountAmp: [120, 320], mountCoverage: [0.3, 0.6], mountSharp: [1.6, 2.4],
      hillAmp: [12, 30], hillScale: [180, 360], detailAmp: [1, 2.5], warpAmp: [60, 200],
      craterDensity: [0.3, 0.7], craterScale: [300, 800], craterDepth: [0.2, 0.35],
    },
    palettes: [
      { sand: '#9a948a', low: '#8a847c', mid: '#7a746c', high: '#a09a90', cliff: '#5a5650', peak: '#c0bab0', veg: '#7a7a6a', veg2: '#9a9a80', deep: '#4a4640', sky: [0.6, 0.66, 0.82], oceanShallow: '#60a0a0', oceanDeep: '#204050', cloud: '#e0e0e0', leaf: ['#8a8a6a', '#6a6a50', '#a0a080'], trunk: '#4a4640', glow: '#ffe080' },
      { sand: '#9a7a5e', low: '#8a6a50', mid: '#7a5e48', high: '#9a8068', cliff: '#5a4434', peak: '#b8a088', veg: '#8a7a50', veg2: '#a09060', deep: '#3a2a20', sky: [0.82, 0.62, 0.5], oceanShallow: '#60a0a0', oceanDeep: '#204050', cloud: '#f0e0d0', leaf: ['#9a8a50', '#7a6a40', '#b0a060'], trunk: '#4a3a2a', glow: '#ffc060' },
      { sand: '#a86a50', low: '#9a5a40', mid: '#8a4e38', high: '#a07060', cliff: '#5a3428', peak: '#c89a88', veg: '#7a6a4a', veg2: '#9a8a5a', deep: '#3a2018', sky: [0.72, 0.52, 0.46], oceanShallow: '#60a0a0', oceanDeep: '#204050', cloud: '#f0dcd0', leaf: ['#8a7a4a', '#a09050', '#6a5a3a'], trunk: '#4a3028', glow: '#ff9060' },
    ],
  },

  dead: {
    label: 'Dead',
    hazard: ['radiation', 0.2, 0.5],
    atmo: 0, ocean: 0, clouds: [0, 0], thickness: 0,
    flora: [0, 0], fauna: [0, 0],
    resource: 'cobalt', weather: null,
    terrain: {
      contBias: [0.2, 0.5], contAmp: [30, 70], oceanDepth: [30, 60],
      mountAmp: [60, 200], mountCoverage: [0.2, 0.5], mountSharp: [1.4, 2.2],
      hillAmp: [10, 25], hillScale: [150, 300], detailAmp: [1, 2], warpAmp: [40, 150],
      craterDensity: [0.5, 0.9], craterScale: [250, 600], craterDepth: [0.25, 0.4],
    },
    palettes: [
      { sand: '#7a7a78', low: '#6a6a6a', mid: '#7a7a78', high: '#8a8a88', cliff: '#4a4a48', peak: '#9a9a98', veg: '#6a6a6a', veg2: '#7a7a78', deep: '#3a3a3a', sky: [0.5, 0.5, 0.5], oceanShallow: '#555', oceanDeep: '#333', cloud: '#fff', leaf: ['#7a7a78', '#6a6a6a', '#8a8a88'], trunk: '#4a4a48', glow: '#a0c0ff' },
      { sand: '#4a4a50', low: '#3a3a3e', mid: '#444448', high: '#5a5a60', cliff: '#26262a', peak: '#6a6a72', veg: '#44444a', veg2: '#505058', deep: '#1a1a1e', sky: [0.5, 0.5, 0.5], oceanShallow: '#555', oceanDeep: '#333', cloud: '#fff', leaf: ['#5a5a60', '#44444a', '#6a6a72'], trunk: '#26262a', glow: '#ffb080' },
      { sand: '#b0b8c0', low: '#c8d0d8', mid: '#b8c0c8', high: '#d8e0e8', cliff: '#707880', peak: '#eef2f6', veg: '#a0a8b0', veg2: '#c0c8d0', deep: '#606870', sky: [0.5, 0.5, 0.5], oceanShallow: '#555', oceanDeep: '#333', cloud: '#fff', leaf: ['#c8d0d8', '#a0a8b0', '#e0e8f0'], trunk: '#707880', glow: '#80e0ff' },
    ],
  },

  exotic: {
    label: 'Exotic',
    hazard: ['none', 0, 0.3],
    atmo: 1, ocean: 0.4, clouds: [0.15, 0.5], thickness: 1.0,
    flora: [0.5, 0.9], fauna: [0.3, 0.7],
    resource: 'aetherium', weather: 'spores',
    terrain: {
      contBias: [0.0, 0.4], contAmp: [40, 100], oceanDepth: [40, 90],
      mountAmp: [80, 260], mountCoverage: [0.2, 0.5], mountSharp: [1.5, 2.5],
      hillAmp: [12, 40], hillScale: [150, 320], detailAmp: [1, 3], warpAmp: [150, 450],
      pillarAmp: [40, 110], pillarScale: [70, 160], pillarThreshold: [0.38, 0.55],
      terraceStep: [0, 30], terraceMix: [0, 0.8],
    },
    palettes: [
      { sand: '#f0e0ff', low: '#ff4fa0', mid: '#c040ff', high: '#4060ff', cliff: '#202040', peak: '#ffffff', veg: '#40ffd0', veg2: '#a0fff0', deep: '#301050', sky: [0.2, 1.0, 0.62], oceanShallow: '#ff60c0', oceanDeep: '#6010a0', cloud: '#fff0ff', leaf: ['#40ffd0', '#00d0ff', '#80ffe0'], trunk: '#301040', glow: '#40ffff' },
      { sand: '#f0d890', low: '#e0b040', mid: '#c09030', high: '#f0e0a0', cliff: '#5a4020', peak: '#fffbe8', veg: '#ff8030', veg2: '#ffb070', deep: '#4a3010', sky: [0.3, 0.5, 1.0], oceanShallow: '#40e0ff', oceanDeep: '#1030a0', cloud: '#fffff0', leaf: ['#ff8030', '#ff5020', '#ffc060'], trunk: '#3a2810', glow: '#fff060' },
      { sand: '#f4f4f4', low: '#e8e8e8', mid: '#d0d0d0', high: '#b8b8b8', cliff: '#303030', peak: '#ffffff', veg: '#ff3040', veg2: '#ff8080', deep: '#202020', sky: [0.42, 0.42, 0.46], oceanShallow: '#202020', oceanDeep: '#000000', cloud: '#f0f0f0', leaf: ['#ff2a3a', '#ff5060', '#c01020'], trunk: '#1a1a1a', glow: '#ff4040' },
      { sand: '#c06050', low: '#8a1020', mid: '#a02030', high: '#c05040', cliff: '#301018', peak: '#ffd0c0', veg: '#ffd040', veg2: '#ffe890', deep: '#300810', sky: [1.0, 0.3, 0.42], oceanShallow: '#ff8040', oceanDeep: '#801020', cloud: '#ffe0e0', leaf: ['#ffd040', '#ffb020', '#fff080'], trunk: '#2a0a10', glow: '#ffe060' },
    ],
  },
};

// Gas giant band palettes, low to high latitude bands blend through these
export const GAS_PALETTES = [
  ['#d8b890', '#b08060', '#e8d8c0', '#9a6040', '#f0e8d8'],
  ['#8ab0e0', '#5a80c0', '#c0d8f0', '#3a5aa0', '#e0f0ff'],
  ['#e0a0c0', '#b06a90', '#f0d0e0', '#804a70', '#fff0f8'],
  ['#a0d0a0', '#6aa080', '#d0f0c8', '#4a7a60', '#f0fff0'],
  ['#f0c060', '#d08030', '#f8e0a0', '#a05020', '#fff4d0'],
  ['#b0a0e0', '#8070c0', '#d8d0f8', '#5a4a9a', '#f4f0ff'],
  ['#e0e0e0', '#a0a0b0', '#f8f8f8', '#707080', '#ffffff'],
];

export function roll(rng, r) {
  if (!Array.isArray(r)) return r;
  return rng.range(r[0], r[1]);
}

function jitterHex(rng, hex, amount) {
  // small hue/brightness jitter so two planets with the same palette still differ
  const c = parseInt(hex.replace('#', '').padEnd(6, hex.slice(-1)), 16);
  let r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const k = 1 + rng.range(-amount, amount);
  r = Math.min(255, Math.max(0, r * k + rng.range(-10, 10) * amount * 4));
  g = Math.min(255, Math.max(0, g * k + rng.range(-10, 10) * amount * 4));
  b = Math.min(255, Math.max(0, b * k + rng.range(-10, 10) * amount * 4));
  return '#' + ((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1);
}

export function buildPalette(rng, type) {
  const base = rng.pick(type.palettes);
  const p = {};
  for (const [k, v] of Object.entries(base)) {
    if (typeof v === 'string') p[k] = jitterHex(rng, v, 0.08);
    else if (Array.isArray(v) && typeof v[0] === 'string') p[k] = v.map((c) => jitterHex(rng, c, 0.1));
    else p[k] = Array.isArray(v) ? v.map((x) => x * rng.range(0.92, 1.08)) : v;
  }
  return p;
}

export function buildTerrain(rng, type, radius, seed) {
  const r = type.terrain;
  const t = {
    seed,
    radius,
    contScale: radius * rng.range(0.35, 0.7),
    contAmp: roll(rng, r.contAmp),
    contBias: roll(rng, r.contBias),
    oceanDepth: roll(rng, r.oceanDepth),
    mountScale: rng.range(600, 1300),
    mountAmp: roll(rng, r.mountAmp),
    mountCoverage: roll(rng, r.mountCoverage),
    mountSharp: roll(rng, r.mountSharp),
    hillScale: roll(rng, r.hillScale),
    hillAmp: roll(rng, r.hillAmp),
    detailScale: rng.range(22, 45),
    detailAmp: roll(rng, r.detailAmp),
    warpScale: rng.range(1200, 2600),
    warpAmp: roll(rng, r.warpAmp),
    terraceStep: 0,
    terraceMix: 0,
    duneAmp: 0,
    duneScale: 100,
    pillarAmp: 0,
    pillarScale: 100,
    pillarThreshold: 0.5,
    craterDensity: 0,
    craterScale: 500,
    craterDepth: 0.25,
    beachWidth: 2.5,
    moistScale: radius * rng.range(0.15, 0.35),
    hasOcean: false,
  };
  if (r.terraceStep && rng.chance(0.55)) {
    t.terraceStep = roll(rng, r.terraceStep);
    t.terraceMix = roll(rng, r.terraceMix);
  }
  if (r.duneAmp && rng.chance(0.8)) {
    t.duneAmp = roll(rng, r.duneAmp);
    t.duneScale = roll(rng, r.duneScale);
  }
  if (r.pillarAmp && rng.chance(0.7)) {
    t.pillarAmp = roll(rng, r.pillarAmp);
    t.pillarScale = roll(rng, r.pillarScale);
    t.pillarThreshold = roll(rng, r.pillarThreshold);
  }
  if (r.craterDensity) {
    t.craterDensity = roll(rng, r.craterDensity);
    t.craterScale = roll(rng, r.craterScale);
    t.craterDepth = roll(rng, r.craterDepth);
  }
  // keep silhouettes round from orbit
  t.mountAmp = Math.min(t.mountAmp, radius * 0.045);
  t.contAmp = Math.min(t.contAmp, radius * 0.018);
  t.oceanDepth = Math.min(t.oceanDepth, radius * 0.02);
  t.pillarAmp = Math.min(t.pillarAmp, radius * 0.02);
  if (radius < 3000) t.craterScale *= Math.max(0.5, radius / 3000);
  return t;
}
