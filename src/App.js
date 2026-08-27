/**
 * The composition root.
 *
 * Creates every subsystem, wires the actions the interface calls, owns the
 * frame loop and nothing else. Read this file first: it is the map of the
 * project.
 *
 *   store        plain data - what exists in the system
 *   clock        simulated time and its speed
 *   sceneManager renderer, camera, controls, lights
 *   system       store -> Three.js scene graph
 *   picker       pointer -> body or orbit under the cursor
 *   ui           panels, tooltip, time bar
 *   bonus        optional extras, all behind feature flags
 */

import { BonusManager } from './bonus/index.js';
import { DEFAULT_SCALE_MODE, createScale } from './config/scale.js';
import { FeatureFlags } from './config/featureFlags.js';
import { SceneManager } from './core/SceneManager.js';
import { SimulationClock } from './core/SimulationClock.js';
import { Picker } from './interaction/Picker.js';
import { SolarSystemView } from './objects/SolarSystemView.js';
import { SystemStore } from './state/SystemStore.js';
import { moonTemplate, planetTemplate } from './state/bodySchema.js';
import {
  attachAutosave,
  clearSavedSystem,
  exportSystem,
  importSystem,
  loadSavedSystem,
} from './state/persistence.js';
import { TextureLibrary } from './textures/TextureLibrary.js';
import { UIRoot } from './ui/UIRoot.js';

/** Elements that own their own keyboard behaviour. */
const INTERACTIVE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'OPTION', 'A']);

export class App {
  constructor({ canvas, uiContainer }) {
    this.canvas = canvas;

    this.flags = new FeatureFlags();
    this.scaleMode = this.flags.get('trueScale') ? 'true' : DEFAULT_SCALE_MODE;
    this.scale = createScale(this.scaleMode);

    this.store = new SystemStore(loadSavedSystem() ?? undefined);
    this.clock = new SimulationClock();

    this.sceneManager = new SceneManager({ canvas, scale: this.scale });
    this.textures = new TextureLibrary(this.sceneManager.renderer);
    this.sceneManager.addStarfield(this.textures.starfield());

    this.system = new SolarSystemView(this.store, {
      scale: this.scale,
      textures: this.textures,
    });
    this.sceneManager.scene.add(this.system.root);

    this.picker = new Picker({
      domElement: this.sceneManager.renderer.domElement,
      camera: this.sceneManager.camera,
      system: this.system,
      onHover: (hit) => this.handleHover(hit),
      onSelect: (id) => this.store.select(id),
    });

    this.ui = new UIRoot({
      container: uiContainer,
      store: this.store,
      clock: this.clock,
      flags: this.flags,
      actions: this.createActions(),
    });

    this.bonus = new BonusManager({
      flags: this.flags,
      deps: {
        scene: this.sceneManager.scene,
        camera: this.sceneManager.camera,
        canvas,
        renderer: this.sceneManager.renderer,
        sceneManager: this.sceneManager,
        system: this.system,
        store: this.store,
        scale: this.scale,
        textures: this.textures,
      },
      onTrueScale: (enabled) => this.setScaleMode(enabled ? 'true' : DEFAULT_SCALE_MODE),
    });

    this.autosave = attachAutosave(this.store);
    this.followId = null;
    // Following a body that no longer exists would pin the camera on the
    // origin and make panning impossible, so the view has to still be there.
    this.sceneManager.followProvider = () =>
      this.followId && this.system.viewOf(this.followId)
        ? this.system.positionOf(this.followId)
        : null;
    // A reset or an import replaces every body: whatever we were following is
    // not the same object any more.
    this.store.on('reset', () => {
      this.followId = null;
    });

    for (const event of ['add', 'remove', 'reset']) {
      this.store.on(event, () => {
        this.bonus.refresh();
        this.updateCameraRange();
      });
    }
    this.store.on('update', ({ keys }) => {
      if (keys.includes('distanceKm')) this.updateCameraRange();
    });
    this.updateCameraRange();

    this.onKeyDown = this.onKeyDown.bind(this);
    window.addEventListener('keydown', this.onKeyDown);

    this.sceneManager.onFrame((dt) => this.tick(dt));
  }

  start() {
    this.sceneManager.start();
  }

  /* --------------------------------------------------------------- actions */

  createActions() {
    return {
      select: (id) => this.store.select(id),
      hover: (id) => {
        this.system.setHovered(id);
        this.ui?.setTreeHover(id);
      },
      focus: (id) => this.focus(id),
      addPlanet: () => this.addPlanet(),
      addMoon: (parentId) => this.addMoon(parentId),
      remove: (id) => this.remove(id),
      duplicate: (id) => this.duplicate(id),
      update: (id, patch) => this.store.update(id, patch),
      reset: () => this.reset(),
      toggleOrbits: () => this.toggleOrbits(),
      screenshot: () => this.sceneManager.screenshot(`orbit-${Date.now()}.png`),
      exportSystem: () => exportSystem(this.store),
      importSystem: () => this.importSystem(),
    };
  }

  addPlanet() {
    const body = this.store.add(planetTemplate(this.store.list()));
    if (!body) return null;
    this.store.select(body.id);
    this.focus(body.id);
    this.ui.toast(`${body.name} created - it is yours to shape.`);
    return body;
  }

  addMoon(parentId) {
    const parent = this.store.get(parentId);
    if (!parent || parent.type !== 'planet') return null;
    const body = this.store.add(moonTemplate(parent, this.store.childrenOf(parentId)));
    if (!body) return null;
    this.store.select(body.id);
    this.ui.toast(`${body.name} now orbits ${parent.name}.`);
    return body;
  }

