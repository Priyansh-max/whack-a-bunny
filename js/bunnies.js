// ---------------------------------------------------------------------------
// bunnies.js — procedural bunny models, holes, the pop-up state machine and
// the spawn manager that drives difficulty-based pacing.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { rand, pick, clamp, Ease } from './utils.js';
import { BUNNY } from './config.js';
import { audio } from './audio.js';

const FUR_COLORS = [0xf2ede2, 0xb9b2a8, 0x8a6b4f, 0x6e6a66, 0xd9c8a9];

function makeBunnyModel() {
  const fur = new THREE.MeshLambertMaterial({ color: pick(FUR_COLORS) });
  const furDark = new THREE.MeshLambertMaterial({ color: 0x5a4a3a });
  const pink = new THREE.MeshLambertMaterial({ color: 0xe8a0a8 });
  const black = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  const white = new THREE.MeshLambertMaterial({ color: 0xffffff });

  const bunny = new THREE.Group();
  const headGroup = new THREE.Group();
  bunny.add(headGroup);

  // Head.
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 16), fur);
  head.scale.set(1, 1.08, 0.95);
  head.position.y = 0.62;
  head.castShadow = true;
  headGroup.add(head);

  // Muzzle + nose.
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), fur);
  muzzle.position.set(0, 0.52, 0.24);
  muzzle.scale.set(1, 0.8, 0.9);
  headGroup.add(muzzle);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), pink);
  nose.position.set(0, 0.585, 0.37);
  headGroup.add(nose);

  // Buck teeth.
  const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.02), white);
  teeth.position.set(0, 0.47, 0.36);
  headGroup.add(teeth);

  // Eyes with glint.
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.048, 10, 10), black);
    eye.position.set(side * 0.14, 0.68, 0.24);
    headGroup.add(eye);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 6), white);
    glint.position.set(side * 0.125, 0.695, 0.28);
    headGroup.add(glint);
  }

  // Ears — separate pivots at the base so they can twitch/flop.
  const ears = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.12, 0.88, -0.02);
    const outer = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 12), fur);
    outer.scale.set(0.85, 2.9, 0.42);
    outer.position.y = 0.26;
    outer.castShadow = true;
    pivot.add(outer);
    const inner = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 10), pink);
    inner.scale.set(0.7, 2.4, 0.3);
    inner.position.set(0, 0.26, 0.035);
    pivot.add(inner);
    pivot.rotation.z = side * -0.16;
    headGroup.add(pivot);
    ears.push(pivot);
  }

  // Chest + front paws resting on the mound.
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12), fur);
  chest.position.y = 0.22;
  chest.scale.set(0.9, 1.05, 0.85);
  bunny.add(chest);
  for (const side of [-1, 1]) {
    const paw = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 8), furDark);
    paw.position.set(side * 0.14, 0.06, 0.26);
    paw.scale.set(0.8, 0.6, 1.3);
    bunny.add(paw);
  }

  return { bunny, headGroup, ears, mats: [fur, furDark, pink] };
}

function makeHole() {
  const group = new THREE.Group();
  // Dirt mound ring.
  const mound = new THREE.Mesh(
    new THREE.TorusGeometry(0.55, 0.2, 10, 20),
    new THREE.MeshLambertMaterial({ color: 0x5d4630 })
  );
  mound.rotation.x = -Math.PI / 2;
  mound.position.y = 0.06;
  mound.scale.set(1, 1, 0.62);
  mound.receiveShadow = true;
  group.add(mound);
  // Dark hole interior.
  const hole = new THREE.Mesh(
    new THREE.CircleGeometry(0.52, 20),
    new THREE.MeshBasicMaterial({ color: 0x120c06 })
  );
  hole.rotation.x = -Math.PI / 2;
  hole.position.y = 0.045;
  group.add(hole);
  return group;
}

// ---------------------------------------------------------------------------
// One bunny tied to one hole. States: hidden → rising → visible → hiding.
// Fake pop-ups only rise partway, cannot be hit and duck quickly.
// ---------------------------------------------------------------------------
const HIDDEN_Y = -1.25;

