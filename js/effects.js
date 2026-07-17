// ---------------------------------------------------------------------------
// effects.js — pooled particle system (blood, dirt, wood chips), decal pool
// (bullet holes, blood splats) and trauma-based camera shake.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { rand, pick, clamp } from './utils.js';

const MAX_PARTICLES = 1200;

export class ParticleSystem {
  constructor(scene) {
    this.count = MAX_PARTICLES;
    // CPU-side state.
    this.pos = new Float32Array(this.count * 3);
    this.vel = new Float32Array(this.count * 3);
    this.col = new Float32Array(this.count * 3);
    this.size = new Float32Array(this.count);
    this.alpha = new Float32Array(this.count);
    this.life = new Float32Array(this.count);     // remaining
    this.maxLife = new Float32Array(this.count);
    this.grav = new Float32Array(this.count);
    this.baseAlpha = new Float32Array(this.count);
    this.cursor = 0;
    this.activeCount = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    // Park everything far underground initially.
    for (let i = 0; i < this.count; i++) this.pos[i * 3 + 1] = -1000;

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {},
      vertexShader: /* glsl */`
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (280.0 / max(-mv.z, 0.1));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          float mask = smoothstep(0.5, 0.32, d);
          if (mask * vAlpha < 0.01) discard;
          gl_FragColor = vec4(vColor, vAlpha * mask);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  /**
   * Spawn a burst.
   * opts: position, count, colors [THREE.Color|hex], speed [min,max], spread
   * (0..1 cone vs sphere), direction, size [min,max], lifeTime [min,max],
   * gravity, alpha
   */
  spawn(opts) {
    const {
      position, count = 10, colors = [0xffffff], speed = [1, 3], spread = 1,
      direction = null, size = [0.05, 0.12], lifeTime = [0.4, 0.8],
      gravity = 6, alpha = 1,
    } = opts;
    const c = new THREE.Color();
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.count;
      this.pos[i * 3] = position.x;
      this.pos[i * 3 + 1] = position.y;
      this.pos[i * 3 + 2] = position.z;
      // Random direction in a sphere, optionally biased along `direction`.
      let dx = rand(-1, 1), dy = rand(-1, 1), dz = rand(-1, 1);
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len; dy /= len; dz /= len;
      if (direction) {
        dx = dx * spread + direction.x * (1 - spread);
        dy = dy * spread + direction.y * (1 - spread);
        dz = dz * spread + direction.z * (1 - spread);
      }
      const s = rand(speed[0], speed[1]);
      this.vel[i * 3] = dx * s;
      this.vel[i * 3 + 1] = dy * s;
      this.vel[i * 3 + 2] = dz * s;
      c.set(pick(colors));
      this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
      this.size[i] = rand(size[0], size[1]);
      this.maxLife[i] = this.life[i] = rand(lifeTime[0], lifeTime[1]);
      this.grav[i] = gravity;
      this.baseAlpha[i] = alpha;
      this.alpha[i] = alpha;
    }
  }

  update(dt) {
    const posA = this.points.geometry.attributes.position;
    let any = false;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -1000;
        this.alpha[i] = 0;
        continue;
      }
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      // Floor: stop at ground level.
      if (this.pos[i * 3 + 1] < 0.015) {
        this.pos[i * 3 + 1] = 0.015;
        this.vel[i * 3] *= 0.6; this.vel[i * 3 + 1] = 0; this.vel[i * 3 + 2] *= 0.6;
      }
      const k = this.life[i] / this.maxLife[i];
      this.alpha[i] = this.baseAlpha[i] * Math.min(1, k * 2.5);
    }
    if (any) {
      posA.needsUpdate = true;
      this.points.geometry.attributes.aAlpha.needsUpdate = true;
      this.points.geometry.attributes.aColor.needsUpdate = true;
      this.points.geometry.attributes.aSize.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------- presets --
  blood(position, direction) {
    this.spawn({
      position, count: 22,
      colors: [0x8a1616, 0xa31d1d, 0x6e0f0f, 0xc42b2b],
      speed: [1.2, 4.2], spread: 0.55, direction,
      size: [0.06, 0.16], lifeTime: [0.35, 0.8], gravity: 9,
    });
  }

  dirt(position, direction) {
    this.spawn({
      position, count: 14,
      colors: [0x6b5233, 0x8a6c44, 0x54402a],
      speed: [0.8, 3], spread: 0.5, direction,
      size: [0.05, 0.13], lifeTime: [0.3, 0.7], gravity: 8,
    });
    // A couple of lazy dust motes.
    this.spawn({
      position, count: 5, colors: [0xb9a685],
      speed: [0.2, 0.7], spread: 1,
      size: [0.14, 0.3], lifeTime: [0.6, 1.1], gravity: 0.4, alpha: 0.4,
    });
  }

  wood(position, direction) {
    this.spawn({
      position, count: 12,
      colors: [0x9a7a4e, 0x7a5c38, 0xc0a068],
      speed: [1.5, 4], spread: 0.45, direction,
      size: [0.03, 0.08], lifeTime: [0.25, 0.6], gravity: 10,
    });
  }

  rock(position, direction) {
    this.spawn({
      position, count: 8,
      colors: [0xb0b0b4, 0x8d8d90],
      speed: [1.5, 3.6], spread: 0.5, direction,
      size: [0.02, 0.06], lifeTime: [0.2, 0.5], gravity: 9,
    });
    this.spawn({
      position, count: 4, colors: [0xfff2c0],
      speed: [2, 5], spread: 0.6, direction,
      size: [0.02, 0.04], lifeTime: [0.1, 0.25], gravity: 4,
    });
  }

  muzzleSmoke(position) {
    this.spawn({
      position, count: 3,
      colors: [0x9a9a98, 0x7d7d7b],
      speed: [0.15, 0.5], spread: 1,
      size: [0.08, 0.2], lifeTime: [0.5, 0.95],
      gravity: -1.2, alpha: 0.22,
    });
  }
}

// ---------------------------------------------------------------------------
// Tracers — brief glowing streaks from muzzle to impact point.
// ---------------------------------------------------------------------------
export class TracerPool {
  constructor(scene) {
    this.tracers = [];
    const geo = new THREE.CylinderGeometry(0.007, 0.007, 1, 5, 1, true);
    geo.rotateX(Math.PI / 2); // align along +Z so lookAt() points it correctly
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffe2a0, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.tracers.push({ mesh, life: 0, maxLife: 0 });
    }
  }

  spawn(from, to) {
    const t = this.tracers.find((x) => !x.mesh.visible) || this.tracers[0];
    const dist = from.distanceTo(to);
    if (dist < 0.5) return;
    t.mesh.position.copy(from);
    t.mesh.lookAt(to);
    t.mesh.scale.set(1, 1, dist);
    t.mesh.material.opacity = 0.85;
    t.mesh.visible = true;
    t.life = t.maxLife = 0.08;
  }

  update(dt) {
    for (const t of this.tracers) {
      if (!t.mesh.visible) continue;
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, (t.life / t.maxLife)) * 0.85;
      if (t.life <= 0) t.mesh.visible = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Decals — pooled flat quads stuck to surfaces (bullet holes, blood splats).
// ---------------------------------------------------------------------------
function bulletHoleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
  g.addColorStop(0, 'rgba(10, 8, 6, 0.95)');
  g.addColorStop(0.35, 'rgba(15, 12, 9, 0.8)');
  g.addColorStop(1, 'rgba(15, 12, 9, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function bloodSplatTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(122, 16, 16, 0.92)';
  // Central blob + radiating droplets.
  ctx.beginPath();
  ctx.ellipse(64, 64, 22, 18, Math.random(), 0, 7);
  ctx.fill();
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = rand(16, 52);
    const r = rand(2, 7);
    ctx.beginPath();
    ctx.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, r, 0, 7);
    ctx.fill();
  }
  return new THREE.CanvasTexture(c);
}

export class DecalPool {
  constructor(scene) {
    this.decals = [];
    const holeTex = bulletHoleTexture();
    const splatTex = bloodSplatTexture();
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 28; i++) {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 2;
      scene.add(mesh);
      this.decals.push({ mesh, life: 0, maxLife: 0 });
    }
    this.textures = { hole: holeTex, splat: splatTex };
  }

  /** type: 'hole' | 'splat'. normal: THREE.Vector3 surface normal. */
  place(position, normal, type, scale = 1) {
    // Reuse the oldest slot.
    let slot = this.decals.find((d) => !d.mesh.visible);
    if (!slot) {
      slot = this.decals.reduce((a, b) => (a.life < b.life ? a : b));
    }
    const { mesh } = slot;
    mesh.material.map = this.textures[type];
    mesh.material.needsUpdate = true;
    mesh.material.opacity = 1;
    mesh.position.copy(position).addScaledVector(normal, 0.012);
    mesh.lookAt(position.clone().add(normal));
    mesh.rotateZ(Math.random() * Math.PI * 2);
    mesh.scale.setScalar((type === 'splat' ? rand(0.5, 0.85) : rand(0.1, 0.16)) * scale);
    mesh.visible = true;
    slot.life = slot.maxLife = 10;
  }

  update(dt) {
    for (const d of this.decals) {
      if (!d.mesh.visible) continue;
      d.life -= dt;
      if (d.life < 2.5) d.mesh.material.opacity = clamp(d.life / 2.5, 0, 1);
      if (d.life <= 0) d.mesh.visible = false;
    }
  }

  clear() {
    for (const d of this.decals) d.mesh.visible = false;
  }
}

// ---------------------------------------------------------------------------
// Camera shake — trauma model: shake amplitude = trauma^2, decays over time.
// ---------------------------------------------------------------------------
export class CameraShake {
  constructor() {
    this.trauma = 0;
    this.t = 0;
  }

  add(amount) {
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }

  update(dt) {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
  }

  /** Writes rotation offsets (radians) into out {x, y, z}. */
  getOffset(out) {
    const s = this.trauma * this.trauma;
    const t = this.t;
    out.x = s * 0.035 * (Math.sin(t * 67.3) + Math.sin(t * 41.7) * 0.6);
    out.y = s * 0.035 * (Math.cos(t * 59.1) + Math.sin(t * 47.9) * 0.6);
    out.z = s * 0.02 * Math.sin(t * 53.7);
    return out;
  }
}