  duplicate(id) {
    const source = this.store.get(id);
    if (!source || source.type === 'star') return null;
    const copy = this.store.add({
      ...source,
      id: undefined,
      name: `${source.name} copy`,
      distanceKm: source.distanceKm * 1.18,
      meanAnomalyDeg: (source.meanAnomalyDeg + 40) % 360,
      builtIn: false,
    });
    if (copy) this.store.select(copy.id);
    return copy;
  }

  remove(id) {
    const body = this.store.get(id);
    if (!body || body.type === 'star') return;
    const removed = this.store.remove(id);
    if (removed.length === 0) return;
    if (this.followId && removed.some((item) => item.id === this.followId)) this.followId = null;

    // Undo is only meaningful for the system these bodies were deleted from:
    // after a reset or an import they would be strangers here.
    const generation = this.store.generation;
    const extra = removed.length > 1 ? ` and ${removed.length - 1} moon(s)` : '';
    this.ui.toast(`Deleted ${body.name}${extra}.`, {
      actionLabel: 'Undo',
      onAction: () => {
        if (this.store.generation !== generation) {
          this.ui.toast('That system has been replaced, so there is nothing to undo.');
          return;
        }
        if (this.store.restore(removed) === 0) {
          this.ui.toast(`${body.name} cannot come back: what it orbited is gone too.`);
          return;
        }
        this.store.select(body.id);
      },
    });
  }

  reset() {
    this.store.reset();
    clearSavedSystem();
    this.clock.reset();
    this.sceneManager.frameCamera(this.scale.defaultCameraDistance);
    this.followId = null;
    this.ui.toast('Back to the real Solar System.');
  }

  async importSystem() {
    const bodies = await importSystem();
    if (!bodies) {
      this.ui.toast('That file did not contain a system Orbit could read.');
      return;
    }
    const result = this.store.load(bodies);
    if (!result.ok) {
      this.ui.toast('That file has no star in it, so the real Solar System was restored instead.');
      return;
    }
    this.ui.toast(`Loaded ${result.count} bodies.`);
  }

  toggleOrbits() {
    const next = !this.system.orbitsVisible;
    this.system.setOrbitsVisible(next);
    this.ui.setOrbitsVisible(next);
  }

  focus(id) {
    const view = this.system.viewOf(id);
    if (!view) return;
    this.followId = id;
    this.sceneManager.flyTo(view.worldPosition(), view.radiusUnits);
  }

  /**
   * Keeps the zoom-out limit ahead of the outermost body, so a planet dragged
   * to 200 AU can still be brought into frame.
   */
  updateCameraRange() {
    const furthest = this.store
      .planets()
      .reduce((max, body) => Math.max(max, body.distanceKm), 0);
    const needed = this.scale.orbitDistance(furthest) * 1.9;
    this.sceneManager.controls.maxDistance = Math.max(this.scale.maxCameraDistance, needed);
  }

  /** Switches between the classroom scale and the honest one. */
  setScaleMode(mode) {
    if (mode === this.scaleMode) return;
    this.scaleMode = mode;
    this.scale = createScale(mode);
    this.system.rescale(this.scale);
    this.sceneManager.applyScale(this.scale);
    this.bonus?.rescale(this.scale);
    this.updateCameraRange();
    this.followId = null;
    this.ui?.toast(
      mode === 'true'
        ? 'True scale: sizes and distances now share one scale. Look how empty it is.'
        : 'Back to classroom scale.',
    );
  }

  /* ---------------------------------------------------------------- events */

  handleHover(hit) {
    this.system.setHovered(hit?.id ?? null);
    this.ui?.setHover(hit);
  }

  onKeyDown(event) {
    // Never steal a key from a control that has its own meaning for it: typing
    // in a field, choosing in a dropdown, or pressing Space on a focused
    // button. And never fire a shortcut behind an open dialog.
    const target = event.target;
    const busy =
      (target instanceof HTMLElement &&
        (INTERACTIVE_TAGS.has(target.tagName) || target.isContentEditable)) ||
      this.ui?.help?.isOpen === true;
    if (busy || event.metaKey || event.ctrlKey || event.altKey) return;

    switch (event.key) {
      case ' ':
        event.preventDefault();
        this.clock.toggle();
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.clock.multiplySpeed(2);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.clock.multiplySpeed(0.5);
        break;
      case 'r':
      case 'R':
        this.clock.reverse();
        break;
      case 'a':
      case 'A':
        this.addPlanet();
        break;
      case 'f':
      case 'F':
        if (this.store.selectedId) this.focus(this.store.selectedId);
        break;
      case 'o':
      case 'O':
        this.toggleOrbits();
        break;
      case 'Escape':
        this.store.select(null);
        this.followId = null;
        break;
      case 'Delete':
      case 'Backspace':
        if (this.store.selectedId) this.remove(this.store.selectedId);
        break;
      case '?':
      case '/':
        this.ui.help.toggle();
        break;
      default:
        break;
    }
  }

  /* ------------------------------------------------------------------ loop */

  tick(dt) {
    this.clock.advance(dt);
    this.system.update(this.clock.days, this.sceneManager.camera);

    // Picking reads world matrices, so make sure they reflect this frame.
    this.sceneManager.scene.updateMatrixWorld();
    this.picker.update();

    this.bonus.update(dt, this.clock.days);
    this.ui.tick();
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    this.autosave.detach();
    this.bonus.dispose();
    this.ui.dispose();
    this.picker.dispose();
    this.system.dispose();
    this.textures.dispose();
    this.sceneManager.dispose();
  }
}
