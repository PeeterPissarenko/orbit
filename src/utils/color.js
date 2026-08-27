/** Tiny colour helpers for the procedural texture painter. */

import { clamp } from './math.js';

export function hexToRgb(hex) {
  const value = hex.replace('#', '');
  const int = Number.parseInt(
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value,
    16,
  );
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

export function rgbToHex({ r, g, b }) {
  const to = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function rgbToHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h / 6, s, l };
}

function hueToRgb(p, q, t) {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

export function hslToRgb({ h, s, l }) {
  const hh = ((h % 1) + 1) % 1;
  const ss = clamp(s, 0, 1);
  const ll = clamp(l, 0, 1);
  if (ss === 0) {
    const v = ll * 255;
    return { r: v, g: v, b: v };
  }
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  return {
    r: hueToRgb(p, q, hh + 1 / 3) * 255,
    g: hueToRgb(p, q, hh) * 255,
    b: hueToRgb(p, q, hh - 1 / 3) * 255,
  };
}

export function mixRgb(a, b, t) {
  const k = clamp(t, 0, 1);
  return {
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k,
  };
}

/** Lightens (amount > 0) or darkens (amount < 0) while keeping the hue. */
export function shade(rgb, amount) {
  const hsl = rgbToHsl(rgb);
  return hslToRgb({ ...hsl, l: clamp(hsl.l + amount, 0, 1) });
}

export function saturate(rgb, amount) {
  const hsl = rgbToHsl(rgb);
  return hslToRgb({ ...hsl, s: clamp(hsl.s + amount, 0, 1) });
}

export function rotateHue(rgb, turns) {
  const hsl = rgbToHsl(rgb);
  return hslToRgb({ ...hsl, h: hsl.h + turns });
}

/** Readable text colour for a swatch of the given background. */
export function contrastText(hex) {
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#10141c' : '#f4f7fb';
}
