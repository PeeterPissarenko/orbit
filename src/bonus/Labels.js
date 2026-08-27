/**
 * BONUS - always-on name labels.
 *
 * Plain DOM chips projected from world space, which keeps the text crisp at any
 * zoom and costs nothing on the GPU. Labels behind the camera or off screen are
 * simply hidden.
 */

import { Vector3 } from 'three';
import { el } from '../ui/dom.js';

/** Below this on-screen orbit size, a moon's label is just clutter. */
const MIN_MOON_ORBIT_PX = 34;

export class Labels {
  constructor({ system, camera, canvas, store }) {
    this.system = system;
    this.camera = camera;
    this.canvas = canvas;
    this.store = store;
    this.layer = null;
    this.chips = new Map();
    this.projected = new Vector3();
  }

  enable() {
    if (this.layer) return;
    this.layer = el('div', { class: 'labels-layer', 'aria-hidden': 'true' });
    document.body.appendChild(this.layer);
    this.sync();
  }

  disable() {
    if (!this.layer) return;
    this.layer.remove();
    this.layer = null;
    this.chips.clear();
  }

  /** Adds or removes chips so they match the current set of bodies. */
  sync() {
    if (!this.layer) return;
    const wanted = new Set(this.store.list().map((body) => body.id));
    for (const [id, chip] of this.chips) {
      if (!wanted.has(id)) {
        chip.remove();
        this.chips.delete(id);
      }
    }
    for (const body of this.store.list()) {
      let chip = this.chips.get(body.id);
      if (!chip) {
        chip = el('div', { class: 'label-chip' });
        this.layer.appendChild(chip);
        this.chips.set(body.id, chip);
      }
      chip.textContent = body.name;
      chip.style.color = body.color;
    }
  }

  update() {
    if (!this.layer) return;
    this.sync();
    const rect = this.canvas.getBoundingClientRect();
    // Scene units -> pixels, for a point at distance d: unit * focal / d.
    const focal = rect.height / (2 * Math.tan((this.camera.fov * Math.PI) / 360));

    for (const [id, chip] of this.chips) {
      const view = this.system.viewOf(id);
      if (!view) {
        chip.style.display = 'none';
        continue;
      }
      view.worldPosition(this.projected);

      // A moon's label is only useful once its orbit is big enough on screen to
      // tell the moons apart; otherwise a gas giant becomes a pile of chips.
      if (view.type === 'moon') {
        const distance = this.camera.position.distanceTo(this.projected);
        if ((view.track.semiMajor * focal) / Math.max(distance, 1e-3) < MIN_MOON_ORBIT_PX) {
          chip.style.display = 'none';
          continue;
        }
      }

      this.projected.project(this.camera);

      if (this.projected.z > 1 || Math.abs(this.projected.x) > 1.3 || Math.abs(this.projected.y) > 1.3) {
        chip.style.display = 'none';
        continue;
      }
      const x = rect.left + ((this.projected.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - this.projected.y) / 2) * rect.height;
      chip.style.display = '';
      chip.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -140%)`;
    }
  }

  dispose() {
    this.disable();
  }
}
