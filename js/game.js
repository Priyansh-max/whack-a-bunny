// ---------------------------------------------------------------------------
// game.js — core gameplay: camera rig, pointer-lock aiming, raycast shooting,
// scoring, timer, pause and the countdown → play → results state machine.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { clamp, damp } from './utils.js';
import { DIFFICULTIES, SCORE_PER_BUNNY, PLAYER_HEIGHT } from './config.js';
import { audio } from './audio.js';
import { recordHighScore } from './leaderboard.js';

export class Game {
  constructor({ scene, camera, renderer, env, manager, weapon, particles, decals, shake, ui }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.env = env;
    this.manager = manager;
    this.weapon = weapon;
    this.particles = particles;
    this.decals = decals;
    this.shake = shake;
    this.ui = ui;

    this.state = 'idle'; // idle | countdown | playing | paused | over
    this.difficulty = DIFFICULTIES.medium;
    this.sensitivity = 1;

    // Camera rig: yaw group → pitch group → camera.
    this.yawObj = new THREE.Group();
    this.yawObj.position.set(0, PLAYER_HEIGHT, 0);
    this.pitchObj = new THREE.Group();
    this.yawObj.add(this.pitchObj);
    this.pitchObj.add(camera);
    scene.add(this.yawObj);
    this.yaw = 0;
    this.pitch = 0;
    this.kick = 0; // recoil pitch kick that recovers
    this._shakeOut = { x: 0, y: 0, z: 0 };

    this.raycaster = new THREE.Raycaster();
    this._center = new THREE.Vector2(0, 0);
    this._tmpV = new THREE.Vector3();

    this.score = 0;
    this.shots = 0;
    this.hits = 0;
    this.timeLeft = 0;
    this.countdownT = 0;
    this.countdownValue = 0;

    this._lookDX = 0;
    this._lookDY = 0;
    this._touch = null;

    this._bindInput();
  }

  // ---------------------------------------------------------------- input --
  _bindInput() {
    document.addEventListener('mousemove', (e) => {
      if (this.state !== 'playing' || document.pointerLockElement !== this.renderer.domElement) return;
      this._lookDX += e.movementX;
      this._lookDY += e.movementY;
      const s = 0.0021 * this.sensitivity;
      this.yaw -= e.movementX * s;
      this.pitch -= e.movementY * s;
      this.pitch = clamp(this.pitch, -0.55, 1.05);
    });

    document.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (this.state === 'playing') {
        if (document.pointerLockElement === this.renderer.domElement) this.shoot();
        else this.requestLock();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyR' && this.state === 'playing') this.weapon.reload();
      if (e.code === 'KeyP') {
        if (this.state === 'playing') this.pause();
        else if (this.state === 'paused') this.resume();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.renderer.domElement;
      if (!locked && this.state === 'playing') this.pause();
      if (locked && this.state === 'paused') {
        this.state = 'playing';
        this.ui.showScreen(null); // back to pure HUD
      }
    });

    // Basic touch support: drag to aim, tap to shoot.
    const el = this.renderer.domElement;
    el.addEventListener('touchstart', (e) => {
      if (this.state !== 'playing') return;
      const t = e.changedTouches[0];
      this._touch = { x: t.clientX, y: t.clientY, t: performance.now(), moved: 0 };
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (this.state !== 'playing' || !this._touch) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - this._touch.x;
      const dy = t.clientY - this._touch.y;
      this._touch.x = t.clientX;
      this._touch.y = t.clientY;
      this._touch.moved += Math.abs(dx) + Math.abs(dy);
      const s = 0.0042 * this.sensitivity;
      this.yaw -= dx * s;
      this.pitch = clamp(this.pitch - dy * s, -0.55, 1.05);
    }, { passive: true });
    el.addEventListener('touchend', () => {
      if (this.state !== 'playing' || !this._touch) return;
      if (performance.now() - this._touch.t < 260 && this._touch.moved < 14) this.shoot();
      this._touch = null;
    }, { passive: true });
  }

  requestLock() {
    const el = this.renderer.domElement;
    if (document.pointerLockElement !== el) {
      try {
        const p = el.requestPointerLock();
        if (p && typeof p.catch === 'function') p.catch(() => { /* user clicks to re-lock */ });
      } catch { /* ignored — user can click */ }
    }
  }

  // ------------------------------------------------------------ game flow --
  startGame(difficultyId) {
    this.difficulty = DIFFICULTIES[difficultyId] || DIFFICULTIES.medium;
    this.score = 0;
    this.shots = 0;
    this.hits = 0;
    this.timeLeft = this.difficulty.gameTime;
    this.yaw = 0;
    this.pitch = 0;
    this.kick = 0;
    this.decals.clear();
    this.weapon.reset();
    this.weapon.enabled = true;
    this.manager.start(this.difficulty);

    this.ui.resetHUD(this.difficulty);
    this.ui.setHighScore(recordHighScore(this.difficulty.id, 0));
    this.state = 'countdown';
    this.countdownValue = 3;
    this.countdownT = 0;
    this.ui.showScreen(null);
    this.ui.setCountdown('3');
    audio.countdownBeep(false);
    audio.stopMenuMusic();
    audio.startAmbience();
    this.requestLock();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.ui.showScreen('pause');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.ui.showScreen(null);
    this.requestLock();
    // If the lock request is denied (rare), still resume — a click re-locks.
    if (document.pointerLockElement !== this.renderer.domElement) {
      // Defer to the pointerlockchange handler; give it a beat, then resume anyway.
      setTimeout(() => {
        if (this.state === 'paused') {
          this.state = 'playing';
          this.ui.showScreen(null);
        }
      }, 250);
    }
  }

