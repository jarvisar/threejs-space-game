// Whether the player is using touch or mouse and keyboard right now. It starts
// from what the primary pointer looks like and then follows whatever was used
// last, so a tablet with a keyboard or a laptop with a touchscreen still ends
// up with the right controls.

const coarse = matchMedia('(pointer: coarse)').matches;

export const device = {
  touch: coarse,
  // phones and tablets, used for first run defaults like the graphics preset
  mobile: coarse || (navigator.maxTouchPoints > 0 && !matchMedia('(any-pointer: fine)').matches),
  standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
};

const listeners = [];

export function onDeviceChange(fn) {
  listeners.push(fn);
}

function setTouch(v) {
  if (device.touch === v) return;
  device.touch = v;
  document.documentElement.classList.toggle('touch', v);
  for (const fn of listeners) fn();
}

document.documentElement.classList.toggle('touch', device.touch);
window.addEventListener('pointerdown', (e) => setTouch(e.pointerType !== 'mouse'), true);
window.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse' && (e.movementX || e.movementY)) setTouch(false);
}, true);
window.addEventListener('keydown', (e) => {
  const tag = e.target && e.target.tagName;
  // the on-screen keyboard in the seed box sends keys too, and some phones
  // send the volume buttons as keys
  if (tag === 'INPUT' || tag === 'TEXTAREA' || !e.code || /^(Audio|Media|Browser|Launch)/.test(e.code)) return;
  setTouch(false);
}, true);

// Safari ignores user-scalable=no and would still pinch zoom the whole page
document.addEventListener('gesturestart', (e) => e.preventDefault());

export const canFullscreen =() => !!document.fullscreenEnabled && !device.standalone;

export function toggleFullscreen(on = !document.fullscreenElement) {
  // only works inside a tap, ?play= starts without one
  if (!canFullscreen() || (navigator.userActivation && !navigator.userActivation.isActive)) return;
  if (on && !document.fullscreenElement) document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  else if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
