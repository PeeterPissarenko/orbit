/**
 * The hover card.
 *
 * Shows the same information whether the pointer is over a body or over its
 * orbital path, which is what the brief asks for: name, size and distance from
 * the centre of the system, plus the numbers a curious ten-year-old asks for
 * next (how long is a year there, how long is a day).
 */

import { el, clear } from './dom.js';
import {
  formatDiameter,
  formatDistance,
  formatKm,
  formatNumber,
  formatPeriod,
  formatRotation,
} from '../utils/format.js';
import { EARTH_RADIUS_KM } from '../config/scale.js';

const KIND_LABEL = { star: 'Star', planet: 'Planet', moon: 'Moon' };
const EDGE_PADDING = 16;

export class Tooltip {
  /** @param {import('../state/SystemStore.js').SystemStore} store */
  constructor(store) {
    this.store = store;
    this.el = el('div', { class: 'tooltip', role: 'tooltip' });
    this.el.hidden = true;
    document.body.appendChild(this.el);
    this.currentKey = '';
  }

  /**
   * @param {object} body
   * @param {'body'|'orbit'} kind
   * @param {number} x  client x
   * @param {number} y  client y
   */
  show(body, kind, x, y) {
    const key = `${body.id}|${kind}`;
    if (key !== this.currentKey) {
      this.currentKey = key;
      this.render(body, kind);
    }
    this.el.hidden = false;
    this.position(x, y);
    // Force a style flush so the fade-in runs on first show.
    void this.el.offsetWidth;
    this.el.classList.add('is-visible');
  }

  hide() {
    this.currentKey = '';
    this.el.classList.remove('is-visible');
    this.el.hidden = true;
  }

  position(x, y) {
    const rect = this.el.getBoundingClientRect();
    const width = rect.width || 240;
    const height = rect.height || 140;
    let left = x + 18;
    let top = y + 18;
    if (left + width > window.innerWidth - EDGE_PADDING) left = x - width - 18;
    if (top + height > window.innerHeight - EDGE_PADDING) top = y - height - 18;
    this.el.style.left = `${Math.max(EDGE_PADDING, left)}px`;
    this.el.style.top = `${Math.max(EDGE_PADDING, top)}px`;
  }

  render(body, kind) {
    const parent = body.parentId ? this.store.get(body.parentId) : null;
    const sunDistanceKm = this.store.heliocentricDistanceKm(body.id);
    const rows = [];

    rows.push(['Diameter', formatDiameter(body.radiusKm)]);
    if (body.type !== 'star') {
      rows.push(['Compared with Earth', `${formatNumber(body.radiusKm / EARTH_RADIUS_KM, 2)}x`]);
    }

    if (body.type === 'moon' && parent) {
      rows.push([`Distance from ${parent.name}`, formatKm(body.distanceKm)]);
      rows.push(['Distance from Sun', formatDistance(sunDistanceKm)]);
    } else if (body.type !== 'star') {
      rows.push(['Distance from Sun', formatDistance(body.distanceKm)]);
    }

    if (body.type !== 'star') {
      rows.push(['Year', formatPeriod(body.orbitalPeriodDays)]);
    }
    rows.push(['Day', formatRotation(body.rotationPeriodHours)]);

    const definitionList = el('dl', { class: 'tooltip__rows' });
    for (const [label, value] of rows) {
      definitionList.appendChild(el('dt', { text: label }));
      definitionList.appendChild(el('dd', { text: value }));
    }

    clear(this.el);
    this.el.appendChild(
      el('div', { class: 'tooltip__head' }, [
        el('span', { class: 'tooltip__dot', style: { background: body.color } }),
        el('span', { class: 'tooltip__name', text: body.name }),
        el('span', { class: 'tooltip__kind', text: KIND_LABEL[body.type] ?? 'Body' }),
      ]),
    );
    this.el.appendChild(definitionList);
    this.el.appendChild(
      el('p', {
        class: 'tooltip__hint',
        text:
          kind === 'orbit'
            ? `Orbital path of ${body.name} - click to edit it`
            : 'Click to open it in the inspector',
      }),
    );
  }

  dispose() {
    this.el.remove();
  }
}
