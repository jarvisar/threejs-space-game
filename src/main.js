import './ui/style.css';
import './ui/menus.css';
import { Game } from './game/Game.js';
import { initPwa, registerServiceWorker } from './pwa.js';
import { loader } from './ui/loader.js';
import { prepareView, compileView, afterFrames } from './render/warmup.js';

// Compiling the shaders the normal way, on the first frame, froze the page for
// several seconds. Now they compile in the background while the loading screen
// from index.html is up, and nothing is drawn until they're done.
async function boot() {
  let game;
  try {
    game = new Game(document.getElementById('app'), document.getElementById('ui'));
  } catch (err) {
    // usually no WebGL2
    console.error(err);
    loader.fail("This browser couldn't start WebGL2, so the game can't run here.");
    return;
  }
  document.getElementById('about').hidden = true;
  const params = new URLSearchParams(location.search);

  loader.progress(0.08, 'Generating galaxy');
  // give the label a frame to show, showTitle() holds the main thread for a bit
  await afterFrames(2);
  game.showTitle();
  game.holdRender = true;
  game.start();

  const parallel = game.renderer.extensions.has('KHR_parallel_shader_compile');
  // ?play=new or ?play=continue skips the title screen
  if (params.has('play')) {
    await game.startFromTitle(params.get('play') === 'continue' ? 'continue' : 'new', parseInt(params.get('seed') || '1337', 10));
  } else {
    const view = prepareView(game, { onProgress: (p, label) => loader.progress(0.12 + p * 0.88, label) }).catch((err) => {
      // the game still runs without it, just with a rough first few seconds
      console.error(err);
    });
    // The atmosphere pass is by far the slowest shader, over a second on
    // Windows where ANGLE compiles through D3D, and it has been 10 s before.
    // With the parallel compile extension the title buttons show after 800 ms
    // without waiting for it (everything else is usually done in about 300 ms)
    // and the planet fades in behind them. Without the extension linking
    // blocks the main thread, so the loading screen stays up until the end.
    const early = parallel && (await Promise.race([view.then(() => false), wait(800).then(() => true)]));
    if (early) loader.hide();
    await view;
    // New Journey clicked in the meantime, that load owns the canvas now
    if (!game.loadingGame) {
      game.holdRender = false;
      await afterFrames(2);
      loader.showView();
      if (!early) loader.hide();
    }
  }
  window.__boot = { ready: performance.now() };

  // Start on the shaders for the first game in the background while the title
  // is up, so New Journey doesn't have to wait for them. Only with the parallel
  // compile extension, without it this would freeze the title screen instead.
  if (parallel) compileView(game, game.warmupGroup());
  registerServiceWorker();
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

initPwa();
boot().catch((err) => {
  console.error(err);
  loader.fail('Something went wrong while loading. Try reloading the page.');
});
