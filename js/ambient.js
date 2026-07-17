// ---------------------------------------------------------------------------
// ambient.js — living-world systems: falling leaves, birds, butterflies,
// floating dust/pollen, light rays, wind gusts and occasional light rain.
// Everything is pooled; an event scheduler fires these at random intervals.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { rand, randInt, pick, clamp, tween, Ease } from './utils.js';
import { audio } from './audio.js';

function softCircleTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

export class AmbientFX {
  constructor(scene, env) {
    this.scene = scene;
    this.env = env;
    this.t = 0;
    this.enabled = true; // game can pause events if desired
    this._nextEvent = rand(5, 9);
    this._rainCooldown = 30;
    this._rainTimer = 0;
    this._leafTimer = 0.5;

    this._buildLeaves();
    this._buildBirds();
    this._buildButterflies();
    this._buildDust();
    this._buildRain();
    this._buildLightRays();
  }

  // --------------------------------------------------------------- leaves --
  _buildLeaves() {
    this.leaves = [];
    const geo = new THREE.PlaneGeometry(0.14, 0.18);
    const colors = [0x7ba53f, 0xa8b84a, 0xd8a24a, 0x6b9a3a, 0xc98f3d];
    for (let i = 0; i < 36; i++) {
      const mat = new THREE.MeshLambertMaterial({
        color: pick(colors), side: THREE.DoubleSide, transparent: true,
      });
      const leaf = new THREE.Mesh(geo, mat);
      leaf.visible = false;
      this.scene.add(leaf);
      this.leaves.push({ mesh: leaf, active: false, vel: new THREE.Vector3(), life: 0, spin: rand(1, 4) });
    }
  }

  _spawnLeafBurst(count) {
    let spawned = 0;
    for (const leaf of this.leaves) {
      if (leaf.active) continue;
      const canopy = pick(this.env.canopies);
      leaf.mesh.position.copy(canopy).add(new THREE.Vector3(rand(-1.6, 1.6), rand(-0.5, 0.8), rand(-1.6, 1.6)));
      leaf.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      leaf.mesh.material.opacity = 1;
      leaf.mesh.visible = true;
      leaf.vel.set(rand(-0.2, 0.2), rand(-0.55, -0.35), rand(-0.2, 0.2));
      leaf.life = rand(5, 9);
      leaf.active = true;
      if (++spawned >= count) break;
    }
  }

