// Graphics presets for the pause menu. High is what the game was tuned with on
// a desktop GPU and stays the desktop default. Low is the default on phones and
// tablets. The atmosphere pass is a full screen raymarch and costs the most on
// a phone GPU, so its step counts drop the most. Fewer view steps mostly shows
// as slightly softer cloud edges from the ground.
export const PRESETS = [
  { name: 'Low', pixelRatio: 1.5, samples: 2, shadowMap: 1024, atmo: [8, 4, 6], lod: 0.75, scatter: 0.65 },
  { name: 'Medium', pixelRatio: 1.75, samples: 4, shadowMap: 2048, atmo: [11, 5, 9], lod: 0.88, scatter: 0.82 },
  { name: 'High', pixelRatio: 2, samples: 4, shadowMap: 2048, atmo: [14, 6, 12], lod: 1, scatter: 1 },
];

// Read by planets every frame (terrain split distance) and by scatter when a
// surface streams in (flora draw distance), so a change to scatter only shows
// after the next landing.
export const detail = { lod: 1, scatter: 1 };
