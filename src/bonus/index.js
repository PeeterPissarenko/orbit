/**
 * BONUS - the one place that turns feature flags into behaviour.
 *
 * Core modules never import anything from src/bonus, and nothing here is
 * constructed until its flag is switched on, so with every flag off the
 * simulation behaves exactly as the mandatory requirements describe.
 */

import { AdaptiveQuality } from './AdaptiveQuality.js';
import { AsteroidBelt } from './AsteroidBelt.js';
import { Labels } from './Labels.js';
import { Shadows } from './Shadows.js';
import { StatsOverlay } from './StatsOverlay.js';
import { Trails } from './Trails.js';

export class BonusManager {
  /**
   * @param {object} options
   * @param {import('../config/featureFlags.js').FeatureFlags} options.flags
   * @param {object} options.deps
   * @param {(enabled: boolean) => void} options.onTrueScale
   */
  constructor({ flags, deps, onTrueScale }) {
    this.flags = flags;
    this.deps = deps;
    this.onTrueScale = onTrueScale;

    /** @type {Map<string, {enable(): void, disable(): void, update?: Function}>} */
    this.modules = new Map();
    this.factories = {
      labels: () =>
        new Labels({
          system: deps.system,
          camera: deps.camera,
          canvas: deps.canvas,
          store: deps.store,
        }),
      trails: () => new Trails({ scene: deps.scene, system: deps.system, store: deps.store }),
      asteroidBelt: () =>
        new AsteroidBelt({ scene: deps.scene, scale: deps.scale, textures: deps.textures }),
      shadows: () =>
        new Shadows({
          renderer: deps.renderer,
          sceneManager: deps.sceneManager,
          system: deps.system,
        }),
      stats: () => new StatsOverlay({ renderer: deps.renderer }),
      autoQuality: () =>
        new AdaptiveQuality({ renderer: deps.renderer, sceneManager: deps.sceneManager }),
    };

    this.unsubscribe = flags.subscribe((id, value) => this.apply(id, value));
    this.syncAll();
  }

  syncAll() {
    for (const id of Object.keys(this.factories)) this.apply(id, this.flags.get(id));
    if (this.flags.get('trueScale')) this.onTrueScale?.(true);
  }

  apply(id, enabled) {
    if (id === 'trueScale') {
      this.onTrueScale?.(enabled);
      return;
    }
    if (id === 'screenshot') return; // purely a UI button

    const factory = this.factories[id];
    if (!factory) return;

    if (enabled) {
      let module = this.modules.get(id);
      if (!module) {
        module = factory();
        this.modules.set(id, module);
      }
      module.enable();
    } else {
      this.modules.get(id)?.disable();
    }
  }

  get(id) {
    return this.modules.get(id) ?? null;
  }

  /** Called whenever bodies are added or removed. */
  refresh() {
    this.modules.get('shadows')?.refresh?.();
  }

  rescale(scale) {
    this.deps.scale = scale;
    this.modules.get('asteroidBelt')?.rescale?.(scale);
  }

  update(dt, days) {
    for (const [id, module] of this.modules) {
      if (!this.flags.get(id)) continue;
      module.update?.(dt, days);
    }
  }

  dispose() {
    this.unsubscribe?.();
    for (const module of this.modules.values()) module.dispose?.();
    this.modules.clear();
  }
}
