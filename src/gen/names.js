import { RNG } from '../core/rng.js';

const ONSETS = ['', '', 'b', 'c', 'd', 'f', 'g', 'h', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'z', 'br', 'cr', 'dr', 'gr', 'kr', 'tr', 'th', 'sh', 'st', 'sk', 'vr', 'zh', 'ch', 'qu', 'y', 'x', 'ph'];
const VOWELS = ['a', 'a', 'e', 'e', 'i', 'o', 'o', 'u', 'ae', 'ai', 'au', 'ei', 'ia', 'io', 'ou', 'y', 'oa', 'ea'];
const CODAS = ['', '', '', '', 'n', 'r', 's', 'l', 'th', 'x', 'm', 'k', 'nd', 'rn', 'st', 'll', 'ss', 'v'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const SUFFIX = [' Prime', ' Major', ' Minor', ' Reach', ' Deep', ' Drift', ' Veil', ' Crown'];
const LATIN_END = ['us', 'is', 'a', 'um', 'ae', 'ii', 'ora', 'ensis', 'ix', 'ata', 'oides'];

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function syllables(rng, count) {
  let s = '';
  for (let i = 0; i < count; i++) {
    let on = rng.pick(ONSETS);
    if (i > 0 && on === '') on = rng.pick(['l', 'r', 'n', 'v', 's', 't', 'm']);
    s += on + rng.pick(VOWELS);
    if (i === count - 1 || rng.chance(0.25)) s += rng.pick(CODAS);
  }
  return s.replace(/(.)\1\1/g, '$1$1');
}

export function makeName(seed, min = 2, max = 3) {
  const rng = new RNG(seed);
  let s = syllables(rng, rng.int(min, max));
  if (s.length > 11) s = s.slice(0, 11);
  if (s.length < 3) s += rng.pick(['on', 'ar', 'is', 'ex']);
  return cap(s);
}

export function systemName(seed) {
  const rng = new RNG(seed ^ 0x5151);
  let n = makeName(seed, 2, 3);
  const r = rng.next();
  if (r < 0.15) n += '-' + rng.int(2, 99);
  else if (r < 0.25) n += rng.pick(SUFFIX);
  else if (r < 0.32) n = rng.pick(['New ', 'Old ', 'Far ', 'Lesser ']) + n;
  return n;
}

export function planetName(seed, systemNameStr, index) {
  const rng = new RNG(seed ^ 0x7a7a);
  if (rng.chance(0.2)) return `${systemNameStr.split(/[ -]/)[0]} ${ROMAN[index] || index + 1}`;
  let n = makeName(seed, 2, 3);
  if (rng.chance(0.1)) n += ' ' + rng.pick(['Beta', 'Tau', 'Omega', 'Sigma', 'Vex']);
  return n;
}

export function speciesName(seed) {
  const rng = new RNG(seed ^ 0x3c3c);
  const genus = cap(syllables(rng, rng.int(2, 3)).slice(0, 10));
  let sp = syllables(rng, rng.int(1, 2)).slice(0, 7);
  sp = sp.replace(/[aeiouy]+$/, '') + rng.pick(LATIN_END);
  return `${genus} ${sp}`;
}