export class Bunny {
  constructor(scene, position) {
    this.root = new THREE.Group();
    this.root.position.copy(position);
    scene.add(this.root);

    this.root.add(makeHole());

    const { bunny, headGroup, ears, mats } = makeBunnyModel();
    this.model = bunny;
    this.headGroup = headGroup;
    this.ears = ears;
    this.mats = mats;
    this.model.position.y = HIDDEN_Y;
    this.model.visible = false;
    this.root.add(this.model);

    // Invisible hit sphere, scaled by difficulty at spawn time.
    this.hitMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.46, 10, 10),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    this.hitMesh.position.y = 0.55;
    this.hitMesh.userData.bunny = this;
    this.model.add(this.hitMesh);

    this.state = 'hidden';
    this.stateT = 0;
    this.visibleFor = 0;
    this.isFake = false;
    this.popHeight = 1;
    this.lookTarget = new THREE.Vector2(0, 0);
    this.lookTimer = 0;
    this.earTimer = rand(0.4, 1.4);
    this.earTwitch = [0, 0];
    this.dead = false;
  }

  get isHittable() {
    return !this.dead && !this.isFake && (this.state === 'visible' || this.state === 'rising');
  }

  popUp(visibleFor, fake) {
    if (this.state !== 'hidden') return false;
    this.state = 'rising';
    this.stateT = 0;
    this.visibleFor = visibleFor;
    this.isFake = fake;
    this.dead = false;
    this.popHeight = fake ? BUNNY.fakeHeight : 1;
    this.model.visible = true;
    this.model.rotation.set(0, rand(-0.4, 0.4), 0);
    this.model.scale.setScalar(1);
    audio.bunnyPop();
    if (fake) audio.squeak(true);
    return true;
  }

  hit() {
    if (!this.isHittable) return false;
    this.state = 'dying';
    this.stateT = 0;
    this.dead = true;
    // Stylized red flash.
    for (const m of this.mats) {
      m.userData.origColor = m.userData.origColor || m.color.getHex();
      m.color.setHex(0xd0352c);
      m.emissive = m.emissive || new THREE.Color();
      m.emissive.setHex(0x5a0d08);
    }
    audio.bunnyDeath();
    return true;
  }

  _restoreColors() {
    for (const m of this.mats) {
      if (m.userData.origColor !== undefined) m.color.setHex(m.userData.origColor);
      if (m.emissive) m.emissive.setHex(0x000000);
    }
  }

  update(dt) {
    if (this.state === 'hidden') return;
    this.stateT += dt;

    // Ear twitch timer runs in every up-state.
    this.earTimer -= dt;
    if (this.earTimer <= 0) {
      this.earTimer = rand(0.5, 1.8);
      this.earTwitch[Math.random() < 0.5 ? 0 : 1] = 1;
    }
    for (let i = 0; i < 2; i++) {
      if (this.earTwitch[i] > 0) {
        this.earTwitch[i] = Math.max(0, this.earTwitch[i] - dt * 6);
        const w = Math.sin(this.earTwitch[i] * Math.PI * 4) * this.earTwitch[i];
        this.ears[i].rotation.x = w * 0.45;
        this.ears[i].rotation.z = (i === 0 ? 1 : -1) * 0.16 + w * 0.2 * (i === 0 ? 1 : -1);
      } else {
        this.ears[i].rotation.x *= 0.9;
      }
    }

    switch (this.state) {
      case 'rising': {
        const k = clamp(this.stateT / BUNNY.riseTime, 0, 1);
        this.model.position.y = HIDDEN_Y + (0 - HIDDEN_Y) * Ease.outBack(k) * this.popHeight;
        if (k >= 1) {
          this.state = 'visible';
          this.stateT = 0;
        }
        break;
      }
      case 'visible': {
        // Idle bob.
        const baseY = (0 - HIDDEN_Y) * this.popHeight + HIDDEN_Y;
        this.model.position.y = baseY + Math.sin(this.stateT * 3.1) * 0.02;
        // Look around: pick new gaze targets at random.
        this.lookTimer -= dt;
        if (this.lookTimer <= 0) {
          this.lookTimer = rand(0.5, 1.3);
          this.lookTarget.set(rand(-0.55, 0.55), rand(-0.2, 0.22));
        }
        this.headGroup.rotation.y += (this.lookTarget.x - this.headGroup.rotation.y) * Math.min(1, dt * 7);
        this.headGroup.rotation.x += (this.lookTarget.y - this.headGroup.rotation.x) * Math.min(1, dt * 7);
        if (this.stateT >= this.visibleFor) {
          this.state = 'hiding';
          this.stateT = 0;
        }
        break;
      }
      case 'hiding': {
        const k = clamp(this.stateT / BUNNY.hideTime, 0, 1);
        const top = HIDDEN_Y + (0 - HIDDEN_Y) * this.popHeight;
        this.model.position.y = top + (HIDDEN_Y - top) * Ease.inCubic(k);
        if (k >= 1) this._bury();
        break;
      }
      case 'dying': {
        const k = clamp(this.stateT / BUNNY.deathTime, 0, 1);
        // Wobble, spin and drop back into the hole.
        this.model.rotation.y += dt * (14 * (1 - k));
        this.model.rotation.z = Math.sin(k * Math.PI) * 0.7;
        this.model.position.y = HIDDEN_Y + (0 - HIDDEN_Y) * (1 - Ease.inCubic(k));
        this.model.scale.setScalar(1 - k * 0.25);
        if (k >= 1) this._bury();
        break;
      }
    }
  }

  _bury() {
    this.state = 'hidden';
    this.model.visible = false;
    this.model.position.y = HIDDEN_Y;
    this.model.rotation.z = 0;
    this.isFake = false;
    this._restoreColors();
  }

  forceHide() {
    if (this.state === 'hidden' || this.state === 'dying') return;
    this.state = 'hiding';
    this.stateT = 0;
  }

  reset() {
    this._bury();
    this.dead = false;
  }
}

