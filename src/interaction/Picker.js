/**
 * Mouse and touch picking.
 *
 * Raycasting runs at most once per rendered frame, no matter how many pointer
 * events arrive, which keeps hovering smooth even on a trackpad that fires
 * events faster than the display refreshes.
 *
 * Two kinds of thing are pickable: the body meshes themselves and the invisible
 * tubes that follow each orbit (see OrbitPathView), which is what makes
 * "hover over a planet *or its orbit*" work.
 */

import { Raycaster, Vector2 } from 'three';

const CLICK_SLOP_PX = 5;

/** How much further away a body may be than an orbit and still win the pick. */
const BODY_PRIORITY = 1.6;

/** Frames between re-tests while the pointer rests on something. */
const RECHECK_FRAMES = 5;

export class Picker {
  /**
   * @param {object} options
   * @param {HTMLCanvasElement} options.domElement
   * @param {import('three').Camera} options.camera
   * @param {import('../objects/SolarSystemView.js').SolarSystemView} options.system
   * @param {(hit: {id: string, kind: string, x: number, y: number}|null) => void} options.onHover
   * @param {(id: string|null) => void} options.onSelect
   */
  constructor({ domElement, camera, system, onHover, onSelect }) {
    this.domElement = domElement;
    this.camera = camera;
    this.system = system;
    this.onHover = onHover;
    this.onSelect = onSelect;

    this.raycaster = new Raycaster();
    this.pointer = new Vector2();
    this.screen = { x: 0, y: 0 };
    this.hasPointer = false;
    this.dirty = false;
    this.enabled = true;
    this.currentHit = null;
    this.pointerDownAt = null;
    this.sinceRecheck = 0;

    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerLeave = this.onPointerLeave.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);

    domElement.addEventListener('pointermove', this.onPointerMove, { passive: true });
    domElement.addEventListener('pointerleave', this.onPointerLeave, { passive: true });
    domElement.addEventListener('pointerdown', this.onPointerDown, { passive: true });
    domElement.addEventListener('pointerup', this.onPointerUp, { passive: true });
  }

  onPointerMove(event) {
    this.updatePointer(event);
    this.dirty = true;
  }

  onPointerLeave() {
    this.hasPointer = false;
    this.dirty = false;
    this.setHit(null);
  }

  onPointerDown(event) {
    this.pointerDownAt = { x: event.clientX, y: event.clientY };
  }

  onPointerUp(event) {
    if (!this.pointerDownAt) return;
    const dx = event.clientX - this.pointerDownAt.x;
    const dy = event.clientY - this.pointerDownAt.y;
    this.pointerDownAt = null;
    // A drag is a camera move, not a click.
    if (Math.hypot(dx, dy) > CLICK_SLOP_PX) return;

    this.updatePointer(event);
    const hit = this.raycast();
    this.onSelect?.(hit ? hit.id : null);
  }

  updatePointer(event) {
    const rect = this.domElement.getBoundingClientRect();
    this.screen.x = event.clientX;
    this.screen.y = event.clientY;
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.hasPointer = true;
  }

  /**
   * Called once per frame from the render loop.
   *
   * As well as reacting to pointer movement, a resting pointer is re-tested
   * every few frames: the planet under it is moving, and a hover card left
   * pinned to a world that has orbited away would be lying.
   */
  update() {
    if (!this.enabled || !this.hasPointer) return;
    this.sinceRecheck += 1;
    const recheck = this.currentHit !== null && this.sinceRecheck >= RECHECK_FRAMES;
    if (!this.dirty && !recheck) return;
    this.dirty = false;
    this.sinceRecheck = 0;
    this.setHit(this.raycast());
  }

  raycast() {
    const targets = this.system.pickTargets;
    if (targets.length === 0) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersections = this.raycaster.intersectObjects(targets, false);
    if (intersections.length === 0) return null;

    // An orbit's pick tube is deliberately fatter than the body it belongs to,
    // so close up the tube is hit first even when the pointer is squarely on
    // the planet. A body therefore wins whenever it is anywhere near as close;
    // only a body far behind the orbit loses.
    let body = null;
    let orbit = null;
    for (const hit of intersections) {
      const kind = hit.object.userData.pickable;
      if (kind === 'body' && !body) body = hit;
      else if (kind === 'orbit' && !orbit) orbit = hit;
      if (body && orbit) break;
    }

    const chosen =
      body && (!orbit || body.distance <= orbit.distance * BODY_PRIORITY) ? body : orbit;
    if (!chosen) return null;

    const data = chosen.object.userData;
    const id = data.pickable === 'orbit' ? data.orbitOf : data.bodyId;
    if (!id) return null;
    return { id, kind: data.pickable, x: this.screen.x, y: this.screen.y };
  }

  setHit(hit) {
    const changed = hit?.id !== this.currentHit?.id || hit?.kind !== this.currentHit?.kind;
    this.currentHit = hit;
    this.domElement.style.cursor = hit ? 'pointer' : '';
    if (changed || hit) this.onHover?.(hit);
  }

  /** Suspends hovering, e.g. while a modal panel is open. */
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.setHit(null);
  }

  dispose() {
    this.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.domElement.removeEventListener('pointerleave', this.onPointerLeave);
    this.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.domElement.style.cursor = '';
  }
}
