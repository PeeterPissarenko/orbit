/**
 * The time controls: start, stop, speed up, slow down - and a readout of where
 * in history the simulation currently is.
 *
 * Speed is a logarithmic slider from about half an hour to fifty-five years per
 * second, with named presets for the speeds people actually want.
 */

import { SPEED_MAX, SPEED_MIN, SPEED_PRESETS } from '../core/SimulationClock.js';
import { formatElapsed, formatSimulationDate, formatSpeed } from '../utils/format.js';
import { fromLogSlider, toLogSlider } from '../utils/math.js';
import { button, el, icon, clear } from './dom.js';
import { createSegmented } from './widgets.js';

const RANGE_STEPS = 1000;

export class TimeBar {
  /** @param {import('../core/SimulationClock.js').SimulationClock} clock */
  constructor({ clock }) {
    this.clock = clock;

    this.playButton = button({
      iconName: 'play',
      title: 'Start / stop the simulation (Space)',
      ariaLabel: 'Start or stop the simulation',
      variant: 'btn--primary btn--big',
      size: 20,
      onClick: () => clock.toggle(),
    });

    this.reverseButton = button({
      iconName: 'reverse',
      title: 'Run time backwards (R)',
      ariaLabel: 'Run time backwards',
      variant: 'btn--icon',
      onClick: () => clock.reverse(),
    });

    this.slowerButton = button({
      iconName: 'minus',
      title: 'Slow down (left arrow)',
      ariaLabel: 'Slow down',
      variant: 'btn--icon',
      onClick: () => clock.multiplySpeed(1 / 2),
    });

    this.fasterButton = button({
      iconName: 'plus',
      title: 'Speed up (right arrow)',
      ariaLabel: 'Speed up',
      variant: 'btn--icon',
      onClick: () => clock.multiplySpeed(2),
    });

    this.range = el('input', {
      type: 'range',
      class: 'time__range',
      min: 0,
      max: RANGE_STEPS,
      step: 1,
      'aria-label': 'Simulation speed',
    });
    this.range.addEventListener('input', () => {
      clock.setSpeed(fromLogSlider(Number(this.range.value) / RANGE_STEPS, SPEED_MIN, SPEED_MAX));
    });

    this.speedValue = el('span', { class: 'time__value' });
    this.dateValue = el('span', { class: 'time__date' });
    this.elapsedValue = el('span', { class: 'time__elapsed' });

    this.presets = createSegmented({
      ariaLabel: 'Speed presets',
      options: SPEED_PRESETS.map((preset) => ({
        id: preset.label,
        label: preset.label,
        title: `${preset.label} of simulated time`,
      })),
      onSelect: (id) => {
        const preset = SPEED_PRESETS.find((item) => item.label === id);
        if (preset) clock.setSpeed(preset.daysPerSecond);
      },
    });

    this.el = el('footer', { class: 'hud-bottom' }, [
      el('div', { class: 'time__transport' }, [
        this.reverseButton,
        this.slowerButton,
        this.playButton,
        this.fasterButton,
      ]),
      el('div', { class: 'time__speed' }, [
        el('div', { class: 'time__speed-head' }, [
          el('span', { class: 'time__label', text: 'Speed' }),
          this.speedValue,
        ]),
        this.range,
      ]),
      el('div', { class: 'time__presets' }, this.presets.el),
      el('div', { class: 'time__readout' }, [
        this.dateValue,
        this.elapsedValue,
        button({
          label: 'Back to day zero',
          variant: 'btn--chip',
          title: 'Return the simulation to 1 January 2000',
          onClick: () => clock.resetTime(),
        }),
      ]),
    ]);

    this.unsubscribe = clock.subscribe(() => this.syncControls());
    this.syncControls();
  }

  /** Called from the render loop: only the two cheap readouts change. */
  tick() {
    this.dateValue.textContent = formatSimulationDate(this.clock.days);
    this.elapsedValue.textContent = `${formatElapsed(this.clock.days)} from 1 Jan 2000`;
  }

  syncControls() {
    const { clock } = this;
    clear(this.playButton);
    this.playButton.appendChild(icon(clock.running ? 'pause' : 'play', { size: 20 }));
    this.playButton.title = clock.running
      ? 'Stop the simulation (Space)'
      : 'Start the simulation (Space)';
    this.playButton.setAttribute(
      'aria-label',
      clock.running ? 'Stop the simulation' : 'Start the simulation',
    );

    this.reverseButton.classList.toggle('is-active', clock.direction < 0);
    this.range.value = String(Math.round(toLogSlider(clock.speed, SPEED_MIN, SPEED_MAX) * RANGE_STEPS));

    const signed = clock.speed * clock.direction;
    this.speedValue.textContent = clock.running
      ? `${formatSpeed(signed)}${clock.direction < 0 ? ' (backwards)' : ''}`
      : 'Paused';

    const active = SPEED_PRESETS.find(
      (preset) => Math.abs(preset.daysPerSecond - clock.speed) < preset.daysPerSecond * 0.02,
    );
    this.presets.setActive(active?.label ?? null);
    this.tick();
  }

  dispose() {
    this.unsubscribe?.();
    this.el.remove();
  }
}