// ---------------------------------------------------------------------------
// Spawn manager — randomized pacing, no predictable patterns.
// ---------------------------------------------------------------------------
export class BunnyManager {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3[]} holePositions
   */
  constructor(scene, holePositions) {
    this.bunnies = holePositions.map((p) => new Bunny(scene, p));
    this.difficulty = null;
    this.spawnTimer = 1;
    this.lastHole = -1;
    this.active = false;
    this.onBunnyHit = null; // (bunny) => void
  }

  start(difficulty) {
    this.difficulty = difficulty;
    this.active = true;
    this.spawnTimer = 0.6;
    this.lastHole = -1;
    for (const b of this.bunnies) {
      b.reset();
      b.hitMesh.scale.setScalar(difficulty.hitboxScale);
    }
  }

  stop() {
    this.active = false;
    for (const b of this.bunnies) b.forceHide();
  }

  get activeCount() {
    return this.bunnies.filter((b) => b.state === 'rising' || b.state === 'visible').length;
  }

  /** Hit-spheres of bunnies that can currently be shot. */
  hitTargets() {
    const out = [];
    for (const b of this.bunnies) if (b.isHittable) out.push(b.hitMesh);
    return out;
  }

  update(dt) {
    for (const b of this.bunnies) b.update(dt);
    if (!this.active || !this.difficulty) return;

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      const [minI, maxI] = this.difficulty.spawnInterval;
      this.spawnTimer = rand(minI, maxI);
      if (this.activeCount < this.difficulty.maxConcurrent) {
        // Random hole, never the same twice in a row, never one that's up.
        const candidates = this.bunnies
          .map((b, i) => ({ b, i }))
          .filter(({ b, i }) => b.state === 'hidden' && i !== this.lastHole);
        if (candidates.length) {
          const { b, i } = pick(candidates);
          this.lastHole = i;
          const [minV, maxV] = this.difficulty.visibleTime;
          const fake = Math.random() < this.difficulty.fakeChance;
          const visible = fake ? rand(...BUNNY.fakeVisibleTime) : rand(minV, maxV);
          b.popUp(visible, fake);
        }
      }
    }
  }
}
