/**
 * Assembles the interface and wires it to the application.
 *
 * The UI never touches Three.js directly: it calls the actions the app hands
 * it, and it reads from the store. That separation is what lets the whole panel
 * layout be rebuilt without the simulation noticing.
 */

import { BodyTree } from './BodyTree.js';
import { HelpModal } from './HelpModal.js';
import { Inspector } from './Inspector.js';
import { TimeBar } from './TimeBar.js';
import { Toasts } from './Toasts.js';
import { Tooltip } from './Tooltip.js';
import { button, el } from './dom.js';

const MOBILE_QUERY = '(max-width: 960px)';

export class UIRoot {
  /**
   * @param {object} options
   * @param {HTMLElement} options.container
   * @param {import('../state/SystemStore.js').SystemStore} options.store
   * @param {import('../core/SimulationClock.js').SimulationClock} options.clock
   * @param {import('../config/featureFlags.js').FeatureFlags} options.flags
   * @param {object} options.actions
   */
  constructor({ container, store, clock, flags, actions }) {
    this.container = container;
    this.store = store;
    this.flags = flags;
    this.actions = actions;

    this.tooltip = new Tooltip(store);
    this.toasts = new Toasts();
    this.help = new HelpModal({ flags, actions });

    this.tree = new BodyTree({ store, actions });
    this.inspector = new Inspector({ store, actions });
    this.timeBar = new TimeBar({ clock });

    this.orbitsVisible = true;
    // On a phone both panels start closed so the model itself is what you see.
    this.activePanel = null;

    this.buildTopBar();

    container.appendChild(this.topBar);
    container.appendChild(this.tree.el);
    container.appendChild(this.inspector.el);
    container.appendChild(this.timeBar.el);

    this.mediaQuery = window.matchMedia(MOBILE_QUERY);
    this.onMediaChange = () => this.applyPanelVisibility();
    this.mediaQuery.addEventListener('change', this.onMediaChange);
    this.applyPanelVisibility();

    this.unsubscribeFlags = flags.subscribe(() => this.buildBonusButtons());
    this.buildBonusButtons();

    // Opening the inspector on a phone whenever something is selected.
    store.on('select', ({ id }) => {
      if (id && this.mediaQuery.matches && this.activePanel !== 'inspector') {
        this.showPanel('inspector');
      }
    });
  }

  buildTopBar() {
    this.orbitButton = button({
      label: 'Orbits',
      iconName: 'circle',
      title: 'Show or hide the orbital paths (O)',
      size: 14,
      onClick: () => this.actions.toggleOrbits(),
    });
    this.orbitButton.classList.add('is-active');

    this.bonusSlot = el('span', { class: 'hud-top__actions' });

    this.systemToggle = button({
      label: 'System',
      variant: 'btn--chip panel-toggle',
      onClick: () => this.showPanel('system'),
    });
    this.inspectorToggle = button({
      label: 'Inspector',
      variant: 'btn--chip panel-toggle',
      onClick: () => this.showPanel('inspector'),
    });

    this.topBar = el('header', { class: 'hud-top' }, [
      el('div', { class: 'brand' }, [
        el('h1', { class: 'brand__name', text: 'Orbit' }),
        el('span', {
          class: 'brand__tag',
          text: 'an interactive model of the Solar System',
        }),
      ]),
      el('div', { class: 'hud-top__actions' }, [
        this.systemToggle,
        this.inspectorToggle,
        this.orbitButton,
        this.bonusSlot,
        button({
          iconName: 'help',
          title: 'Help, shortcuts and the bonus lab (?)',
          ariaLabel: 'Help',
          variant: 'btn--icon',
          onClick: () => this.help.toggle(),
        }),
      ]),
    ]);
  }

  /** Bonus features that need a button of their own appear here when enabled. */
  buildBonusButtons() {
    this.bonusSlot.replaceChildren();
    if (this.flags.get('screenshot')) {
      this.bonusSlot.appendChild(
        button({
          iconName: 'camera',
          title: 'Save the current view as a PNG',
          ariaLabel: 'Save a screenshot',
          variant: 'btn--icon',
          onClick: () => this.actions.screenshot(),
        }),
      );
    }
  }

  setOrbitsVisible(visible) {
    this.orbitsVisible = visible;
    this.orbitButton.classList.toggle('is-active', visible);
  }

  /** Tapping the active panel's button again closes it. */
  showPanel(which) {
    this.activePanel = this.activePanel === which ? null : which;
    this.applyPanelVisibility();
  }

  applyPanelVisibility() {
    const mobile = this.mediaQuery.matches;
    this.tree.el.hidden = mobile && this.activePanel !== 'system';
    this.inspector.el.hidden = mobile && this.activePanel !== 'inspector';
    this.systemToggle.classList.toggle('is-active', mobile && this.activePanel === 'system');
    this.inspectorToggle.classList.toggle('is-active', mobile && this.activePanel === 'inspector');
  }

  /* ------------------------------------------------------------- hovering */

  setHover(hit) {
    const body = hit ? this.store.get(hit.id) : null;
    if (!body) {
      this.tooltip.hide();
      this.tree.setHovered(null);
      return;
    }
    this.tooltip.show(body, hit.kind, hit.x, hit.y);
    this.tree.setHovered(body.id);
  }

  /** Hover triggered from the tree rather than the 3D view. */
  setTreeHover(id) {
    this.tree.setHovered(id);
  }

  tick() {
    this.timeBar.tick();
  }

  toast(message, options) {
    return this.toasts.show(message, options);
  }

  dispose() {
    this.mediaQuery.removeEventListener('change', this.onMediaChange);
    this.unsubscribeFlags?.();
    this.help.close();
    this.tooltip.dispose();
    this.toasts.dispose();
    this.tree.dispose();
    this.inspector.dispose();
    this.timeBar.dispose();
    this.topBar.remove();
  }
}
