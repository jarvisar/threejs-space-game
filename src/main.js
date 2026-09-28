import './ui/style.css';
import './ui/menus.css';
import { Game } from './game/Game.js';
import { initPwa } from './pwa.js';

const about = document.getElementById('about');
let game = null;
try {
  game = new Game(document.getElementById('app'), document.getElementById('ui'));
} catch (err) {
  // usually no WebGL2. Leave the static text from index.html up with a note.
  console.error(err);
  const p = document.createElement('p');
  p.className = 'about-error';
  p.textContent = "This browser couldn't start WebGL2, so the game can't run here.";
  about.appendChild(p);
}

if (game) {
  about.hidden = true;
  const params = new URLSearchParams(location.search);
  game.showTitle();
  // ?play=new or ?play=continue skips the title screen
  if (params.has('play')) game.startFromTitle(params.get('play') === 'continue' ? 'continue' : 'new', parseInt(params.get('seed') || '1337', 10));
  game.start();
}
initPwa();
