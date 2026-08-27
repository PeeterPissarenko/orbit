/**
 * Procedural planet painter.
 *
 * Real photographic maps are used for the bodies we have them for. Every world
 * a user invents gets a texture painted here instead, from its colour and its
 * chosen surface style, so a brand new planet still has continents, craters or
 * cloud bands rather than being a flat plastic ball.
 *
 * The noise is sampled in 3D on the surface of the sphere, so the resulting
 * equirectangular map has no seam where longitude wraps.
 */

import { createNoise3D, fbm, ridged } from '../utils/noise.js';
import { hexToRgb, hslToRgb, mixRgb, rgbToHsl, rotateHue, shade } from '../utils/color.js';
import { clamp, smoothstep } from '../utils/math.js';

function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function buildPalette(style, hex) {
  const base = hexToRgb(hex);
  const hsl = rgbToHsl(base);
  switch (style) {
    case 'terran':
      return {
        deepOcean: hslToRgb({ h: hsl.h, s: clamp(hsl.s + 0.1, 0, 1), l: clamp(hsl.l - 0.28, 0.03, 1) }),
        shallowOcean: hslToRgb({ h: hsl.h, s: clamp(hsl.s + 0.15, 0, 1), l: clamp(hsl.l + 0.06, 0, 1) }),
        beach: hslToRgb({ h: (hsl.h + 0.12) % 1, s: 0.35, l: 0.62 }),
        lowland: hslToRgb({ h: (hsl.h + 0.42) % 1, s: 0.38, l: 0.34 }),
        highland: hslToRgb({ h: (hsl.h + 0.36) % 1, s: 0.24, l: 0.42 }),
        rock: hslToRgb({ h: (hsl.h + 0.5) % 1, s: 0.12, l: 0.38 }),
        ice: { r: 244, g: 248, b: 252 },
      };
    case 'gas': {
      const light = shade(base, 0.18);
      const dark = shade(base, -0.16);
      return {
        stops: [
          shade(dark, -0.06),
          light,
          rotateHue(dark, 0.03),
          shade(light, 0.08),
          dark,
          shade(light, -0.02),
        ],
        storm: rotateHue(shade(base, -0.1), -0.06),
      };
    }
    case 'icy':
      return {
        low: shade(base, -0.14),
        high: shade(base, 0.24),
        crack: hslToRgb({ h: (hsl.h + 0.55) % 1, s: 0.35, l: 0.32 }),
      };
    case 'lava':
      return {
        crust: hslToRgb({ h: hsl.h, s: 0.25, l: 0.09 }),
        warm: hslToRgb({ h: 0.06, s: 0.85, l: 0.34 }),
        glow: hslToRgb({ h: 0.11, s: 1, l: 0.62 }),
      };
    case 'star':
      return {
        cool: shade(base, -0.12),
        hot: { r: 255, g: 250, b: 226 },
      };
    case 'rocky':
    default:
      return {
        dark: shade(base, -0.2),
        mid: base,
        light: shade(base, 0.2),
        maria: shade(base, -0.32),
      };
  }
}

/**
 * Paints one world.
 *
 * @returns {{colorCanvas: HTMLCanvasElement, bumpCanvas: HTMLCanvasElement,
 *            emissiveCanvas: HTMLCanvasElement|null}}
 */
