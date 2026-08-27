/**
 * BONUS - adaptive render resolution.
 *
 * Watches the rolling average frame time and trims the device pixel ratio when
 * the frame rate sags, then gives it back once there is headroom again. Useful
 * on a school laptop with fifty user-invented planets in the scene.
 */

const SAMPLE_FRAMES = 45;
const SLOW_MS = 21; // below ~48 fps
const FAST_MS = 12; // above ~83 fps
const STEP = 0.2;
const MIN_RATIO = 0.6;

export class AdaptiveQuality {
  constructor({ renderer, sceneManager }) {
    this.renderer = renderer;
    this.sceneManager = sceneManager;
    this.active = false;
    this.frames = 0;
    this.total = 0;
    this.maxRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.ratio = this.maxRatio;
  }

  enable() {
    this.active = true;
    this.frames = 0;
    this.total = 0;
  }

  disable() {
    this.active = false;
    if (this.ratio !== this.maxRatio) {
      this.ratio = this.maxRatio;
      this.apply();
    }
  }

  apply() {
    this.renderer.setPixelRatio(this.ratio);
    this.sceneManager.handleResize();
  }

  update(dt) {
    if (!this.active) return;
    this.frames += 1;
    this.total += dt * 1000;
    if (this.frames < SAMPLE_FRAMES) return;

    const average = this.total / this.frames;
    this.frames = 0;
    this.total = 0;

    if (average > SLOW_MS && this.ratio > MIN_RATIO) {
      this.ratio = Math.max(MIN_RATIO, this.ratio - STEP);
      this.apply();
    } else if (average < FAST_MS && this.ratio < this.maxRatio) {
      this.ratio = Math.min(this.maxRatio, this.ratio + STEP);
      this.apply();
    }
  }

  dispose() {
    this.disable();
  }
}
