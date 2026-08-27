/**
 * Mirrors the SystemStore into the Three.js scene graph.
 *
 * This is the only file that knows about both worlds. The store never imports
 * Three.js; the Three.js objects never mutate the store. Everything the user
 * does - drag a slider, add a moon, delete a planet - travels store -> event ->
 * here -> scene, which is why the CRUD operations stay three lines long.
 */

import { Object3D, Vector3 } from 'three';

import { BodyView } from './BodyView.js';
import { updateDayNightUniforms } from './materials.js';

/** Which store keys force which kind of rebuild. */
const GEOMETRY_KEYS = new Set(['radiusKm', 'axialTiltDeg']);
const ORBIT_KEYS = new Set([
  'distanceKm',
  'orbitalPeriodDays',
  'eccentricity',
  'inclinationDeg',
  'ascendingNodeDeg',
  'argPeriapsisDeg',
  'meanAnomalyDeg',
]);
const APPEARANCE_KEYS = new Set(['color', 'textureId', 'surfaceStyle', 'rings', 'atmosphere']);

export class SolarSystemView {
  /**
   * @param {import('../state/SystemStore.js').SystemStore} store
   * @param {object} context { scale, textures }
   */
  constructor(store, context) {
    this.store = store;
    this.context = { ...context, dayNightMaterials: new Set() };
    this.root = new Object3D();
    this.root.name = 'solar-system';
    /** @type {Map<string, BodyView>} */
    this.views = new Map();
    this.pickTargets = [];
    this.hoveredId = null;
    this.orbitsVisible = true;
    this.currentDays = 0;
    this.scratch = new Vector3();

    this.unsubscribes = [
      store.on('add', ({ body }) => this.addBody(body)),
      store.on('update', ({ body, keys }) => this.updateBody(body, keys)),
      store.on('remove', ({ bodies }) => this.removeBodies(bodies)),
      store.on('reset', () => this.rebuildAll()),
      store.on('select', () => this.refreshMarkers()),
    ];

    this.rebuildAll();
  }

  /* ----------------------------------------------------------- lifecycle */

  rebuildAll() {
    for (const view of this.views.values()) view.dispose();
    this.views.clear();
    for (const body of this.store.list()) this.addBody(body, { quiet: true });
    this.refreshPickTargets();
    this.refreshMarkers();
  }

  addBody(body, { quiet = false } = {}) {
    if (this.views.has(body.id)) return this.views.get(body.id);

    // Resolve the parent *before* registering this view, so a self-parenting
    // body from a corrupted file cannot become its own child in the graph.
    const parentView =
      body.parentId && body.parentId !== body.id ? (this.views.get(body.parentId) ?? null) : null;

    const view = new BodyView(body, this.context);
    this.views.set(body.id, view);
    (parentView ? parentView.children : this.root).add(view.anchor);

    view.applyOrbit(body, parentView);
    view.orbit?.setVisible(this.orbitsVisible);
    // Put it where it belongs right away: "Add planet" flies the camera to the
    // new world in the same tick, and a pivot still sitting at the origin would
    // send the camera into the Sun.
    view.updateTransform(this.currentDays);

    if (!quiet) {
      this.refreshPickTargets();
      this.refreshMarkers();
    }
    return view;
  }

  updateBody(body, keys) {
    const view = this.views.get(body.id);
    if (!view) return;
    view.body = body;

    const touched = new Set(keys);
    const geometryChanged = keys.some((key) => GEOMETRY_KEYS.has(key));
    const orbitChanged = keys.some((key) => ORBIT_KEYS.has(key));
    const appearanceChanged = keys.some((key) => APPEARANCE_KEYS.has(key));

    if (geometryChanged) view.applyGeometry(body);
    if (appearanceChanged) view.applyAppearance(body);
    if (touched.has('name')) view.mesh.name = body.name;

    if (geometryChanged || orbitChanged) {
      const parentView = body.parentId ? this.views.get(body.parentId) : null;
      view.applyOrbit(body, parentView);
    }

    // A planet that changed size changes how far out its moons must sit.
    if (geometryChanged) {
      for (const child of this.store.childrenOf(body.id)) {
        this.views.get(child.id)?.applyOrbit(child, view);
      }
    }
  }

  removeBodies(bodies) {
    for (const body of bodies) {
      const view = this.views.get(body.id);
      if (!view) continue;
      view.dispose();
      this.views.delete(body.id);
    }
    this.refreshPickTargets();
    this.refreshMarkers();
  }

  /** Re-derives every scaled quantity, e.g. after switching to true scale. */
  rescale(scale) {
    this.context.scale = scale;
    for (const view of this.views.values()) view.context.scale = scale;
    for (const body of this.store.list()) {
      const view = this.views.get(body.id);
      if (!view) continue;
      view.applyGeometry(body);
      view.applyAppearance(body);
    }
    for (const body of this.store.list()) {
      const view = this.views.get(body.id);
      const parentView = body.parentId ? this.views.get(body.parentId) : null;
      view?.applyOrbit(body, parentView);
    }
  }

  /* -------------------------------------------------------------- runtime */

  /** Advances every body to the given simulation time. */
  update(days, camera) {
    this.currentDays = days;
    for (const view of this.views.values()) {
      view.updateTransform(days);
      view.faceCamera(camera);
    }
    if (this.context.dayNightMaterials.size === 0) return;
    const star = this.views.get(this.store.star()?.id ?? '');
    if (!star) return;
    star.worldPosition(this.scratch);
    updateDayNightUniforms([...this.context.dayNightMaterials], this.scratch, camera);
  }

  /* ----------------------------------------------------------- selection */

  setHovered(id) {
    if (this.hoveredId === id) return;
    this.hoveredId = id;
    this.refreshMarkers();
  }

  refreshMarkers() {
    const selectedId = this.store.selectedId;
    for (const [id, view] of this.views) {
      const state = id === selectedId ? 'selected' : id === this.hoveredId ? 'hover' : 'none';
      view.setMarker(state);
      view.orbit?.setSelected(id === selectedId);
      view.orbit?.setHovered(id === this.hoveredId);
    }
  }

  setOrbitsVisible(visible) {
    this.orbitsVisible = visible;
    for (const view of this.views.values()) view.orbit?.setVisible(visible);
    // A hidden orbit should not be hoverable either.
    this.refreshPickTargets();
  }

  /* --------------------------------------------------------------- picking */

  refreshPickTargets() {
    const targets = [];
    for (const view of this.views.values()) {
      targets.push(view.mesh);
      if (view.orbit && this.orbitsVisible) targets.push(view.orbit.hitMesh);
    }
    this.pickTargets = targets;
  }

  viewOf(id) {
    return this.views.get(id) ?? null;
  }

  /** World position of a body, for the camera and the label overlay. */
  positionOf(id, target = new Vector3()) {
    const view = this.views.get(id);
    if (!view) return target.set(0, 0, 0);
    return view.worldPosition(target);
  }

  dispose() {
    for (const off of this.unsubscribes) off();
    for (const view of this.views.values()) view.dispose();
    this.views.clear();
    this.pickTargets = [];
    this.root.removeFromParent();
  }
}
