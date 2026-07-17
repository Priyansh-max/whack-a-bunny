// ---------------------------------------------------------------------------
// main.js — boot: renderer + bloom composer, world assembly, main loop.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { HOLE_LAYOUT } from './config.js';
import { updateTweens } from './utils.js';
import { audio } from './audio.js';
import { Environment } from './environment.js';
import { AmbientFX } from './ambient.js';
import { BunnyManager } from './bunnies.js';
import { Weapon } from './weapon.js';
import { ParticleSystem, DecalPool, CameraShake } from './effects.js';
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
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  document.getElementById('game-container').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 600);
  uiRef.setLoadProgress(0.2);
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
  uiRef.setLoadProgress(0.8);
  await nextFrame();

  // --- Post-processing (bloom) ----------------------------------------------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight), 0.32, 0.65, 0.82
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  game = new Game({ scene, camera, renderer, env, manager, weapon, particles, decals, shake, ui: uiRef });
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

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;

    updateTweens(dt);
    env.update(dt, elapsed);
    ambient.update(dt);
    game.update(dt);
    particles.update(dt);
    decals.update(dt);
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
