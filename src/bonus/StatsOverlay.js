/** BONUS - a small performance readout: frame rate, draw calls, triangles. */

import { el } from '../ui/dom.js';

const REFRESH_MS = 400;

export class StatsOverlay {
  constructor({ renderer }) {
    this.renderer = renderer;
    this.el = null;
    this.frames = 0;
    this.accumulated = 0;
    this.sinceRefresh = 0;
  }

  enable() {
    if (this.el) return;
    this.fpsNode = el('span', {}, [el('strong', { text: '--' }), ' fps']);
    this.msNode = el('span', {}, [el('strong', { text: '--' }), ' ms']);
    this.callsNode = el('span', {}, [el('strong', { text: '--' }), ' calls']);
    this.trianglesNode = el('span', {}, [el('strong', { text: '--' }), ' tris']);
    this.el = el('div', { class: 'stats-overlay' }, [
      this.fpsNode,
      this.msNode,
      this.callsNode,
      this.trianglesNode,
    ]);
    document.body.appendChild(this.el);
  }

  disable() {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
  }

  update(dt) {
    if (!this.el) return;
    this.frames += 1;
    this.accumulated += dt;
    this.sinceRefresh += dt * 1000;

    if (this.sinceRefresh < REFRESH_MS) return;

    const fps = this.frames / Math.max(this.accumulated, 1e-6);
    const info = this.renderer.info;
    this.fpsNode.firstChild.textContent = fps.toFixed(0);
    this.msNode.firstChild.textContent = ((this.accumulated / this.frames) * 1000).toFixed(1);
    this.callsNode.firstChild.textContent = String(info.render.calls);
    this.trianglesNode.firstChild.textContent = formatCount(info.render.triangles);

    this.frames = 0;
    this.accumulated = 0;
    this.sinceRefresh = 0;
  }

  dispose() {
    this.disable();
  }
}

function formatCount(value) {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}k`;
  return String(value);
}
