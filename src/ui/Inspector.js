/**
 * The right panel: read and edit one body.
 *
 * This is the "U" of CRUD. Every property the brief asks for - name, size,
 * colour, orbital speed and distance from the centre - has both a slider and a
 * typed input here, and edits are applied live: there is no Apply button and no
 * modal, because a ten-year-old should be able to drag Jupiter's size and watch
 * it happen.
 */

import { AU_KM, EARTH_RADIUS_KM } from '../config/scale.js';
import {
  LIMITS,
  SURFACE_STYLES,
  distanceLimitsFor,
  keplerPeriodDays,
  moonPeriodDays,
} from '../state/bodySchema.js';
import { textureOptionsFor } from '../textures/catalogue.js';
import {
  formatAu,
  formatDiameter,
  formatDistance,
  formatKm,
  formatNumber,
  formatPeriod,
  formatRotation,
} from '../utils/format.js';
import { button, clear, el } from './dom.js';
import {
  createColorField,
  createSection,
  createSelectField,
  createSlider,
  createTextField,
  createToggle,
} from './widgets.js';

const KIND_LABEL = { star: 'Star', planet: 'Planet', moon: 'Moon' };

export class Inspector {
  /**
   * @param {object} options
   * @param {import('../state/SystemStore.js').SystemStore} options.store
   * @param {object} options.actions { update, remove, duplicate, focus }
   */
  constructor({ store, actions }) {
    this.store = store;
    this.actions = actions;
    this.controls = null;
    this.currentId = null;
    this.headerNodes = null;
    this.statNodes = null;
    /** Which sections the user has open, remembered across rebuilds. */
    this.sectionState = new Map([
      ['Identity', true],
      ['Size', true],
      ['Orbit', true],
    ]);

    this.body = el('div', { class: 'panel__body' });
    this.el = el('aside', { class: 'panel panel--right', id: 'panel-inspector' }, [
      el('div', { class: 'panel__head' }, [
        el('h2', { class: 'panel__title', text: 'Inspector' }),
      ]),
      this.body,
    ]);

    this.unsubscribes = [
      store.on('select', () => this.render()),
      store.on('reset', () => this.render()),
      store.on('remove', () => this.render()),
      store.on('update', ({ body }) => {
        if (body.id === this.currentId) this.sync(body);
      }),
    ];

    this.render();
  }

  patch(patch) {
    if (!this.currentId) return;
    this.actions.update(this.currentId, patch);
  }

  /** createSection, wired to the remembered open/closed state. */
  section(title, children, defaultOpen = false) {
    return createSection({
      title,
      open: this.sectionState.get(title) ?? defaultOpen,
      children,
      onToggle: (open) => this.sectionState.set(title, open),
    });
  }

