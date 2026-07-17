# Whack-a-Bunny 🐰🔫

A polished first-person arcade shooter for the browser — whack-a-mole, but with
a rifle. Bunnies pop out of holes across a living meadow; shoot as many as you
can before the clock runs out.

Built with **Three.js** (vendored locally in `vendor/`, works fully offline) and
the **Web Audio API**. Every model is procedural, every texture is generated on
a canvas, and every sound is synthesized — there are zero binary assets.

## Run it

Any static file server works:

```bash
python -m http.server 8123
# then open http://localhost:8123/
```

or `npx serve`, or the VS Code Live Server extension.

> Opening `index.html` directly from disk (`file://`) will NOT work — ES modules
> require HTTP.

## How to play

- **Mouse** — aim (click once to lock the pointer)
- **Left click** — shoot
- **R** — reload (auto-reloads when empty, 8 rounds per mag)
- **Esc / P** — pause
- Touch devices: drag to aim, tap to shoot (mouse + keyboard recommended)

Three difficulties:

| Mode   | Time | Spawns  | Visible   | Hitbox | Fake pop-ups |
| ------ | ---- | ------- | --------- | ------ | ------------ |
| Easy   | 90 s | slow    | 2.2–3.2 s | large  | —            |
| Medium | 60 s | medium  | 1.6–2.4 s | normal | —            |
| Hard   | 45 s | fast    | 1.0–1.6 s | small  | yes          |

+100 per bunny. High scores and the leaderboard are stored in `localStorage`.

## Features

- Full menu flow: animated main menu, difficulty select, settings (sound /
  music / sensitivity, persisted), leaderboard, pause, results, countdown.
- FPS feel: recoil spring, muzzle flash (sprite + point light), shell ejection,
  reload animation, idle breathing, mouse-lag sway, trauma-based camera shake.
- Hit feedback: blood puffs + ground splat decals, hitmarker, score popups,
  red-flash death animation, dirt/wood/rock impact effects with bullet decals.
- A living world: instanced wind-swaying grass, procedural trees and fences,
  drifting clouds, falling leaves, birds, butterflies, pollen, light rays,
  wind gusts and occasional light rain — all pooled, all scheduled randomly.
- Post-processing: Unreal bloom, ACES tone mapping, CSS vignette.
- Synthesized audio: gunshot, reload, squeaks, hit confirm, UI blips, countdown,
  victory jingle, menu music, forest ambience with random bird chirps, rain.

## Project layout

```
index.html            DOM for all screens + HUD, import map
css/style.css         glassmorphism UI, animations, responsive rules
js/main.js            boot, renderer + bloom composer, main loop
js/game.js            state machine, aiming, raycast shooting, scoring
js/environment.js     sky/sun/fog/terrain/grass/trees/fences/rocks/clouds
js/ambient.js         random ambient events (leaves, birds, rain, gusts…)
js/bunnies.js         bunny model + pop-up state machine + spawn manager
js/weapon.js          view-model gun: recoil, flash, reload, shells
js/effects.js         pooled particles, decal pool, camera shake
js/audio.js           Web Audio synth engine (SFX + ambience + music)
js/ui.js              screen manager, HUD, countdown, results, settings
js/leaderboard.js     localStorage score table
js/config.js          difficulty presets, world layout
js/utils.js           RNG, easings, tween manager, object pool
test/e2e.mjs          headless-Chrome end-to-end test (npm test)
```

## Tests

```bash
npm install          # installs puppeteer-core (dev only)
npm run serve &      # serve on :8123
npm test             # drives the full game loop in headless Chrome
```

The debug hook `?autoplay=easy|medium|hard` skips the menu straight into a round.
