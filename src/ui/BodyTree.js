/**
 * The left panel: everything in the system, as a tree.
 *
 * Doubles as the "R" of CRUD - it is where you see what exists - and as the
 * launch point for create and delete. Rows re-render as a batch on the next
 * animation frame, so dragging a distance slider does not rebuild the DOM
 * dozens of times a second.
 */

import { button, clear, el } from './dom.js';
import { formatAu, formatDiameter, formatKm } from '../utils/format.js';

export class BodyTree {
  /**
   * @param {object} options
   * @param {import('../state/SystemStore.js').SystemStore} options.store
   * @param {object} options.actions  { select, hover, focus, addPlanet, addMoon, remove, reset }
   */
  constructor({ store, actions }) {
    this.store = store;
    this.actions = actions;
    this.hoveredId = null;
    this.pending = 0;
    this.resortTimer = 0;
    /** @type {Map<string, {row: HTMLElement, name: HTMLElement, meta: HTMLElement, swatch: HTMLElement}>} */
    this.rows = new Map();

    this.list = el('ul', { class: 'tree', role: 'tree', 'aria-label': 'Bodies in the system' });

    this.countBadge = el('span', { class: 'brand__tag' });

    this.el = el('aside', { class: 'panel panel--left', id: 'panel-system' }, [
      el('div', { class: 'panel__head' }, [
        el('h2', { class: 'panel__title', text: 'Solar system' }),
        this.countBadge,
      ]),
      el('div', { class: 'panel__body' }, this.list),
      el('div', { class: 'panel__foot' }, [
        button({
          label: 'Add planet',
          iconName: 'plus',
          variant: 'btn--primary',
          title: 'Create a new planet (A)',
          onClick: () => this.actions.addPlanet(),
        }),
        button({
          label: 'Reset',
          iconName: 'restart',
          title: 'Restore the real Solar System',
          onClick: () => this.actions.reset(),
        }),
      ]),
    ]);

    this.unsubscribes = ['add', 'remove', 'reset'].map((event) =>
      store.on(event, () => this.scheduleRender()),
    );
    // Selection is two class flips. Rebuilding the list would throw away the
    // focused row, which breaks keyboard navigation the moment you use it.
    this.unsubscribes.push(
      store.on('select', ({ id, previous }) => this.markSelected(id, previous)),
      store.on('update', ({ body, keys }) => this.patchRow(body, keys)),
    );
    // An edit only changes one row's text, and rebuilding two dozen rows sixty
    // times a second while a slider is dragged is exactly the kind of jank the
    // brief calls out. Rows are patched in place (see patchRow), and only
    // re-sorted once the drag settles.
    this.render();
  }

  setHovered(id) {
    if (this.hoveredId === id) return;
    const previous = this.hoveredId;
    this.hoveredId = id;
    // Two class flips rather than a full rebuild: hovering fires constantly.
    this.rows.get(previous)?.row.classList.remove('is-hovered');
    this.rows.get(id)?.row.classList.add('is-hovered');
  }

  markSelected(id, previous) {
    const before = this.rows.get(previous)?.row;
    if (before) {
      before.classList.remove('is-selected');
      before.setAttribute('aria-selected', 'false');
    }
    const now = this.rows.get(id)?.row;
    if (now) {
      now.classList.add('is-selected');
      now.setAttribute('aria-selected', 'true');
    }
  }

  /** Applies one body's changed fields to its existing row. */
  patchRow(body, keys) {
    const entry = this.rows.get(body.id);
    if (!entry) {
      this.scheduleRender();
      return;
    }
    if (keys.includes('name')) entry.name.textContent = body.name;
    if (keys.includes('color')) entry.swatch.style.background = body.color;
    entry.meta.textContent = this.metaFor(body);

    // Planets are listed by distance, so a distance edit eventually needs a
    // re-sort - just not on every animation frame of the drag.
    if (keys.includes('distanceKm')) {
      clearTimeout(this.resortTimer);
      this.resortTimer = setTimeout(() => this.render(), 260);
    }
  }

