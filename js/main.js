// ---------------------------------------------------------------------------
// main.js — boot: renderer + bloom composer, world assembly, main loop.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { HOLE_LAYOUT } from './config.js';
import { updateTweens } from './utils.js';
import { audio } from './audio.js';
import { Environment } from './environment.js';
import { AmbientFX } from './ambient.js';
import { BunnyManager } from './bunnies.js';
import { Weapon } from './weapon.js';
import { ParticleSystem, DecalPool, CameraShake, TracerPool } from './effects.js';
import { Game } from './game.js';
import { UI } from './ui.js';
import { addScore } from './leaderboard.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

async function boot() {
  const ui = {};
  let game;

  // --- UI first so the loading bar moves ----------------------------------
  const uiRef = new UI({
    onPlay: (diffId) => { uiRef.showScreen(null); game.startGame(diffId); },
    onResume: () => game.resume(),
    onRestart: () => { uiRef.showScreen(null); game.startGame(game.difficulty.id); },
    onQuitToMenu: () => { game.quitToMenu(); uiRef.refreshMenuHighScores(); },
    onSaveScore: (name) => {
      const r = uiRef.getPendingResult();
      if (!r) return null;
      return addScore({
        name,
        score: r.score,
        difficulty: r.difficulty.id,
        accuracy: r.accuracy,
      });
    },
    onSensitivity: (v) => { if (game) game.sensitivity = v; },
  });
  uiRef.setLoadProgress(0.05);
  await nextFrame();

  // --- Renderer -------------------------------------------------------------
  // antialias is useless with an EffectComposer (geometry renders into an
  // offscreen target), so skip it and let the resolution scaler do the work.
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);

  // Adaptive quality: step the pixel ratio up/down to hold 70+ FPS.
  const QUALITY_STEPS = [1.5, 1.25, 1.0, 0.85];
  let qualityIndex = Math.min(window.devicePixelRatio, 2) >= 1.5 ? 0 : 1;
  function applyQuality() {
    const pr = Math.min(window.devicePixelRatio || 1, QUALITY_STEPS[qualityIndex]);
    renderer.setPixelRatio(pr);
    composer.setPixelRatio(pr);
    composer.setSize(window.innerWidth, window.innerHeight);
  }
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  document.getElementById('game-container').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // Image-based lighting so metals (gun, shells) read as real materials.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 600);
  uiRef.setLoadProgress(0.25);
  await nextFrame();

  // --- World ----------------------------------------------------------------
  const holePositions = HOLE_LAYOUT.map(([deg, dist]) => {
    const a = (deg * Math.PI) / 180;
    return new THREE.Vector3(Math.sin(a) * dist, 0, -Math.cos(a) * dist);
  });
  const env = new Environment(scene, holePositions);
  uiRef.setLoadProgress(0.45);
  await nextFrame();

  const ambient = new AmbientFX(scene, env);
  const manager = new BunnyManager(scene, holePositions);
  uiRef.setLoadProgress(0.65);
  await nextFrame();

  const weapon = new Weapon(camera);
  const particles = new ParticleSystem(scene);
  const decals = new DecalPool(scene);
  const shake = new CameraShake();
  const tracers = new TracerPool(scene);
  uiRef.setLoadProgress(0.8);
  await nextFrame();

  // --- Post-processing (bloom) ----------------------------------------------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // Half-resolution bloom: visually identical for this art style, much cheaper.
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.32, 0.65, 0.82
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  applyQuality();

  game = new Game({ scene, camera, renderer, env, manager, weapon, particles, decals, shake, ui: uiRef, tracers });

  // Dirt poof when a bunny pops out — draws the eye to the hole.
  const _poofDir = new THREE.Vector3(0, 1, 0);
  manager.onBunnyPop = (pos) => {
    particles.dirt(new THREE.Vector3(pos.x, pos.y + 0.15, pos.z), _poofDir);
  };
  uiRef.setLoadProgress(1);
  await nextFrame();

  // --- Global listeners -------------------------------------------------------
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  });

  // Audio needs a user gesture; unlock once, then start menu music + forest.
  const unlock = () => {
    audio.unlock();
    if (audio.ready && game.state === 'idle') {
      audio.startMenuMusic();
      audio.startAmbience();
    }
  };
  window.addEventListener('pointerdown', unlock, { once: false });
  window.addEventListener('keydown', unlock, { once: false });

  // Warn touch users that mouse + keyboard is the intended experience.
  if (window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(pointer: fine)').matches) {
    document.getElementById('touch-note').classList.add('visible');
  }

  // --- Go to the main menu ----------------------------------------------------
  document.getElementById('screen-loading').classList.remove('active');
  uiRef.showScreen('menu');
  uiRef.refreshMenuHighScores();

  // Debug/test hook: ?autoplay=easy|medium|hard jumps straight into a round.
  window.__game = game;
  window.__manager = manager;
  const auto = new URLSearchParams(location.search).get('autoplay');
  if (auto) setTimeout(() => game.startGame(auto), 400);

  // --- Main loop --------------------------------------------------------------
  const clock = new THREE.Clock();
  let elapsed = 0;
  let fpsFrames = 0;
  let fpsTime = 0;
  let tuneAccum = 0;
  let tuneSamples = 0;
  let lastTune = performance.now() + 4000; // warmup before auto-tuning kicks in

  renderer.setAnimationLoop(() => {
    const rawDt = Math.min(clock.getDelta(), 0.05);
    // Hit-stop: brief global slow-down when a bunny is whacked.
    const slowmo = performance.now() < game.hitStopUntil ? 0.12 : 1;
    const dt = rawDt * slowmo;
    elapsed += dt;

    // Auto-tune quality every 2.5 s to hold 70+ FPS (after a warmup).
    tuneAccum += 1 / Math.max(rawDt, 1e-4);
    tuneSamples++;
    if (performance.now() - lastTune > 2500) {
      const avg = tuneAccum / tuneSamples;
      if (avg < 58 && qualityIndex < QUALITY_STEPS.length - 1) { qualityIndex++; applyQuality(); }
      else if (avg > 75 && qualityIndex > 0) { qualityIndex--; applyQuality(); }
      tuneAccum = 0;
      tuneSamples = 0;
      lastTune = performance.now();
    }

    updateTweens(dt);
    env.update(dt, elapsed);
    ambient.update(dt);
    game.update(dt);
    particles.update(dt);
    decals.update(dt);
    tracers.update(dt);
    uiRef.update(dt);

    composer.render();

    fpsFrames++;
    fpsTime += dt;
    if (fpsTime >= 0.5) {
      uiRef.setFPS(Math.round(fpsFrames / fpsTime));
      fpsFrames = 0;
      fpsTime = 0;
    }
  });
}

boot().catch((err) => {
  console.error('Boot failed:', err);
  const label = document.getElementById('load-label');
  if (label) label.textContent = 'Failed to load — see console (F12)';
});
