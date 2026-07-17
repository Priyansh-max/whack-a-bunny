// ---------------------------------------------------------------------------
// weapon.js — first-person view-model gun: procedural rifle, recoil spring,
// muzzle flash, reload animation, shell ejection, idle sway & breathing.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { rand, clamp, damp } from './utils.js';
import { audio } from './audio.js';

export const AMMO_PER_MAG = 8;
export const RELOAD_TIME = 1.5;

function muzzleFlashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  g.addColorStop(0, 'rgba(255, 250, 220, 1)');
  g.addColorStop(0.25, 'rgba(255, 200, 90, 0.9)');
  g.addColorStop(0.6, 'rgba(255, 130, 40, 0.35)');
  g.addColorStop(1, 'rgba(255, 100, 20, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  // Star spikes.
  ctx.strokeStyle = 'rgba(255, 230, 160, 0.9)';
  ctx.lineWidth = 5;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI + 0.4;
    ctx.beginPath();
    ctx.moveTo(64 - Math.cos(a) * 58, 64 - Math.sin(a) * 58);
    ctx.lineTo(64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58);
    ctx.stroke();
  }
  return new THREE.CanvasTexture(c);
}

export class Weapon {
  /** @param {THREE.PerspectiveCamera} camera */
  constructor(camera) {
    this.camera = camera;
    this.group = new THREE.Group();
    camera.add(this.group);

    this.ammo = AMMO_PER_MAG;
    this.reloading = false;
    this.reloadT = 0;
    this.cooldown = 0;
    this.recoil = 0;        // spring displacement
    this.recoilVel = 0;
    this.swayX = 0; this.swayY = 0;
    this.t = 0;
    this.enabled = true;

    this._build();
    this._buildFlash();
    this._buildShells();
  }