  // ---------------------------------------------------------------- birds --
  _buildBirds() {
    this.birds = [];
    const mat = new THREE.MeshBasicMaterial({ color: 0x2c2c34, side: THREE.DoubleSide, fog: false });
    const wingGeo = new THREE.PlaneGeometry(0.55, 0.22);
    wingGeo.translate(0.27, 0, 0); // hinge at body
    for (let i = 0; i < 4; i++) {
      const bird = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.42, 5), mat);
      body.rotation.x = Math.PI / 2;
      bird.add(body);
      const left = new THREE.Mesh(wingGeo, mat);
      const right = new THREE.Mesh(wingGeo, mat);
      right.rotation.z = Math.PI;
      bird.add(left, right);
      bird.visible = false;
      this.scene.add(bird);
      this.birds.push({ group: bird, left, right, active: false, t: 0, dur: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), flap: rand(6, 9) });
    }
  }

  _spawnBirds() {
    const count = randInt(1, 3);
    let spawned = 0;
    for (const bird of this.birds) {
      if (bird.active) continue;
      const y = rand(14, 26);
      const z = rand(-70, -20);
      const fromLeft = Math.random() < 0.5;
      bird.from.set(fromLeft ? -90 : 90, y + rand(-2, 2), z + rand(-8, 8));
      bird.to.set(fromLeft ? 90 : -90, y + rand(-2, 2), z + rand(-8, 8));
      bird.t = 0;
      bird.dur = rand(14, 22);
      bird.active = true;
      bird.group.visible = true;
      if (++spawned >= count) break;
    }
  }

  // ----------------------------------------------------------- butterflies --
  _buildButterflies() {
    this.butterflies = [];
    const wingGeo = new THREE.PlaneGeometry(0.09, 0.12);
    wingGeo.translate(0.045, 0, 0);
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: pick([0xffb347, 0xfff1a8, 0xe8a2ff, 0xffffff]),
        side: THREE.DoubleSide,
      });
      const b = new THREE.Group();
      const l = new THREE.Mesh(wingGeo, mat);
      const r = new THREE.Mesh(wingGeo, mat);
      r.rotation.z = Math.PI;
      b.add(l, r);
      b.userData.center = new THREE.Vector3(rand(-14, 14), 0, rand(-22, -5));
      this.scene.add(b);
      this.butterflies.push({ group: b, l, r, phase: rand(0, 9), speed: rand(0.5, 0.9) });
    }
  }

  // ------------------------------------------------------------------ dust --
  _buildDust() {
    const COUNT = 220;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(COUNT * 3);
    this.dustSeeds = new Float32Array(COUNT * 2);
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = rand(-22, 22);
      pos[i * 3 + 1] = rand(0.3, 7);
      pos[i * 3 + 2] = rand(-30, 8);
      this.dustSeeds[i * 2] = rand(0, 9);
      this.dustSeeds[i * 2 + 1] = rand(0.2, 1);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dustMat = new THREE.PointsMaterial({
      size: 0.05,
      map: softCircleTexture(),
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: 0xfff6d8,
      sizeAttenuation: true,
    });
    this.dust = new THREE.Points(geo, this.dustMat);
    this.scene.add(this.dust);
  }

  // ------------------------------------------------------------------ rain --
  _buildRain() {
    const COUNT = 900;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = rand(-25, 25);
      pos[i * 3 + 1] = rand(0, 20);
      pos[i * 3 + 2] = rand(-32, 10);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    // Streak texture.
    const c = document.createElement('canvas');
    c.width = 8; c.height = 32;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 32);
    g.addColorStop(0, 'rgba(190,210,235,0)');
    g.addColorStop(0.5, 'rgba(190,210,235,0.85)');
    g.addColorStop(1, 'rgba(190,210,235,0)');
    ctx.fillStyle = g;
    ctx.fillRect(2, 0, 4, 32);
    this.rainMat = new THREE.PointsMaterial({
      size: 0.35,
      map: new THREE.CanvasTexture(c),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.rain = new THREE.Points(geo, this.rainMat);
    this.rain.visible = false;
    this.scene.add(this.rain);
  }

  _setRain(on) {
    if (on) {
      this.rain.visible = true;
      this._rainTimer = rand(7, 12);
      audio.setRain(true);
      tween({
        duration: 1.2,
        onUpdate: (k) => {
          this.rainMat.opacity = k * 0.55;
          this.env.scene.fog.far = 240 - k * 70;
        },
      });
    } else {
      audio.setRain(false);
      tween({
        duration: 1.5,
        onUpdate: (k) => {
          this.rainMat.opacity = (1 - k) * 0.55;
          this.env.scene.fog.far = 170 + k * 70;
        },
        onComplete: () => { this.rain.visible = false; },
      });
    }
  }

  // ------------------------------------------------------------ light rays --
  _buildLightRays() {
    this.rays = [];
    const c = document.createElement('canvas');
    c.width = 64; c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, 'rgba(255,244,200,0.75)');
    g.addColorStop(1, 'rgba(255,244,200,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 256);
    // Soft horizontal falloff.
    const img = ctx.getImageData(0, 0, 64, 256);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 64; x++) {
        const falloff = 1 - Math.abs(x - 32) / 32;
        img.data[(y * 64 + x) * 4 + 3] *= falloff * falloff;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    const geo = new THREE.PlaneGeometry(1.6, 14);
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide, fog: false,
      });
      const ray = new THREE.Mesh(geo, mat);
      ray.visible = false;
      this.scene.add(ray);
      this.rays.push(ray);
    }
  }

  _spawnLightRays() {
    for (const ray of this.rays) {
      const canopy = pick(this.env.canopies);
      ray.position.set(canopy.x + rand(-2, 2), 5.5, canopy.z + rand(-2, 2));
      ray.rotation.z = 0.5; // slant with the sun
      ray.rotation.y = rand(-0.6, 0.6);
      ray.visible = true;
      tween({
        duration: rand(6, 9),
        ease: Ease.inOutQuad,
        onUpdate: (k) => { ray.material.opacity = Math.sin(k * Math.PI) * 0.22; },
        onComplete: () => { ray.visible = false; },
      });
    }
  }

  // ------------------------------------------------------------- wind gust --
  _gust() {
    const u = this.env.uniforms.uWind;
    tween({
      duration: 3.2,
      ease: Ease.inOutQuad,
      onUpdate: (k) => { u.value = 1 + Math.sin(k * Math.PI) * 1.6; },
    });
    this._spawnLeafBurst(randInt(6, 12));
  }

  _pollenBurst() {
    tween({
      duration: 8,
      ease: Ease.inOutQuad,
      onUpdate: (k) => { this.dustMat.opacity = 0.35 + Math.sin(k * Math.PI) * 0.4; },
    });
  }

  // ------------------------------------------------------------- scheduler --
  _fireRandomEvent() {
    const events = [
      { w: 3, fn: () => this._spawnLeafBurst(randInt(4, 9)) },
      { w: 3, fn: () => this._spawnBirds() },
      { w: 2, fn: () => this._gust() },
      { w: 2, fn: () => this._pollenBurst() },
      { w: 2, fn: () => this._spawnLightRays() },
    ];
    if (this._rainCooldown <= 0 && this._rainTimer <= 0) {
      events.push({ w: 1.4, fn: () => { this._setRain(true); this._rainCooldown = rand(45, 75); } });
    }
    const total = events.reduce((s, e) => s + e.w, 0);
    let roll = Math.random() * total;
    for (const e of events) {
      roll -= e.w;
      if (roll <= 0) { e.fn(); return; }
    }
  }

  // ---------------------------------------------------------------- update --
  update(dt) {
    if (!this.enabled) return;
    this.t += dt;
    const t = this.t;

    this._nextEvent -= dt;
    if (this._nextEvent <= 0) {
      this._nextEvent = rand(7, 14);
      this._fireRandomEvent();
    }
    this._rainCooldown -= dt;
    if (this._rainTimer > 0) {
      this._rainTimer -= dt;
      if (this._rainTimer <= 0) this._setRain(false);
    }

    // Trickle of leaves near trees.
    this._leafTimer -= dt;
    if (this._leafTimer <= 0) {
      this._leafTimer = rand(0.6, 1.6);
      this._spawnLeafBurst(randInt(1, 2));
    }

    const wind = this.env.uniforms.uWind.value;

    // Leaves flutter down.
    for (const leaf of this.leaves) {
      if (!leaf.active) continue;
      leaf.life -= dt;
      const m = leaf.mesh;
      m.position.addScaledVector(leaf.vel, dt);
      m.position.x += Math.sin(t * 2.2 + leaf.spin * 4) * dt * (0.5 + wind * 0.45);
      m.position.z += Math.cos(t * 1.8 + leaf.spin * 3) * dt * 0.4;
      m.rotation.x += dt * leaf.spin;
      m.rotation.z += dt * leaf.spin * 0.7;
      if (m.position.y < 0.03) {
        m.position.y = 0.03;
        leaf.vel.set(0, 0, 0);
        m.material.opacity -= dt * 0.6;
      }
      if (leaf.life <= 0 || m.material.opacity <= 0.02) {
        leaf.active = false;
        m.visible = false;
      }
    }

    // Birds cross the sky.
    for (const bird of this.birds) {
      if (!bird.active) continue;
      bird.t += dt;
      const k = clamp(bird.t / bird.dur, 0, 1);
      bird.group.position.lerpVectors(bird.from, bird.to, k);
      bird.group.position.y += Math.sin(k * Math.PI * 3) * 0.8;
      bird.group.lookAt(bird.to);
      const flap = Math.sin(t * bird.flap * 2) * 0.75;
      bird.left.rotation.y = 0;
      bird.left.rotation.z = flap;
      bird.right.rotation.z = Math.PI - flap;
      if (k >= 1) { bird.active = false; bird.group.visible = false; }
    }

    // Butterflies wander.
    for (const b of this.butterflies) {
      const c = b.group.userData.center;
      const p = b.phase + t * b.speed;
      b.group.position.set(
        c.x + Math.sin(p * 0.9) * 2.4 + Math.sin(p * 2.3) * 0.5,
        0.7 + Math.sin(p * 1.7) * 0.35 + 0.3,
        c.z + Math.cos(p * 0.7) * 2.4
      );
      b.group.rotation.y = Math.atan2(
        Math.cos(p * 0.9) * 2.4 * 0.9, -Math.sin(p * 0.7) * 2.4 * 0.7
      );
      const flap = Math.sin(t * 16 + b.phase) * 1.05;
      b.l.rotation.z = flap;
      b.r.rotation.z = Math.PI - flap;
    }

    // Dust drifts.
    {
      const pos = this.dust.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const s0 = this.dustSeeds[i * 2], s1 = this.dustSeeds[i * 2 + 1];
        let y = pos.getY(i) + Math.sin(t * 0.4 + s0) * dt * 0.12;
        let x = pos.getX(i) + (0.14 * wind * s1) * dt;
        if (x > 23) x = -23;
        if (y < 0.2) y = 7; else if (y > 7.2) y = 0.3;
        pos.setXYZ(i, x, y, pos.getZ(i));
      }
      pos.needsUpdate = true;
    }

    // Rain falls.
    if (this.rain.visible) {
      const pos = this.rain.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) - dt * 16;
        if (y < 0) y = 20;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
    }
  }
}
