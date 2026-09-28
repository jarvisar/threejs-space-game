# Starsong

A procedural space exploration game for the browser, built with Three.js. Land on planets, fly between them without loading screens, and follow a signal across a galaxy of 24,000 star systems toward its core.

## Features

- Planets are full-size spheres streamed in as a quadtree of terrain chunks generated in web workers. You can fly from orbit down to the grass without a loading screen.
- Every planet spins, so the sun rises and sets while you walk around. Moons and ringed gas giants cross the sky.
- Atmospheres, oceans, lava seas, ice sheets and cloud layers are rendered in one full screen pass using the depth buffer.
- 10 planet types (lush, oceanic, arid, frozen, scorched, toxic, irradiated, barren, dead and exotic), each with its own palettes, terrain features, weather and hazards.
- Procedural flora, rocks and crystals placed per planet, plus grazing herds, bird flocks and floating drifters. Some lush, oceanic and exotic worlds also have a huge leviathan circling overhead.
- Mining, a scanner, points of interest (Echo Stones, ruins, supply pods, beacons, resource deposits), crafting and eight upgrade tracks.
- Asteroid fields you can mine with the ship's lasers.
- A galaxy map with warp jumps. Stars are gated by color, so better drives open up more of the galaxy.
- A short story that leads from a crash landing to the galactic core.
- All music and sound effects are synthesized in the browser with WebAudio. The music changes with the planet you're on.
- Progress saves to localStorage automatically.

## How to Play

Click the view to capture the mouse. Press Esc at any time to pause and release it.

On foot:

- Use WASD to move and the mouse to look. Hold Shift to sprint.
- Press Space to jump and hold it in the air to use the jetpack.
- Hold Left Mouse to mine rocks, plants and crystals.
- Hold Right Mouse on a plant or creature to catalogue it.
- Press F to send out a scanner pulse that marks nearby sites.
- Press E to interact with sites or board your ship.
- Press R to recharge your hazard shield with 10 Lumen.

In the ship:

- Steer with the mouse. The ship turns toward the reticle.
- Use W/S for throttle and A/D to roll. Hold Shift to boost.
- Press Space away from planets to engage the pulse drive. It slows down on its own as you approach a planet.
- Press E near the ground to land, and E again to get out.
- Hold Left Mouse to fire the mining lasers at asteroids.
- Press F to scan the planet below.

Anywhere:

- Tab opens cargo, crafting, upgrades and the journal.
- G opens the galaxy map. Drag to rotate, scroll to zoom, press C to center on your star and T to find the signal.
- P toggles photo mode, which hides the HUD and gives a free camera.

## Progression

The game starts on a planet with a damaged ship. The objective panel in the top left walks through repairing it, reaching space, landing on another world and crafting a Warp Cell from Hydrogel and Ferrite.

After that a signal points to four resonant systems. Each one has a Chorus Spire on one of its planets that you can see from orbit as a pillar of light. Every spire gives Relic Shards, which the next warp drive needs:

| Drive | Stars it can reach | Range |
| --- | --- | --- |
| Starting drive | Red, orange and yellow | 60 ly |
| Frost Drive | Adds white stars | 120 ly |
| Azure Drive | Adds blue giants | 200 ly |
| Chorus Drive | Adds anomalous stars | 320 ly |

Drive upgrades need resources that only certain planet types have, so you'll have to explore systems along the way. After the fourth spire you can craft a Harmonic Lens and jump to the core. That ends the story, but the save keeps going and you can warp back out and keep exploring.

Echo Stones and ruins are the main source of Relic Shards outside the spires. Scanning plants and creatures earns Data, which most upgrades also cost.

## Local Installation

1. Install Node.js 18 or newer.
2. Clone the repository and open the folder in a terminal.
3. Install dependencies.

   ```
   npm install
   ```

4. Start the dev server.

   ```
   npm run dev
   ```

5. Open http://localhost:5173 in Chrome.

To make a static build, run `npm run build`. The output in `dist` uses relative paths, so it can be served from any folder, including GitHub Pages.

## URL Options

- `?play=new&seed=4242` skips the title screen and starts a new game in that galaxy.
- `?play=continue` skips the title screen and loads the save.
- `?scale=0.75` renders at 75% resolution. Render scale is also in the pause menu.
- `?msaa=0` turns off multisampling.

## Known Issues & Limitations

- Needs WebGL2 with float render targets. It has only been tested in Chrome on Windows.
- On an RTX 4080 Super a frame takes about 3 ms at 1080p. Integrated graphics will need the render scale lowered to 0.5 or 0.6.
- Planets spin but don't orbit their star. Keeping them in place made landing and walking a lot simpler.
- Terrain is a height field, so there are no caves or overhangs.
- Only mouse and keyboard are supported. There is no touch or gamepad input.
- Mined plants and rocks are remembered, but only the most recent 5000.
- The save is stored per browser. Clearing site data deletes it.

## Project Structure

- `src/gen` has the seeded generators for the galaxy, star systems, planets, terrain, flora and names.
- `src/world` has planets and their LOD quadtree, the terrain worker, scatter, creatures, points of interest, asteroids and weather.
- `src/render` has the render pipeline, the atmosphere and ocean shader, bloom and effects.
- `src/player` has the ship, walker, multitool and camera.
- `src/game` has the main loop, story, upgrades and save state.
- `src/ui` has the HUD, menus and galaxy map.
- `src/audio` has the sound engine and generative music.

## Credits

- [Three.js](https://threejs.org)
- Rajdhani font by Indian Type Foundry, via Fontsource (SIL Open Font License)
- 3D simplex noise based on the public domain implementation by Stefan Gustavson and the GLSL version by Ashima Arts (MIT)
