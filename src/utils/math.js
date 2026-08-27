/** Small, dependency-free numeric helpers used across the simulation. */

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const TAU = Math.PI * 2;

export const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

export const lerp = (a, b, t) => a + (b - a) * t;

export const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Maps `value` from the [inMin, inMax] range onto [outMin, outMax]. */
export const mapRange = (value, inMin, inMax, outMin, outMax) =>
  outMin + ((clamp(value, inMin, inMax) - inMin) / (inMax - inMin)) * (outMax - outMin);

/**
 * Sliders in the UI move linearly, but planet sizes and distances span several
 * orders of magnitude. These two helpers give every slider a logarithmic feel so
 * that a moon-sized world and a gas giant are both comfortable to dial in.
 */
export const toLogSlider = (value, min, max) => {
  const lv = Math.log(clamp(value, min, max));
  return (lv - Math.log(min)) / (Math.log(max) - Math.log(min));
};

export const fromLogSlider = (t, min, max) =>
  Math.exp(Math.log(min) + clamp(t, 0, 1) * (Math.log(max) - Math.log(min)));

/** Wraps an angle into [0, 2π). */
export const wrapAngle = (angle) => {
  const a = angle % TAU;
  return a < 0 ? a + TAU : a;
};

/** Deterministic 32-bit PRNG - the same seed always paints the same planet. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Turns any string into a stable 32-bit seed. */
export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

let idCounter = 0;
/** Short, readable, collision-safe id for user created bodies. */
export function createId(prefix = 'body') {
  idCounter += 1;
  const random = Math.random().toString(36).slice(2, 7);
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}-${random}`;
}
