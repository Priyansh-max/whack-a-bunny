// ---------------------------------------------------------------------------
// utils.js — RNG, easing, a tiny tween manager and an object pool.
// ---------------------------------------------------------------------------

export const rand = (min, max) => min + Math.random() * (max - min);
export const randInt = (min, max) => Math.floor(rand(min, max + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;

// Frame-rate independent exponential damping (Freya Holmér style).
export const damp = (current, target, lambda, dt) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

export const Ease = {
  linear: (t) => t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inCubic: (t) => t * t * t,
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outBack: (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outElastic: (t) => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
  outBounce: (t) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

// ---------------------------------------------------------------------------
// Tiny tween manager — update(dt) once per frame from the main loop.
// ---------------------------------------------------------------------------
const activeTweens = new Set();

export function tween({ duration = 1, delay = 0, ease = Ease.outCubic, onUpdate, onComplete }) {
  const tw = { t: -delay, duration, ease, onUpdate, onComplete, dead: false };
  activeTweens.add(tw);
  return tw;
}

export function killTween(tw) { if (tw) tw.dead = true; }

export function updateTweens(dt) {
  for (const tw of activeTweens) {
    if (tw.dead) { activeTweens.delete(tw); continue; }
    tw.t += dt;
    if (tw.t < 0) continue;
    const k = clamp(tw.t / tw.duration, 0, 1);
    tw.onUpdate && tw.onUpdate(tw.ease(k), k);
    if (k >= 1) {
      activeTweens.delete(tw);
      tw.onComplete && tw.onComplete();
    }
  }
}

// ---------------------------------------------------------------------------
// Generic object pool. `factory` creates, `reset` prepares a reused instance.
// ---------------------------------------------------------------------------
export class Pool {
  constructor(factory, reset, initial = 0) {
    this.factory = factory;
    this.reset = reset;
    this.free = [];
    for (let i = 0; i < initial; i++) this.free.push(factory());
  }
  obtain(...args) {
    const obj = this.free.pop() || this.factory();
    if (this.reset) this.reset(obj, ...args);
    return obj;
  }
  release(obj) { this.free.push(obj); }
}
