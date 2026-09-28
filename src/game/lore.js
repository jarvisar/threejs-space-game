import { RNG } from '../core/rng.js';

// Story text for the spires and the ending, plus the random logs in Echo
// Stones, ruins and wrecks.

export const RESONANCES = [
  {
    title: 'First Spire',
    text: [
      'The spire activated and played a message: <i>Follow the spires to the center of the galaxy.</i>',
      'The next signal needs the Frost Drive. Install it from the Upgrades tab.',
    ],
  },
  {
    title: 'Second Spire',
    text: [
      'Another message: <i>We built the spires so someone would find their way back to us.</i>',
      'The next signal needs the Azure Drive. Install it from the Upgrades tab.',
    ],
  },
  {
    title: 'Third Spire',
    text: [
      'This spire showed images instead of words. Thousands of ships followed the spires toward the core long before you. None of them came back.',
      'The last signal needs the Chorus Drive. Install it from the Upgrades tab.',
    ],
  },
  {
    title: 'Final Spire',
    text: [
      'The last message: <i>Come to the core. Finish the song.</i>',
      'Craft a Harmonic Lens, then make the Core Jump from the galaxy map.',
    ],
  },
];

export const ENDING = {
  title: 'The Core',
  text: [
    'You reached the center of the galaxy. This is where the Chorus signal comes from.',
    'The Chorus was never lost. It was waiting for someone to follow the spires all the way in.',
  ],
};

const LOGS = [
  'Followed the spires until my fuel ran low. The signal got stronger at each one.',
  'Named this planet {planet}. Staying a few days to map it.',
  'Every Echo Stone I find is older than the last one.',
  'Stay away from blue stars until your drive is upgraded.',
  'Storms drain your suit fast. Stay near the ship when one starts.',
  'Ferrite, carbon and a bit of hydrogel. That covers most of what you need out here.',
  'Someone left these stones on purpose. They all point to the same signal.',
  'Mine what you need and move on. The next planet will have more.',
  'Lost my ship on {planet}. Took me two days to find it again.',
  'Best night sky I have seen so far is over {system}.',
  'I think the Chorus is alive. The spires only turn on when someone gets close.',
  'Found a moon full of cobalt. Stayed a week mining it.',
  'You can see the spires from orbit. Look for a beam of light.',
  'Glowing plants have Lumen in them. Keep some for your shield.',
  'If you found this stone, you picked up the signal too.',
];

export function echoText(seed, planetName, systemName) {
  const rng = new RNG(seed);
  const t = rng.pick(LOGS).replace('{planet}', planetName).replace('{system}', systemName);
  return [`<i>${t}</i>`];
}

const WRECK_LOGS = [
  'Engines failed on approach and we came down hard. The signal is stronger here than anywhere we have been.',
  'Day forty. The crew wants to go home. I want to keep following the signal.',
  'Followed a beam of light down to the surface and lost it. Landing to look for it.',
  'Cargo: ferrite, hydrogel, and one crate with a spiral on it. Do not open the crate.',
  'Whoever finds this, take what is left in the hold. We will not need it.',
  'The drive kept retuning itself, then shut down. We could not restart it.',
  'Spent three weeks mapping {planet} before a storm brought us down.',
  'The Echo Stones here hum at night. Nobody on the crew can sleep.',
];

export function wreckLog(seed, name, planetName = 'this world') {
  const rng = new RNG(seed ^ 0x51de);
  return [`<i>${rng.pick(WRECK_LOGS).replace('{planet}', planetName)}</i>`];
}