  render() {
    const body = this.store.selected;
    this.currentId = body?.id ?? null;
    this.controls = null;
    this.headerNodes = null;
    this.statNodes = null;
    clear(this.body);

    if (!body) {
      this.body.appendChild(
        el('p', {
          class: 'inspector__empty',
          text: 'Nothing selected. Click a planet, a moon or an orbit in the view - or pick one from the list on the left.',
        }),
      );
      return;
    }

    this.body.appendChild(this.createHeader(body));
    this.body.appendChild(this.createStats(body));
    this.body.appendChild(this.createQuickActions(body));

    const controls = {};
    this.controls = controls;

    /* ------------------------------------------------------------ identity */
    controls.name = createTextField({
      label: 'Name',
      value: body.name,
      onInput: (value) => this.patch({ name: value }),
    });
    controls.color = createColorField({
      label: 'Colour',
      value: body.color,
      onInput: (value) => this.patch({ color: value }),
    });

    // With a photographic surface the colour is a tint rather than the whole
    // story, so say so instead of letting it look like a dead control.
    this.colorNote = el('p', {
      class: 'field__note',
      text: 'Tints the photographic map. Set Surface to "Painted from colour" for the full effect.',
    });
    this.colorNote.hidden = !body.textureId;

    const identity = this.section(
      'Identity',
      [controls.name.el, controls.color.el, this.colorNote],
      true,
    );

    /* ---------------------------------------------------------------- size */
    const radiusLimits = body.type === 'star' ? LIMITS.starRadiusKm : LIMITS.radiusKm;
    controls.radius = createSlider({
      label: 'Size (diameter)',
      min: radiusLimits.min,
      max: radiusLimits.max,
      value: body.radiusKm,
      log: true,
      unit: 'km',
      displayDigits: 5,
      toDisplay: (km) => km * 2,
      fromDisplay: (km) => km / 2,
      note: (km) => `${formatDiameter(km)} · ${formatNumber(km / EARTH_RADIUS_KM, 2)}x Earth`,
      onInput: (km) => this.patch({ radiusKm: km }),
    });

    const sizeChildren = [controls.radius.el];

    /* --------------------------------------------------------------- orbit */
    let orbitSection = null;
    if (body.type !== 'star') {
      const parent = this.store.get(body.parentId);
      const isMoon = body.type === 'moon';
      const distanceLimits = distanceLimitsFor(body.type);

      controls.distance = createSlider({
        label: isMoon ? `Distance from ${parent?.name ?? 'planet'}` : 'Distance from the Sun',
        min: distanceLimits.min,
        max: distanceLimits.max,
        value: body.distanceKm,
        log: true,
        unit: isMoon ? 'km' : 'AU',
        displayDigits: isMoon ? 6 : 4,
        toDisplay: (km) => (isMoon ? km : km / AU_KM),
        fromDisplay: (value) => (isMoon ? value : value * AU_KM),
        note: (km) => (isMoon ? formatKm(km) : formatDistance(km)),
        onInput: (km) => this.patch({ distanceKm: km }),
      });

      controls.period = createSlider({
        label: 'Orbital speed (year length)',
        min: LIMITS.orbitalPeriodDays.min,
        max: LIMITS.orbitalPeriodDays.max,
        value: Math.abs(body.orbitalPeriodDays),
        log: true,
        unit: 'days',
        displayDigits: 5,
        note: (days) => `${formatPeriod(days)} to go once round`,
        // The sign is read live, not from the snapshot this closure was built
        // with, or toggling "orbit backwards" and then dragging would undo it.
        onInput: (days) =>
          this.patch({
            orbitalPeriodDays: days * Math.sign(this.currentBody()?.orbitalPeriodDays || 1),
          }),
      });

      controls.retrograde = createToggle({
        label: 'Orbit backwards',
        hint: 'Retrograde, the way Triton goes round Neptune',
        checked: body.orbitalPeriodDays < 0,
        onChange: (checked) => {
          const magnitude = Math.abs(this.currentBody()?.orbitalPeriodDays ?? 365);
          this.patch({ orbitalPeriodDays: checked ? -magnitude : magnitude });
        },
      });

      const keplerButton = button({
        label: "Match Kepler's law",
        iconName: 'restart',
        title:
          'Set the year length that this distance would really produce (Kepler’s third law)',
        onClick: () => {
          const current = this.currentBody();
          if (!current) return;
          const parentBody = this.store.get(current.parentId);
          const days =
            current.type === 'moon'
              ? moonPeriodDays(current.distanceKm, parentBody?.radiusKm ?? EARTH_RADIUS_KM)
              : keplerPeriodDays(current.distanceKm);
          this.patch({
            orbitalPeriodDays: days * Math.sign(current.orbitalPeriodDays || 1),
          });
        },
      });

      orbitSection = this.section(
        'Orbit',
        [
          controls.distance.el,
          controls.period.el,
          el('div', { class: 'inline-actions' }, keplerButton),
          controls.retrograde.el,
        ],
        true,
      );
    }

    /* ---------------------------------------------------------------- spin */
    controls.rotation = createSlider({
      label: 'Day length',
      min: LIMITS.rotationPeriodHours.min,
      max: LIMITS.rotationPeriodHours.max,
      value: Math.abs(body.rotationPeriodHours),
      log: true,
      unit: 'h',
      displayDigits: 5,
      note: (hours) => `One full turn every ${formatRotation(hours)}`,
      onInput: (hours) =>
        this.patch({
          rotationPeriodHours: hours * Math.sign(this.currentBody()?.rotationPeriodHours || 1),
        }),
    });
    controls.spinBackwards = createToggle({
      label: 'Spin backwards',
      hint: 'Venus and Uranus both do',
      checked: body.rotationPeriodHours < 0,
      onChange: (checked) => {
        const magnitude = Math.abs(this.currentBody()?.rotationPeriodHours ?? 24);
        this.patch({ rotationPeriodHours: checked ? -magnitude : magnitude });
      },
    });
    controls.tilt = createSlider({
      label: 'Axial tilt',
      min: LIMITS.axialTiltDeg.min,
      max: LIMITS.axialTiltDeg.max,
      value: body.axialTiltDeg,
      step: 0.1,
      unit: '°',
      displayDigits: 4,
      note: (deg) =>
        deg < 5
          ? 'Upright: almost no seasons'
          : deg > 120
            ? 'Tipped right over'
            : 'A tilt like this is what creates seasons',
      onInput: (deg) => this.patch({ axialTiltDeg: deg }),
    });

    const spinSection = this.section('Spin', [
      controls.rotation.el,
      controls.spinBackwards.el,
      controls.tilt.el,
    ]);

    /* ------------------------------------------------------- orbit shape */
    let shapeSection = null;
    if (body.type !== 'star') {
      controls.eccentricity = createSlider({
        label: 'Eccentricity',
        min: LIMITS.eccentricity.min,
        max: LIMITS.eccentricity.max,
        value: body.eccentricity,
        step: 0.001,
        displayDigits: 3,
        note: (e) =>
          e < 0.02
            ? 'A near perfect circle'
            : `Squashed ellipse - it speeds up near the ${formatNumber(e * 100, 0)}% mark`,
        onInput: (value) => this.patch({ eccentricity: value }),
      });
      controls.inclination = createSlider({
        label: 'Orbit tilt',
        min: LIMITS.inclinationDeg.min,
        max: LIMITS.inclinationDeg.max,
        value: body.inclinationDeg,
        step: 0.1,
        unit: '°',
        displayDigits: 4,
        note: () => 'How far the orbit leans out of the flat plane',
        onInput: (value) => this.patch({ inclinationDeg: value }),
      });
      controls.meanAnomaly = createSlider({
        label: 'Starting position',
        min: 0,
        max: 360,
        value: body.meanAnomalyDeg,
        step: 1,
        unit: '°',
        displayDigits: 3,
        note: () => 'Where along the orbit it sits at day zero',
        onInput: (value) => this.patch({ meanAnomalyDeg: value }),
      });
      shapeSection = this.section('Orbit shape', [
        controls.eccentricity.el,
        controls.inclination.el,
        controls.meanAnomaly.el,
      ]);
    }

    /* ------------------------------------------------------------ surface */
    controls.texture = createSelectField({
      label: 'Surface',
      value: body.textureId ?? '',
      options: textureOptionsFor(body.type),
      onInput: (value) => this.patch({ textureId: value || null }),
    });
    controls.style = createSelectField({
      label: 'Painted style',
      value: body.surfaceStyle,
      // "Star" is only offered to a star - and must be, or the Sun's dropdown
      // would render blank and lose its own style the moment it was touched.
      options: SURFACE_STYLES.filter((style) => style.id !== 'star' || body.type === 'star'),
      onInput: (value) => this.patch({ surfaceStyle: value }),
    });
    controls.style.el.hidden = Boolean(body.textureId);

    const surfaceChildren = [controls.texture.el, controls.style.el];

    if (body.type !== 'star') {
      controls.hasRings = createToggle({
        label: 'Rings',
        hint: 'A disc of ice and rock, like Saturn',
        checked: Boolean(body.rings),
        onChange: (checked) => {
          const current = this.currentBody();
          if (!current) return;
          this.patch({
            rings: checked
              ? {
                  innerKm: current.radiusKm * 1.35,
                  outerKm: current.radiusKm * 2.3,
                  color: '#d8d0be',
                  opacity: 0.8,
                  textureId: null,
                }
              : null,
          });
        },
      });
      surfaceChildren.push(controls.hasRings.el);

      if (body.rings) {
        controls.ringInner = createSlider({
          label: 'Ring inner edge',
          min: body.radiusKm * 1.05,
          max: body.radiusKm * 6,
          value: body.rings.innerKm,
          displayDigits: 5,
          unit: 'km',
          note: (km) => formatKm(km),
          onInput: (km) => this.patch({ rings: { ...this.currentBody().rings, innerKm: km } }),
        });
        controls.ringOuter = createSlider({
          label: 'Ring outer edge',
          min: body.radiusKm * 1.05,
          max: body.radiusKm * 8,
          value: body.rings.outerKm,
          displayDigits: 5,
          unit: 'km',
          note: (km) => formatKm(km),
          onInput: (km) => this.patch({ rings: { ...this.currentBody().rings, outerKm: km } }),
        });
        controls.ringColor = createColorField({
          label: 'Ring colour',
          value: body.rings.color,
          onInput: (value) => this.patch({ rings: { ...this.currentBody().rings, color: value } }),
        });
        surfaceChildren.push(controls.ringInner.el, controls.ringOuter.el, controls.ringColor.el);
      }
    }

    const surfaceSection = this.section('Surface', surfaceChildren);

    /* -------------------------------------------------------------- about */
    const factSection = this.section('About', [
      el('p', {
        class: 'inspector__fact',
        text: body.description || 'No notes yet. Every world deserves a story.',
      }),
    ]);

    const sizeSection = this.section('Size', sizeChildren, true);

    this.body.appendChild(identity.el);
    this.body.appendChild(sizeSection.el);
    if (orbitSection) this.body.appendChild(orbitSection.el);
    if (shapeSection) this.body.appendChild(shapeSection.el);
    this.body.appendChild(spinSection.el);
    this.body.appendChild(surfaceSection.el);
    this.body.appendChild(factSection.el);
  }