  endGame() {
    this.state = 'over';
    this.manager.stop();
    this.weapon.enabled = false;
    if (document.pointerLockElement) document.exitPointerLock();
    const accuracy = this.shots > 0 ? (this.hits / this.shots) * 100 : 0;
    const high = recordHighScore(this.difficulty.id, this.score);
    audio.victory();
    this.ui.showResults({
      score: this.score,
      hits: this.hits,
      shots: this.shots,
      accuracy,
      difficulty: this.difficulty,
      highScore: high,
    });
  }

  quitToMenu() {
    this.state = 'idle';
    this.manager.stop();
    this.weapon.enabled = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.ui.showScreen('menu');
    audio.startMenuMusic();
  }

  // -------------------------------------------------------------- shooting --
  shoot() {
    if (this.state !== 'playing') return;
    if (!this.weapon.fire()) return;

    this.shots++;
    this.kick += 0.016;
    this.shake.add(0.16);

    this.raycaster.setFromCamera(this._center, this.camera);

    // Bunnies first.
    const targets = this.manager.hitTargets();
    const bunnyHits = this.raycaster.intersectObjects(targets, false);
    if (bunnyHits.length) {
      const hit = bunnyHits[0];
      const bunny = hit.object.userData.bunny;
      if (bunny && bunny.hit()) {
        this.hits++;
        this.score += SCORE_PER_BUNNY;
        const dir = this.raycaster.ray.direction;
        this.particles.blood(hit.point, dir);
        // Blood splat decal on the ground just behind the hole.
        this._tmpV.copy(hit.point).addScaledVector(dir, 0.7);
        this._tmpV.y = 0.02;
        this.decals.place(this._tmpV, new THREE.Vector3(0, 1, 0), 'splat');
        this.shake.add(0.22);
        audio.hitConfirm();
        this.ui.hitmarker();
        this.ui.setScore(this.score);
        this.ui.setHits(this.hits);
        this.ui.setAccuracy(this._accuracy());
        this.ui.scorePopup(this._toScreen(hit.point), `+${SCORE_PER_BUNNY}`);
        this.ui.setAmmo(this.weapon.ammo);
        this.ui.setShots(this.shots);
        return;
      }
    }

    // Environment impacts.
    const envHits = this.raycaster.intersectObjects(this.env.raycastTargets, false);
    if (envHits.length) {
      const hit = envHits[0];
      const type = hit.object.userData.impactType || 'dirt';
      const normal = hit.face
        ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
        : new THREE.Vector3(0, 1, 0);
      const dir = this.raycaster.ray.direction;
      if (type === 'wood') { this.particles.wood(hit.point, dir); audio.impactWood(); }
      else if (type === 'rock') { this.particles.rock(hit.point, dir); audio.impactDirt(); }
      else { this.particles.dirt(hit.point, dir); audio.impactDirt(); }
      this.decals.place(hit.point, normal, 'hole');
    }

    this.ui.setShots(this.shots);
    this.ui.setAccuracy(this._accuracy());
    this.ui.setAmmo(this.weapon.ammo);
    this.ui.pulseCrosshair();
  }

  _accuracy() {
    return this.shots > 0 ? (this.hits / this.shots) * 100 : 100;
  }

  _toScreen(worldPos) {
    this._tmpV.copy(worldPos).project(this.camera);
    return {
      x: (this._tmpV.x * 0.5 + 0.5) * window.innerWidth,
      y: (-this._tmpV.y * 0.5 + 0.5) * window.innerHeight,
    };
  }

  // ---------------------------------------------------------------- update --
  update(dt) {
    // Camera rig always follows yaw/pitch (menus slowly drift for life).
    if (this.state === 'idle' || this.state === 'over') {
      this.yaw = damp(this.yaw, Math.sin(performance.now() * 0.00008) * 0.35, 2, dt);
      this.pitch = damp(this.pitch, -0.02, 2, dt);
    }

    // Recoil pitch kick recovery.
    this.kick = damp(this.kick, 0, 12, dt);

    this.shake.update(dt);
    this.shake.getOffset(this._shakeOut);
    this.yawObj.rotation.y = this.yaw + this._shakeOut.y;
    this.pitchObj.rotation.x = this.pitch + this.kick + this._shakeOut.x;
    this.pitchObj.rotation.z = this._shakeOut.z;

    this.weapon.update(dt, this._lookDX, this._lookDY);
    this._lookDX = 0;
    this._lookDY = 0;
    if (this.weapon.ammo !== this._lastAmmo) {
      this._lastAmmo = this.weapon.ammo;
      this.ui.setAmmo(this.weapon.ammo);
    }

    if (this.state === 'countdown') {
      this.countdownT += dt;
      if (this.countdownT >= 1) {
        this.countdownT = 0;
        this.countdownValue--;
        if (this.countdownValue > 0) {
          this.ui.setCountdown(String(this.countdownValue));
          audio.countdownBeep(false);
        } else {
          this.ui.setCountdown('GO!');
          audio.countdownBeep(true);
          this.state = 'playing';
          setTimeout(() => this.ui.hideCountdown(), 600);
        }
      }
      return;
    }

    if (this.state !== 'playing') return;

    this.manager.update(dt);

    this.timeLeft -= dt;
    this.ui.setTime(Math.max(0, this.timeLeft));
    if (this.timeLeft <= 0) this.endGame();
  }
}
