/**
 * Simulation time.
 *
 * The whole simulation is driven by one number: `days`, the simulated time
 * elapsed since the J2000.0 epoch. Speed is expressed in simulated days per
 * real second, which is the only unit that stays meaningful when a user has
 * just invented a planet with a four-hour year.
 *
 * Rendering never reads wall-clock time directly - it asks the clock - so
 * pausing genuinely freezes everything, including planetary spin.
 */

import { clamp, fromLogSlider, toLogSlider } from '../utils/math.js';

export const SPEED_MIN = 0.02; // ~30 minutes of simulated time per second
export const SPEED_MAX = 20000; // ~55 years per second
export const DEFAULT_SPEED = 5;

/** Named speeds for the quick-pick buttons under the time slider. */
export const SPEED_PRESETS = [
  { label: '1 h/s', daysPerSecond: 1 / 24 },
  { label: '1 d/s', daysPerSecond: 1 },
  { label: '1 wk/s', daysPerSecond: 7 },
  { label: '1 mo/s', daysPerSecond: 30.44 },
  { label: '1 yr/s', daysPerSecond: 365.25 },
  { label: '10 yr/s', daysPerSecond: 3652.5 },
];

/** Largest real frame step we integrate: prevents a jump after a hidden tab. */
const MAX_FRAME_SECONDS = 1 / 10;

export class SimulationClock {
  constructor({ speed = DEFAULT_SPEED, running = true } = {}) {
    this.days = 0;
    this.speed = clamp(Math.abs(speed), SPEED_MIN, SPEED_MAX);
    this.direction = 1;
    this.running = running;
    this.lastDelta = 0;
    this.listeners = new Set();
  }

  /** @param {(clock: SimulationClock) => void} listener */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of [...this.listeners]) listener(this);
  }

  /** Advances simulated time. Returns the number of simulated days elapsed. */
  advance(realDeltaSeconds) {
    const dt = clamp(realDeltaSeconds, 0, MAX_FRAME_SECONDS);
    if (!this.running || dt === 0) {
      this.lastDelta = 0;
      return 0;
    }
    const delta = dt * this.speed * this.direction;
    this.days += delta;
    this.lastDelta = delta;
    return delta;
  }

  /** Simulated days per real second, signed. Zero while paused. */
  get daysPerSecond() {
    return this.running ? this.speed * this.direction : 0;
  }

  play() {
    if (this.running) return;
    this.running = true;
    this.notify();
  }

  pause() {
    if (!this.running) return;
    this.running = false;
    this.lastDelta = 0;
    this.notify();
  }

  toggle() {
    this.running ? this.pause() : this.play();
    return this.running;
  }

  setSpeed(daysPerSecond) {
    const magnitude = clamp(Math.abs(daysPerSecond), SPEED_MIN, SPEED_MAX);
    const direction = daysPerSecond < 0 ? -1 : this.direction;
    if (magnitude === this.speed && direction === this.direction) return;
    this.speed = magnitude;
    this.direction = direction;
    this.notify();
  }

  /** Used by the +/- buttons and the keyboard shortcuts. */
  multiplySpeed(factor) {
    this.setSpeed(this.speed * factor);
  }

  setDirection(direction) {
    const next = direction < 0 ? -1 : 1;
    if (next === this.direction) return;
    this.direction = next;
    this.notify();
  }

  reverse() {
    this.setDirection(-this.direction);
    return this.direction;
  }

  /** Nudges time by a fixed amount even while paused (frame-by-frame study). */
  step(days) {
    this.days += days;
    this.notify();
  }

  /** Slider position 0..1 <-> speed, on a logarithmic scale. */
  get speedSlider() {
    return toLogSlider(this.speed, SPEED_MIN, SPEED_MAX);
  }

  set speedSlider(t) {
    this.setSpeed(fromLogSlider(t, SPEED_MIN, SPEED_MAX));
  }

  resetTime() {
    this.days = 0;
    this.notify();
  }

  reset() {
    this.days = 0;
    this.speed = DEFAULT_SPEED;
    this.direction = 1;
    this.running = true;
    this.notify();
  }
}
