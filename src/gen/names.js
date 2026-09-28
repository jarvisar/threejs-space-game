import { RNG } from '../core/rng.js';

const ONSETS = ['b', 'c', 'd', 'f', 'g', 'h', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'z', 'br', 'cr', 'dr', 'gr', 'kr', 'tr', 'th', 'sh', 'st', 'sk', 'vr', 'zh', 'ch', 'qu', 'x', 'ph'];
// after a syllable that ended in a consonant, so runs stay at two letters
const INNER = ['l', 'r', 'n', 'v', 's', 't', 'm', 'd', 'k', 'th', 'sh'];
const VOWELS = ['a', 'a', 'e', 'e', 'i', 'o', 'o', 'u', 'y'];
const PAIRS = ['ae', 'ai', 'au', 'ei', 'ia', 'io', 'ou', 'oa', 'ea'];
const MID_CODAS = ['', '', '', '', '', '', '', 'n', 'r', 'l'];
const END_CODAS = ['', '', '', 'n', 'r', 's', 'l', 'th', 'x', 'm', 'k', 'nd', 'rn', 'st', 'll', 'ss', 'v'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const SUFFIX = [' Prime', ' Major', ' Minor', ' Reach', ' Deep', ' Drift', ' Veil', ' Crown'];
const PREFIX = ['New ', 'Old ', 'Far ', 'Lesser '];
const LATIN_END = ['us', 'is', 'a', 'um', 'ae', 'ii', 'ora', 'ensis', 'ix', 'ata', 'oides'];

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// At most one vowel pair per word so names stay readable.
function word(rng, count, vowelStart = 0.12) {
  let s = '';
  let coda = '';
  let paired = false;
  for (let i = 0; i < count; i++) {
    let on;
    if (i === 0) on = rng.chance(vowelStart) ? '' : rng.pick(ONSETS);
    else on = coda ? rng.pick(INNER) : rng.pick(ONSETS);
    let v = !paired && rng.chance(0.3) ? rng.pick(PAIRS) : rng.pick(VOWELS);
    if (v.length > 1) paired = true;
    if (on === 'qu' && v[0] === 'u') v = 'a';
    coda = rng.pick(i === count - 1 ? END_CODAS : MID_CODAS);
    s += on + v + coda;
  }
  return s.replace(/(.)\1\1/g, '$1$1');
}

// Mostly two syllables, three reads busy. Long names drop a syllable
// instead of getting cut mid-syllable.
export function makeName(seed, min = 2, max = 3) {
  const rng = new RNG(seed);
  let s = word(rng, rng.chance(0.65) ? min : rng.int(min, max));
  if (s.length > 10) s = word(rng, min);
  if (s.length < 3) s += rng.pick(['on', 'ar', 'is', 'ex']);
  return cap(s);
}

export function systemName(seed) {
  const rng = new RNG(seed ^ 0x5151);
  let n = makeName(seed, 2, 3);
  const r = rng.next();
  if (r < 0.15) n += '-' + rng.int(2, 99);
  else if (r < 0.25) n += rng.pick(SUFFIX);
  else if (r < 0.32) n = rng.pick(PREFIX) + n;
  return n;
}

export function planetName(seed, systemNameStr, index) {
  const rng = new RNG(seed ^ 0x7a7a);
  if (rng.chance(0.2)) {
    // "Lesser Vrakriss" gives "Vrakriss II", not "Lesser II"
    const base = PREFIX.reduce((s, p) => (s.startsWith(p) ? s.slice(p.length) : s), systemNameStr).split(/[ -]/)[0];
    return `${base} ${ROMAN[index] || index + 1}`;
  }
  let n = makeName(seed, 2, 3);
  if (rng.chance(0.1)) n += ' ' + rng.pick(['Beta', 'Tau', 'Omega', 'Sigma', 'Vex']);
  return n;
}

export function speciesName(seed) {
  const rng = new RNG(seed ^ 0x3c3c);
  let genus = word(rng, rng.int(2, 3));
  if (genus.length > 10) genus = word(rng, 2);
  let sp = word(rng, 1, 0).replace(/[aeiouy]+$/, '');
  if (sp.length < 3) sp += rng.pick(VOWELS) + rng.pick(INNER);
  sp += rng.pick(LATIN_END);
  return `${cap(genus)} ${sp}`;
}
