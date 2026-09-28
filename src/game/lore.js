import { RNG } from '../core/rng.js';

// Story text for the resonant spires and the ending, plus the procedural
// echoes recorded in Echo Stones.

export const RESONANCES = [
  {
    title: 'First Resonance',
    text: [
      'The spire wakes as you walk up to it. Light runs up its faces and a low tone fills the valley. You feel it in your chest more than you hear it.',
      'A fragment settles into words: <i>The song was broken into pieces so it could travel. Carry the pieces home.</i>',
      'Your drive logs a new harmonic, one your engines cannot hold yet. The pattern for a colder drive is written into the stone.',
    ],
  },
  {
    title: 'Second Resonance',
    text: [
      'This spire sings higher than the first. The Chorus has more to say now that it knows someone is listening.',
      '<i>Every star is a note. Every world is a rest between notes. We sang the first light, and the light forgot us.</i>',
      'A second harmonic settles into your drive. It wants to go somewhere bluer and louder.',
    ],
  },
  {
    title: 'Third Resonance',
    text: [
      'The blue giant bends the signal, but the spire holds it steady. This time the Chorus sends images instead of words.',
      'Ships like yours, thousands of them, following the same pillars of light long before your people first looked up. All of them turned toward the center. None came back to say what they found.',
      'The last pattern is strange. It only makes sense near stars that should not exist.',
    ],
  },
  {
    title: 'Final Resonance',
    text: [
      'Under the anomalous star the spire looks alive. The last harmonic is loud enough to shake dust off the stone.',
      '<i>Come to the heart. Finish the song.</i>',
      'Your drive can reach the galactic core now, if you focus it. Craft a Harmonic Lens and make the Core Jump from the galaxy map.',
    ],
  },
];

export const ENDING = {
  title: 'The Heart of the Chorus',
  text: [
    'The core is not a black hole. It is a chord of light, still ringing from the first moment of everything.',
    'Your hull hums in tune with it. For a moment you hear every world you walked on, every plant you catalogued, every stone that spoke to you, all at once.',
    'The Chorus was never lost. It was waiting for someone to listen from the outside.',
    'Somewhere far from here, a new galaxy begins to sing.',
  ],
};

const OPENERS = [
  'A traveler left a log in this stone.',
  'A recorded voice, patient and tired:',
  'The stone hums, then plays back a message.',
  'Glyphs rearrange themselves into something your visor can read.',
  'An old recording, half eaten by static:',
  'The stone remembers someone who stood here before you.',
];

const THOUGHTS = [
  'I followed the pillars of light until my fuel ran thin. The song got louder every time.',
  'The plants here hum at night. I think they learned the tune from the stones.',
  'We named this world {planet}. It never answered to the name.',
  'Every stone I find is older than the last. Someone planted a trail.',
  'The center of the galaxy is quieter than it should be. Like an instrument waiting for a hand.',
  'Stay away from blue stars until your drive is ready. They sing so loud you cannot hear yourself think.',
  'Every living thing on this world grows toward the core. I checked.',
  'The storms here come in rhythm. Count them. Four beats, then silence.',
  'If you are reading this, you hear it too.',
  'My drive started humming in a key I do not recognize.',
  'In the old language there is one word for both star and note.',
  'The ruins face the same way on every world. Toward the heart.',
  'I left the settlements to find the source. They called it madness. It feels more like homesickness.',
  'Carbon, ferrite, a little hydrogel. That is all a life needs out here. That and the song.',
  'The Wayfarers before me left these stones as tuning forks.',
  'Some nights the sky over {system} looks like a stave of music.',
  'I do not think the Chorus is a message. I think it is a mind, and it is waking up.',
  'Mine what you need and leave the rest. The worlds remember.',
  'The spires only wake for people who have been listening.',
  'I found a moon where the rocks sing back when you shoot them. I stopped mining there.',
];

export function echoText(seed, planetName, systemName) {
  const rng = new RNG(seed);
  const open = rng.pick(OPENERS);
  const t = rng.pick(THOUGHTS).replace('{planet}', planetName).replace('{system}', systemName);
  return [open, `<i>${t}</i>`];
}