  scheduleRender() {
    if (this.pending) return;
    this.pending = requestAnimationFrame(() => {
      this.pending = 0;
      this.render();
    });
  }

  render() {
    const star = this.store.star();
    clear(this.list);
    this.rows.clear();
    if (!star) return;

    const planets = this.store.planets();
    const moonCount = this.store.moons().length;
    this.countBadge.textContent = `${planets.length} planets · ${moonCount} moons`;

    this.list.appendChild(this.createItem(star, []));
    for (const planet of planets) {
      this.list.appendChild(this.createItem(planet, this.store.childrenOf(planet.id)));
    }
  }

  createItem(body, children) {
    const item = el('li', {
      class: `tree__item tree__item--${body.type}`,
      role: 'none',
    });
    item.appendChild(this.createRow(body));

    if (children.length > 0) {
      const group = el('ul', { class: 'tree__group', role: 'group' });
      for (const child of children) group.appendChild(this.createItem(child, []));
      item.appendChild(group);
    }
    return item;
  }

  createRow(body) {
    const selected = this.store.selectedId === body.id;
    const row = el('div', {
      class: `tree__row${selected ? ' is-selected' : ''}${
        this.hoveredId === body.id ? ' is-hovered' : ''
      }`,
      role: 'treeitem',
      tabindex: '0',
      'aria-selected': String(selected),
      onClick: () => this.actions.select(body.id),
      onDblclick: () => this.actions.focus(body.id),
      onKeydown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.actions.select(body.id);
        }
      },
      onMouseenter: () => this.actions.hover(body.id),
      onMouseleave: () => this.actions.hover(null),
    });

    const swatch = el('span', { class: 'tree__swatch', style: { background: body.color } });
    const name = el('span', { class: 'tree__name', text: body.name });
    const meta = el('span', { class: 'tree__meta', text: this.metaFor(body) });
    row.appendChild(swatch);
    row.appendChild(el('span', { class: 'tree__text' }, [name, meta]));
    this.rows.set(body.id, { row, name, meta, swatch });

    const actions = el('span', { class: 'tree__actions' });
    if (body.type === 'planet') {
      actions.appendChild(
        button({
          iconName: 'moon',
          title: `Add a moon to ${body.name}`,
          ariaLabel: `Add a moon to ${body.name}`,
          size: 15,
          onClick: (event) => {
            event.stopPropagation();
            this.actions.addMoon(body.id);
          },
        }),
      );
    }
    actions.appendChild(
      button({
        iconName: 'target',
        title: `Fly to ${body.name}`,
        ariaLabel: `Fly to ${body.name}`,
        size: 15,
        onClick: (event) => {
          event.stopPropagation();
          this.actions.focus(body.id);
        },
      }),
    );
    if (body.type !== 'star') {
      actions.appendChild(
        button({
          iconName: 'trash',
          title: `Delete ${body.name}`,
          ariaLabel: `Delete ${body.name}`,
          variant: 'btn--danger',
          size: 15,
          onClick: (event) => {
            event.stopPropagation();
            this.actions.remove(body.id);
          },
        }),
      );
    }
    row.appendChild(actions);
    return row;
  }

  metaFor(body) {
    if (body.type === 'star') return formatDiameter(body.radiusKm);
    if (body.type === 'moon') {
      return `${formatKm(body.distanceKm)} out · ${formatDiameter(body.radiusKm)}`;
    }
    return `${formatAu(body.distanceKm)} · ${formatDiameter(body.radiusKm)}`;
  }

  dispose() {
    if (this.pending) cancelAnimationFrame(this.pending);
    clearTimeout(this.resortTimer);
    for (const off of this.unsubscribes) off();
    this.unsubscribes = [];
    this.rows.clear();
    this.el.remove();
  }
}