  currentBody() {
    return this.currentId ? this.store.get(this.currentId) : null;
  }

  /**
   * The header and the stat tiles are rebuilt once per selection and then
   * patched in place, because they refresh on every frame of a slider drag.
   */
  createHeader(body) {
    this.headerNodes = {
      dot: el('span', { class: 'inspector__dot' }),
      name: el('div', { class: 'inspector__name' }),
      kind: el('div', { class: 'inspector__kind' }),
    };
    const node = el('div', { class: 'inspector__head' }, [
      this.headerNodes.dot,
      el('div', { class: 'inspector__titles' }, [
        this.headerNodes.name,
        this.headerNodes.kind,
      ]),
    ]);
    this.updateHeader(body);
    return node;
  }

  updateHeader(body) {
    const nodes = this.headerNodes;
    if (!nodes) return;
    nodes.dot.style.background = body.color;
    nodes.dot.style.color = body.color;
    nodes.name.textContent = body.name;
    nodes.kind.textContent = KIND_LABEL[body.type] ?? 'Body';
  }

  createStats(body) {
    const labels = [
      'Diameter',
      body.type === 'star' ? 'Bodies orbiting' : 'From the Sun',
      body.type === 'star' ? 'Spin' : 'Year',
      body.type === 'star' ? 'Axial tilt' : 'Day',
    ];
    this.statNodes = labels.map(() => el('span', { class: 'stat__value' }));
    const node = el(
      'div',
      { class: 'stat-grid' },
      labels.map((label, index) =>
        el('div', { class: 'stat' }, [
          el('span', { class: 'stat__label', text: label }),
          this.statNodes[index],
        ]),
      ),
    );
    this.updateStats(body);
    return node;
  }

