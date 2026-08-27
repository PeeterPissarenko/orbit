/**
 * One place that owns every texture in the app.
 *
 * Two kinds of texture live here:
 *   - photographic maps loaded from public/textures (cached by filename)
 *   - procedurally painted surfaces (cached by style + colour + seed)
 *
 * Painting a surface costs tens of milliseconds, which is far too long to do
 * thirteen times during start-up. Procedural jobs therefore run on an idle
 * queue: the body appears immediately wearing a plain coloured material and
 * upgrades itself to a textured one a frame or two later.
 */

import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
} from 'three';

import { RING_TEXTURES, STARFIELD_TEXTURE, TEXTURE_SETS, texturePath } from './catalogue.js';
import { generateGlowSprite, generateRingStrip, generateSurface } from './procedural.js';

const IDLE = typeof requestIdleCallback === 'function';

/** Painted surfaces kept around after nothing references them any more. */
const PROCEDURAL_CACHE_SOFT_CAP = 48;

export class TextureLibrary {
  constructor(renderer) {
    this.renderer = renderer;
    this.maxAnisotropy = renderer?.capabilities?.getMaxAnisotropy?.() ?? 1;
    this.loader = new TextureLoader();
    this.files = new Map();
    this.procedural = new Map();
    this.glows = new Map();
    this.ringStrips = new Map();
    this.queue = [];
    this.draining = false;
    this.missingFiles = new Set();
  }

  /* --------------------------------------------------------------- files */

  /**
   * A texture loaded from public/textures. Three fills the image in
   * asynchronously, so the returned texture can be assigned to a material
   * straight away.
   */
  file(fileName, { srgb = true } = {}) {
    const cacheKey = `${fileName}|${srgb}`;
    const cached = this.files.get(cacheKey);
    if (cached) return cached;

    const texture = this.loader.load(
      texturePath(fileName),
      undefined,
      undefined,
      () => {
        this.missingFiles.add(fileName);
      },
    );
    if (srgb) texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = this.maxAnisotropy;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    this.files.set(cacheKey, texture);
    return texture;
  }

  /** The photographic texture set for a body, or null if it has none. */
  setFor(textureId) {
    if (!textureId) return null;
    return TEXTURE_SETS[textureId] ?? null;
  }

  ringTexture(ringTextureId) {
    const entry = RING_TEXTURES[ringTextureId];
    if (!entry) return null;
    return this.file(entry.file);
  }

  starfield() {
    return this.file(STARFIELD_TEXTURE);
  }

  /* ---------------------------------------------------------- procedural */

  /**
   * Requests a painted surface. Resolves with
   * `{ key, map, bumpMap, emissiveMap }` - CanvasTextures shared between bodies
   * that ask for the same combination.
   *
   * Callers `retain(key)` what they adopt and `release(key)` what they drop, so
   * a long session of colour experiments cannot grow the cache without bound.
   */
  requestProcedural({ style, color, seed, size = 512 }) {
    const key = `${style}|${color}|${seed}|${size}`;
    const cached = this.procedural.get(key);
    if (cached) return cached.promise;

    let resolve;
    const promise = new Promise((res) => {
      resolve = res;
    });
    const entry = { promise, textures: null, refs: 0 };
    this.procedural.set(key, entry);

    this.queue.push(() => {
      const { colorCanvas, bumpCanvas, emissiveCanvas } = generateSurface({
        style,
        color,
        seed,
        width: size,
        height: size / 2,
      });
      const textures = {
        key,
        map: this.canvasTexture(colorCanvas, { srgb: true }),
        bumpMap: this.canvasTexture(bumpCanvas, { srgb: false }),
        emissiveMap: emissiveCanvas ? this.canvasTexture(emissiveCanvas, { srgb: true }) : null,
      };
      entry.textures = textures;
      resolve(textures);
    });
    this.drain();
    return promise;
  }

  retain(key) {
    const entry = key ? this.procedural.get(key) : null;
    if (entry) entry.refs += 1;
  }

  /**
   * Drops a reference. An unreferenced surface is only actually thrown away
   * once the cache is over its soft cap, so switching back and forth between
   * two colours still hits the cache.
   */
  release(key) {
    const entry = key ? this.procedural.get(key) : null;
    if (!entry) return;
    entry.refs = Math.max(0, entry.refs - 1);
    this.evict(key, entry);
  }

  /**
   * Offers back a surface that was never adopted - the body it was painted for
   * changed its mind while the paint was still on the queue.
   */
  discard(key) {
    const entry = key ? this.procedural.get(key) : null;
    if (entry) this.evict(key, entry);
  }

  evict(key, entry) {
    // Never touch a surface someone is wearing, or one still being painted.
    if (entry.refs > 0 || !entry.textures) return;
    if (this.procedural.size <= PROCEDURAL_CACHE_SOFT_CAP) return;
    entry.textures.map?.dispose();
    entry.textures.bumpMap?.dispose();
    entry.textures.emissiveMap?.dispose();
    this.procedural.delete(key);
  }

  canvasTexture(canvas, { srgb = true, wrap = RepeatWrapping } = {}) {
    const texture = new CanvasTexture(canvas);
    if (srgb) texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = this.maxAnisotropy;
    texture.wrapS = wrap;
    texture.wrapT = ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * The star glow and the ring strips are generated white and tinted by the
   * material's colour, so changing a colour never paints a new canvas.
   */
  glow() {
    const cached = this.glows.get('white');
    if (cached) return cached;
    const texture = this.canvasTexture(generateGlowSprite({ color: '#ffffff' }), {
      srgb: true,
      wrap: ClampToEdgeWrapping,
    });
    this.glows.set('white', texture);
    return texture;
  }

  ringStrip(seed) {
    const key = String(seed);
    const cached = this.ringStrips.get(key);
    if (cached) return cached;
    const texture = this.canvasTexture(generateRingStrip({ color: '#ffffff', seed }), {
      srgb: true,
      wrap: ClampToEdgeWrapping,
    });
    this.ringStrips.set(key, texture);
    return texture;
  }

  /* ------------------------------------------------------------- queueing */

  drain() {
    if (this.draining || this.queue.length === 0) return;
    this.draining = true;

    // Painting a single surface already costs more than one idle slice, so we
    // run exactly one job per callback and hand the thread straight back.
    const run = () => {
      const job = this.queue.shift();
      if (job) {
        try {
          job();
        } catch {
          /* one failed texture must never stall the queue */
        }
      }
      if (this.queue.length > 0) {
        schedule();
      } else {
        this.draining = false;
      }
    };

    const schedule = () => {
      if (IDLE) requestIdleCallback(run, { timeout: 250 });
      else setTimeout(run, 0);
    };

    schedule();
  }

  /* -------------------------------------------------------------- cleanup */

  dispose() {
    for (const texture of this.files.values()) texture.dispose();
    for (const entry of this.procedural.values()) {
      if (!entry.textures) continue;
      entry.textures.map?.dispose();
      entry.textures.bumpMap?.dispose();
      entry.textures.emissiveMap?.dispose();
    }
    for (const texture of this.glows.values()) texture.dispose();
    for (const texture of this.ringStrips.values()) texture.dispose();
    this.files.clear();
    this.procedural.clear();
    this.glows.clear();
    this.ringStrips.clear();
    this.queue.length = 0;
  }
}