export function generateSurface({
  style = 'rocky',
  color = '#b0b0b0',
  seed = 1,
  width = 512,
  height = 256,
} = {}) {
  const noise = createNoise3D(seed);
  const noiseB = createNoise3D((seed ^ 0x9e3779b9) >>> 0);
  const palette = buildPalette(style, color);

  const colorCanvas = createCanvas(width, height);
  const bumpCanvas = createCanvas(width, height);
  const emissiveCanvas = style === 'lava' || style === 'star' ? createCanvas(width, height) : null;

  const colorCtx = colorCanvas.getContext('2d');
  const bumpCtx = bumpCanvas.getContext('2d');
  const emissiveCtx = emissiveCanvas ? emissiveCanvas.getContext('2d') : null;

  const colorImage = colorCtx.createImageData(width, height);
  const bumpImage = bumpCtx.createImageData(width, height);
  const emissiveImage = emissiveCtx ? emissiveCtx.createImageData(width, height) : null;

  const cData = colorImage.data;
  const bData = bumpImage.data;
  const eData = emissiveImage ? emissiveImage.data : null;

  // Pre-compute the direction table: cos/sin of every latitude and longitude.
  const cosLon = new Float32Array(width);
  const sinLon = new Float32Array(width);
  for (let x = 0; x < width; x += 1) {
    const lon = (x / width) * Math.PI * 2 - Math.PI;
    cosLon[x] = Math.cos(lon);
    sinLon[x] = Math.sin(lon);
  }

  // Storm position for gas giants, deterministic per seed.
  const stormLon = ((seed % 997) / 997) * Math.PI * 2 - Math.PI;
  const stormLat = -0.32 + ((seed % 331) / 331) * 0.5;
  const bandCount = 7 + (seed % 5);

  for (let y = 0; y < height; y += 1) {
    const lat = Math.PI / 2 - ((y + 0.5) / height) * Math.PI;
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);
    const rowOffset = y * width * 4;

    for (let x = 0; x < width; x += 1) {
      const nx = cosLat * cosLon[x];
      const ny = sinLat;
      const nz = cosLat * sinLon[x];

      let rgb;
      let elevation;
      let emissive = null;

      switch (style) {
        case 'terran': {
          const continents = fbm(noise, nx * 1.7, ny * 1.7, nz * 1.7, 6);
          const detail = fbm(noiseB, nx * 6.5, ny * 6.5, nz * 6.5, 4);
          const land = continents + detail * 0.16;
          if (land < 0.015) {
            const depth = smoothstep(-0.55, 0.015, land);
            rgb = mixRgb(palette.deepOcean, palette.shallowOcean, depth * depth);
            elevation = 0.18 + depth * 0.08;
          } else {
            const t = smoothstep(0.015, 0.42, land);
            rgb = mixRgb(palette.beach, palette.lowland, smoothstep(0, 0.3, t));
            rgb = mixRgb(rgb, palette.highland, smoothstep(0.3, 0.7, t));
            rgb = mixRgb(rgb, palette.rock, smoothstep(0.72, 1, t));
            elevation = 0.32 + t * 0.68;
          }
          const capNoise = fbm(noiseB, nx * 3.2 + 4, ny * 3.2, nz * 3.2, 3) * 0.09;
          const cap = smoothstep(0.74, 0.92, Math.abs(sinLat) + capNoise);
          if (cap > 0) {
            rgb = mixRgb(rgb, palette.ice, cap);
            elevation = Math.max(elevation, 0.4 + cap * 0.2);
          }
          break;
        }
        case 'gas': {
          const warp = fbm(noise, nx * 1.9, ny * 3.4, nz * 1.9, 4);
          const turbulence = fbm(noiseB, nx * 5.5, ny * 11, nz * 5.5, 4);
          const t = 0.5 + 0.5 * Math.sin(lat * bandCount * 2 + warp * 2.6 + turbulence * 0.9);
          const stops = palette.stops;
          const scaled = t * (stops.length - 1);
          const index = Math.min(Math.floor(scaled), stops.length - 2);
          rgb = mixRgb(stops[index], stops[index + 1], scaled - index);

          // One signature storm, stretched the way real ovals are.
          let dLon = ((x / width) * Math.PI * 2 - Math.PI) - stormLon;
          dLon = Math.atan2(Math.sin(dLon), Math.cos(dLon));
          const dLat = lat - stormLat;
          const oval = (dLon / 0.55) ** 2 + (dLat / 0.16) ** 2;
          if (oval < 1) {
            const swirl = 0.5 + 0.5 * fbm(noise, nx * 9 + 21, ny * 9, nz * 9, 3);
            rgb = mixRgb(rgb, palette.storm, (1 - oval) * (0.55 + swirl * 0.45));
          }
          elevation = 0.45 + t * 0.1;
          break;
        }
        case 'icy': {
          const base = fbm(noise, nx * 2.4, ny * 2.4, nz * 2.4, 5);
          const crackField = ridged(noiseB, nx * 4.5, ny * 4.5, nz * 4.5, 4);
          const cracks = smoothstep(0.78, 0.98, crackField);
          rgb = mixRgb(palette.low, palette.high, 0.5 + 0.5 * base);
          rgb = mixRgb(rgb, palette.crack, cracks * 0.65);
          elevation = 0.55 + base * 0.2 - cracks * 0.35;
          break;
        }
        case 'lava': {
          const crust = fbm(noise, nx * 3.1, ny * 3.1, nz * 3.1, 5);
          const veins = ridged(noiseB, nx * 4.2, ny * 4.2, nz * 4.2, 5);
          const heat = smoothstep(0.72, 0.99, veins) * smoothstep(-0.4, 0.3, crust);
          rgb = mixRgb(palette.crust, palette.warm, smoothstep(0.3, 0.9, heat + crust * 0.2));
          rgb = mixRgb(rgb, palette.glow, smoothstep(0.55, 1, heat));
          elevation = 0.4 + crust * 0.3;
          emissive = {
            r: palette.glow.r * heat,
            g: palette.glow.g * heat * 0.75,
            b: palette.glow.b * heat * 0.35,
          };
          break;
        }
        case 'star': {
          const granules = fbm(noise, nx * 9, ny * 9, nz * 9, 4);
          const flares = ridged(noiseB, nx * 3, ny * 3, nz * 3, 3);
          const t = clamp(0.55 + granules * 0.5 + flares * 0.25, 0, 1);
          rgb = mixRgb(palette.cool, palette.hot, t);
          elevation = 0.5;
          emissive = { r: rgb.r, g: rgb.g, b: rgb.b };
          break;
        }
        case 'rocky':
        default: {
          const relief = fbm(noise, nx * 2.3, ny * 2.3, nz * 2.3, 5);
          const craters = ridged(noiseB, nx * 7.5, ny * 7.5, nz * 7.5, 4);
          const maria = fbm(noise, nx * 1.15 + 13, ny * 1.15, nz * 1.15, 3);
          let shadeT = clamp(0.5 + relief * 0.55, 0, 1) * 0.65 + craters * 0.35;
          shadeT = clamp(shadeT, 0, 1);
          rgb = mixRgb(palette.dark, palette.light, shadeT);
          const mariaMask = smoothstep(0.22, 0.6, maria);
          rgb = mixRgb(rgb, palette.maria, mariaMask * 0.7);
          elevation = clamp(shadeT * 0.8 + (1 - mariaMask) * 0.2, 0, 1);
          break;
        }
      }

      const i = rowOffset + x * 4;
      cData[i] = rgb.r;
      cData[i + 1] = rgb.g;
      cData[i + 2] = rgb.b;
      cData[i + 3] = 255;

      const bump = clamp(elevation, 0, 1) * 255;
      bData[i] = bump;
      bData[i + 1] = bump;
      bData[i + 2] = bump;
      bData[i + 3] = 255;

      if (eData) {
        eData[i] = emissive ? emissive.r : 0;
        eData[i + 1] = emissive ? emissive.g : 0;
        eData[i + 2] = emissive ? emissive.b : 0;
        eData[i + 3] = 255;
      }
    }
  }

  colorCtx.putImageData(colorImage, 0, 0);
  bumpCtx.putImageData(bumpImage, 0, 0);
  if (emissiveCtx && emissiveImage) emissiveCtx.putImageData(emissiveImage, 0, 0);

  return { colorCanvas, bumpCanvas, emissiveCanvas };
}