  _build() {
    const metal = new THREE.MeshStandardMaterial({ color: 0x3c3f46, roughness: 0.42, metalness: 0.55 });
    const metalDark = new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.5, metalness: 0.45 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5a38, roughness: 0.72, metalness: 0.05 });

    const gun = new THREE.Group();

    // Receiver.
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.1, 0.34), metal);
    gun.add(receiver);
    // Barrel jacket + barrel.
    const jacket = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.3, 12), metalDark);
    jacket.rotation.x = Math.PI / 2;
    jacket.position.set(0, 0.012, -0.3);
    gun.add(jacket);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.2, 10), metal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.012, -0.52);
    gun.add(barrel);
    // Muzzle.
    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.05, 10), metalDark);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, 0.012, -0.62);
    gun.add(muzzle);
    // Wooden stock + grip.
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.16), wood);
    stock.position.set(0, -0.045, 0.15);
    stock.rotation.x = 0.18;
    gun.add(stock);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.12, 0.06), wood);
    grip.position.set(0, -0.1, 0.06);
    grip.rotation.x = 0.35;
    gun.add(grip);
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.05, 0.16), wood);
    fore.position.set(0, -0.045, -0.24);
    gun.add(fore);
    // Magazine (animated during reload).
    this.magazine = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.13, 0.09), metalDark);
    this.magazine.position.set(0, -0.1, -0.02);
    this.magazine.rotation.x = 0.12;
    gun.add(this.magazine);
    // Trigger guard.
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 12, Math.PI), metalDark);
    guard.position.set(0, -0.075, 0.02);
    guard.rotation.z = Math.PI;
    gun.add(guard);
    // Iron sights.
    const rear = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.005, 6, 14), metalDark);
    rear.position.set(0, 0.075, 0.1);
    gun.add(rear);
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.035, 0.006), metalDark);
    front.position.set(0, 0.055, -0.6);
    gun.add(front);

    gun.traverse((o) => { o.frustumCulled = false; });
    gun.scale.setScalar(0.8);
    this.gun = gun;
    this.group.add(gun);

    // Resting pose.
    this.basePos = new THREE.Vector3(0.185, -0.165, -0.5);
    this.baseRot = new THREE.Euler(0, 0.04, 0);
    this.group.position.copy(this.basePos);
    this.group.rotation.copy(this.baseRot);
  }

  _buildFlash() {
    const tex = muzzleFlashTexture();
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.36, 0.36),
      new THREE.MeshBasicMaterial({
        map: tex, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, depthTest: false,
      })
    );
    this.flash.position.set(0, 0.012, -0.68);
    this.flash.visible = false;
    this.flash.renderOrder = 999;
    this.flash.frustumCulled = false;
    this.gun.add(this.flash);
    this.flashTime = 0;

    this.flashLight = new THREE.PointLight(0xffc060, 0, 7, 2);
    this.flashLight.position.set(0.1, -0.05, -0.8);
    this.camera.add(this.flashLight);
  }

  _buildShells() {
    this.shells = [];
    const geo = new THREE.BoxGeometry(0.012, 0.012, 0.03);
    const mat = new THREE.MeshStandardMaterial({ color: 0xc9a437, roughness: 0.3, metalness: 0.9 });
    for (let i = 0; i < 10; i++) {
      const shell = new THREE.Mesh(geo, mat);
      shell.visible = false;
      shell.frustumCulled = false;
      this.camera.add(shell);
      this.shells.push({ mesh: shell, vel: new THREE.Vector3(), rot: new THREE.Vector3(), life: 0 });
    }
  }

  _ejectShell() {
    const shell = this.shells.find((s) => !s.mesh.visible);
    if (!shell) return;
    shell.mesh.position.set(0.16, -0.12, -0.3);
    shell.mesh.rotation.set(0, 0, 0);
    shell.vel.set(rand(0.8, 1.4), rand(1.2, 1.9), rand(0.3, 0.7));
    shell.rot.set(rand(-12, 12), rand(-12, 12), rand(-12, 12));
    shell.life = 0.9;
    shell.mesh.visible = true;
  }

  /** World-space muzzle tip position (for tracers and smoke). */
  getMuzzleWorld(out) {
    return this.flash.getWorldPosition(out);
  }

  /** Attempt to fire. Returns true if a shot went off. */
  fire() {
    if (!this.enabled || this.reloading || this.cooldown > 0) return false;
    if (this.ammo <= 0) {
      audio.dryFire();
      this.reload();
      return false;
    }
    this.ammo--;
    this.cooldown = 0.14;
    this.recoilVel += 5.2;
    this.flash.visible = true;
    this.flash.rotation.z = Math.random() * Math.PI * 2;
    this.flash.scale.setScalar(rand(0.8, 1.25));
    this.flashTime = 0.055;
    this.flashLight.intensity = 14;
    this._ejectShell();
    audio.gunshot();
    if (this.ammo === 0) setTimeout(() => this.reload(), 260);
    return true;
  }

  reload() {
    if (this.reloading || this.ammo === AMMO_PER_MAG || !this.enabled) return;
    this.reloading = true;
    this.reloadT = 0;
    audio.reload();
  }

  /** lookDX/lookDY: raw mouse movement this frame (for sway). */
  update(dt, lookDX = 0, lookDY = 0) {
    this.t += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);

    // Recoil spring (critically damped-ish).
    const stiffness = 90, damping = 11;
    this.recoilVel -= (this.recoil * stiffness + this.recoilVel * damping) * dt;
    this.recoil += this.recoilVel * dt;

    // Aim sway lags behind mouse movement.
    this.swayX = damp(this.swayX, clamp(-lookDX * 0.0011, -0.03, 0.03), 9, dt);
    this.swayY = damp(this.swayY, clamp(lookDY * 0.0011, -0.02, 0.02), 9, dt);

    // Breathing idle.
    const breathe = Math.sin(this.t * 1.7) * 0.0016;
    const breatheR = Math.sin(this.t * 1.1) * 0.0022;

    // Muzzle flash decay.
    if (this.flash.visible) {
      this.flashTime -= dt;
      if (this.flashTime <= 0) this.flash.visible = false;
    }
    this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 180);

    // Compose pose.
    const p = this.group.position;
    p.copy(this.basePos);
    p.x += this.swayX;
    p.y += this.swayY + breathe;
    p.z += this.recoil * 0.05;

    const r = this.group.rotation;
    r.copy(this.baseRot);
    r.x += this.recoil * 0.16 + breatheR + this.swayY * 1.4;
    r.y += this.swayX * 1.8;
    r.z += this.swayX * 0.6;

    // Reload animation: dip, roll, mag out/in, rise.
    if (this.reloading) {
      this.reloadT += dt;
      const k = clamp(this.reloadT / RELOAD_TIME, 0, 1);
      const dip = Math.sin(Math.min(k * 1.25, 1) * Math.PI);
      r.x -= dip * 0.55;
      r.z += dip * 0.5;
      p.y -= dip * 0.06;
      // Magazine: out around 30%, in around 65%.
      const magOut = k > 0.18 && k < 0.62 ? Math.sin(((k - 0.18) / 0.44) * Math.PI) : 0;
      this.magazine.position.y = -0.1 - magOut * 0.16;
      if (k >= 1) {
        this.reloading = false;
        this.ammo = AMMO_PER_MAG;
        this.magazine.position.y = -0.1;
      }
    }

    // Shells fly & fade.
    for (const shell of this.shells) {
      if (!shell.mesh.visible) continue;
      shell.life -= dt;
      shell.vel.y -= 9.8 * dt;
      shell.mesh.position.addScaledVector(shell.vel, dt);
      shell.mesh.rotation.x += shell.rot.x * dt;
      shell.mesh.rotation.y += shell.rot.y * dt;
      shell.mesh.rotation.z += shell.rot.z * dt;
      if (shell.life <= 0) shell.mesh.visible = false;
    }
  }

  reset() {
    this.ammo = AMMO_PER_MAG;
    this.reloading = false;
    this.recoil = 0;
    this.recoilVel = 0;
    this.cooldown = 0;
  }
}
