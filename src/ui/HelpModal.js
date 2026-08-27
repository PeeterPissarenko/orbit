/**
 * The help / settings dialog.
 *
 * Also the home of the "Bonus lab", which is deliberately a separate, clearly
 * labelled place: everything in it is off by default and none of it changes how
 * the core simulation behaves.
 */

import { BONUS_FEATURES } from '../config/featureFlags.js';
import { button, el } from './dom.js';
import { createToggle } from './widgets.js';

const SHORTCUTS = [
  [['Space'], 'Start / stop time'],
  [['←', '→'], 'Slow down / speed up'],
  [['R'], 'Run time backwards'],
  [['A'], 'Add a planet'],
  [['F'], 'Fly to the selected body'],
  [['O'], 'Show or hide orbit paths'],
  [['Esc'], 'Clear the selection'],
  [['Del'], 'Delete the selected body'],
  [['?'], 'Open this dialog'],
];

export class HelpModal {
  /**
   * @param {object} options
   * @param {import('../config/featureFlags.js').FeatureFlags} options.flags
   * @param {object} options.actions { exportSystem, importSystem }
   */
  constructor({ flags, actions }) {
    this.flags = flags;
    this.actions = actions;
    this.backdrop = null;
    this.onKeyDown = this.onKeyDown.bind(this);
  }

  get isOpen() {
    return Boolean(this.backdrop);
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  open() {
    if (this.backdrop) return;

    const closeButton = button({
      iconName: 'close',
      title: 'Close',
      ariaLabel: 'Close',
      variant: 'btn--icon btn--ghost',
      onClick: () => this.close(),
    });

    const bonusToggles = BONUS_FEATURES.map(
      (feature) =>
        createToggle({
          label: feature.label,
          hint: feature.description,
          checked: this.flags.get(feature.id),
          onChange: (checked) => this.flags.set(feature.id, checked),
        }).el,
    );

    const keyList = el('dl', { class: 'keys' });
    for (const [keys, description] of SHORTCUTS) {
      keyList.appendChild(
        el(
          'dt',
          {},
          keys.map((key) => el('kbd', { text: key })),
        ),
      );
      keyList.appendChild(el('dd', { text: description }));
    }

    const modal = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, [
      el('div', { class: 'modal__head' }, [
        el('h2', { class: 'modal__title', text: 'Orbit - how it works' }),
        closeButton,
      ]),
      el('div', { class: 'modal__body' }, [
        el('h3', { text: 'Getting around' }),
        el('p', {
          text: 'Drag to turn the view, scroll to zoom, right-drag to pan. Hover any planet or its orbital path to read its numbers, and click it to open it in the inspector on the right.',
        }),
        el('p', {
          text: 'Everything in the inspector is live: change a size, a colour, a distance or a year length and the model updates as you drag. Add planets with the button under the list, and give any planet a moon with the small moon button on its row.',
        }),

        el('h3', { text: 'How things are scaled' }),
        el('p', {
          text: 'Sizes and distances each use their own linear scale, so proportions stay exact within each group: Jupiter really is 11 times wider than Earth here, and Neptune really is 30 times further from the Sun than Earth is. Sharing one scale would leave Earth smaller than a pixel.',
        }),
        el('p', {
          text: 'Two things are compressed further on purpose. The Sun is drawn about six times smaller again, or it would swallow Mercury’s orbit; and moon orbits are measured in planet radii and squeezed, or Io would sit inside Jupiter. Turn on True-scale mode in the Bonus lab to see the completely honest version - the planets become specks, which is the point.',
        }),

        el('h3', { text: 'Keyboard' }),
        keyList,

        el('h3', { text: 'Your system' }),
        el('p', {
          text: 'Changes save themselves in this browser. You can also export the whole system as a JSON file and load it on another computer.',
        }),
        el('div', { class: 'inline-actions' }, [
          button({
            label: 'Export as JSON',
            iconName: 'save',
            onClick: () => this.actions.exportSystem(),
          }),
          button({
            label: 'Import JSON',
            iconName: 'upload',
            onClick: () => this.actions.importSystem(),
          }),
        ]),

        el('h3', { text: 'Bonus lab' }),
        el('p', {
          class: 'bonus-note',
          text: 'Everything below is extra. It is off by default and none of it changes how the core simulation behaves. You can also switch these on from the address bar, for example ?bonus=labels,trails or ?bonus=all.',
        }),
        ...bonusToggles,

        el('h3', { text: 'Credits' }),
        el('p', {
          text: 'Planet, moon and star maps: Solar System Scope (solarsystemscope.com/textures), CC BY 4.0, based on NASA imagery. Orbital elements and physical data: NASA/JPL planetary fact sheets. Rendering: three.js.',
        }),
      ]),
    ]);

    this.backdrop = el('div', {
      class: 'modal-backdrop',
      onClick: (event) => {
        if (event.target === this.backdrop) this.close();
      },
    });
    this.backdrop.appendChild(modal);
    document.body.appendChild(this.backdrop);
    document.addEventListener('keydown', this.onKeyDown);
    closeButton.focus();
  }

  onKeyDown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.close();
    }
  }

  close() {
    if (!this.backdrop) return;
    document.removeEventListener('keydown', this.onKeyDown);
    this.backdrop.remove();
    this.backdrop = null;
  }
}
