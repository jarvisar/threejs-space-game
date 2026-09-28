import './ui/style.css';
import './ui/menus.css';
import { Game } from './game/Game.js';

const game = new Game(document.getElementById('app'), document.getElementById('ui'));
const params = new URLSearchParams(location.search);
game.showTitle();
// ?play=new or ?play=continue skips the title screen
if (params.has('play')) game.startFromTitle(params.get('play') === 'continue' ? 'continue' : 'new', parseInt(params.get('seed') || '1337', 10));
game.start();