/**
 * A soft radial gradient, used for the Sun's glow sprite and for the
 * atmospheric halo around planets that have one.
 */
export function generateGlowSprite({ color = '#ffd27f', size = 256, falloff = 2.4 } = {}) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const data = image.data;
  const rgb = hexToRgb(color);
  const centre = (size - 1) / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x - centre) / centre;
      const dy = (y - centre) / centre;
      const d = Math.sqrt(dx * dx + dy * dy);
      const alpha = d >= 1 ? 0 : (1 - d) ** falloff;
      const i = (y * size + x) * 4;
      data[i] = rgb.r;
      data[i + 1] = rgb.g;
      data[i + 2] = rgb.b;
      data[i + 3] = clamp(alpha * 255, 0, 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** A thin ring band, used when a ring has no photographic texture. */
export function generateRingStrip({ color = '#d8d0be', seed = 7, width = 512 } = {}) {
  const canvas = createCanvas(width, 8);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, 8);
  const data = image.data;
  const noise = createNoise3D(seed);
  const base = hexToRgb(color);

  for (let x = 0; x < width; x += 1) {
    const t = x / width;
    const bands = fbm(noise, t * 26, 0.5, 0.5, 4);
    const gap = smoothstep(0.35, 0.5, Math.abs(fbm(noise, t * 9 + 3, 1.5, 1.5, 3)));
    const brightness = clamp(0.55 + bands * 0.45, 0, 1);
    const alpha = clamp((1 - gap * 0.85) * (0.35 + brightness * 0.65), 0, 1);
    const rgb = shade(base, (brightness - 0.5) * 0.25);
    for (let y = 0; y < 8; y += 1) {
      const i = (y * width + x) * 4;
      data[i] = rgb.r;
      data[i + 1] = rgb.g;
      data[i + 2] = rgb.b;
      data[i + 3] = alpha * 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