  updateStats(body) {
    if (!this.statNodes) return;
    const isStar = body.type === 'star';
    const values = [
      formatDiameter(body.radiusKm),
      isStar
        ? String(this.store.childrenOf(body.id).length)
        : formatAu(this.store.heliocentricDistanceKm(body.id)),
      isStar ? formatRotation(body.rotationPeriodHours) : formatPeriod(body.orbitalPeriodDays),
      isStar
        ? `${formatNumber(body.axialTiltDeg, 2)}°`
        : formatRotation(body.rotationPeriodHours),
    ];
    for (let i = 0; i < this.statNodes.length; i += 1) {
      const node = this.statNodes[i];
      if (node.textContent === values[i]) continue;
      node.textContent = values[i];
      node.title = values[i];
    }
  }

  createQuickActions(body) {
    const actions = el('div', { class: 'inline-actions' }, [
      button({
        label: 'Fly to',
        iconName: 'target',
        title: `Move the camera to ${body.name} (F)`,
        onClick: () => this.actions.focus(body.id),
      }),
    ]);
    if (body.type === 'planet') {
      actions.appendChild(
        button({
          label: 'Add moon',
          iconName: 'moon',
          onClick: () => this.actions.addMoon(body.id),
        }),
      );
    }
    if (body.type !== 'star') {
      actions.appendChild(
        button({
          label: 'Duplicate',
          iconName: 'plus',
          onClick: () => this.actions.duplicate(body.id),
        }),
      );
      actions.appendChild(
        button({
          label: 'Delete',
          iconName: 'trash',
          variant: 'btn--danger',
          onClick: () => this.actions.remove(body.id),
        }),
      );
    }
    return actions;
  }

  /** Pushes external changes back into the controls without rebuilding them. */
  sync(body) {
    const controls = this.controls;
    if (!controls) return;
    controls.name?.set(body.name);
    controls.color?.set(body.color);
    controls.radius?.set(body.radiusKm);
    controls.distance?.set(body.distanceKm);
    controls.period?.set(Math.abs(body.orbitalPeriodDays));
    controls.retrograde?.set(body.orbitalPeriodDays < 0);
    controls.rotation?.set(Math.abs(body.rotationPeriodHours));
    controls.spinBackwards?.set(body.rotationPeriodHours < 0);
    controls.tilt?.set(body.axialTiltDeg);
    controls.eccentricity?.set(body.eccentricity);
    controls.inclination?.set(body.inclinationDeg);
    controls.meanAnomaly?.set(body.meanAnomalyDeg);
    controls.texture?.set(body.textureId ?? '');
    controls.style?.set(body.surfaceStyle);
    if (controls.style) controls.style.el.hidden = Boolean(body.textureId);
    if (this.colorNote) this.colorNote.hidden = !body.textureId;

    const hadRings = Boolean(controls.ringInner);
    if (hadRings !== Boolean(body.rings)) {
      // Rings appearing or disappearing changes which controls exist.
      this.render();
      return;
    }
    controls.ringInner?.set(body.rings?.innerKm ?? 0);
    controls.ringOuter?.set(body.rings?.outerKm ?? 0);
    controls.ringColor?.set(body.rings?.color ?? '#d8d0be');

    this.updateHeader(body);
    this.updateStats(body);
  }

  dispose() {
    for (const off of this.unsubscribes) off();
    this.unsubscribes = [];
    this.el.remove();
  }
}
