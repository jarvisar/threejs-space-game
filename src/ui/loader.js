// The loading screen from index.html (#boot). It's up from the first paint
// until the title screen is ready, then comes back as a small bar on the
// black screen while a game loads.

const root = document.getElementById('boot');
const bar = root.querySelector('.boot-bar i');
const label = root.querySelector('.boot-label');
let shown = 0;
let booting = true;

function setBar(p, animate) {
  shown = p;
  bar.style.transition = animate ? '' : 'none';
  bar.style.transform = `scaleX(${Math.max(0.03, p).toFixed(3)})`;
}

export const loader = {
  // p is 0..1. The bar never moves back within one load.
  progress(p, text) {
    if (p > shown) setBar(Math.min(1, p), true);
    if (text && label.textContent !== text) label.textContent = text;
  },

  hide() {
    booting = false;
    root.classList.add('done');
  },

  // the canvas starts hidden (index.html) so frames held back while shaders
  // compile show as black instead of a stale image
  showView() {
    document.getElementById('app').classList.add('show');
  },

  // Only the bar and label, over the black fade. CSS holds it back for a
  // moment so a quick load never flashes it. With ?play= the game loads
  // straight from the boot screen, which just stays up instead.
  showMini(text) {
    if (booting) return;
    setBar(0, false);
    label.textContent = text || '';
    root.classList.add('mini');
    root.classList.remove('done');
  },

  // back to the static about text from index.html with an error under it
  fail(message) {
    document.documentElement.classList.remove('js');
    const about = document.getElementById('about');
    about.hidden = false;
    const p = document.createElement('p');
    p.className = 'about-error';
    p.textContent = message;
    about.appendChild(p);
  },
};
