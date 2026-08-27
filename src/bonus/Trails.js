/**
 * BONUS - comet-style trails.
 *
 * Each body gets a fixed-length ring buffer of past positions drawn as a line
 * that fades out towards the oldest sample. Points are only appended once the
 * body has actually moved a visible distance, so a paused or very slow
 * simulation does not fill the buffer with duplicates.
 */

import { BufferAttribute, BufferGeometry, Line, LineBasicMaterial, Vector3 } from 'three';

import { hexToRgb } from '../utils/color.js';

const SAMPLES = 260;

class Trail {
  constructor(bodyId, color) {
    this.bodyId = bodyId;
    this.count = 0;
    this.positions = new Float32Array(SAMPLES * 3);
    this.colors = new Float32Array(SAMPLES * 3);
    this.last = new Vector3(Number.NaN, Number.NaN, Number.NaN);

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new BufferAttribute(this.colors, 3));
    geometry.setDrawRange(0, 0);

    this.line = new Line(
      geometry,
      new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false }),
    );
    this.line.frustumCulled = false;
    this.setColor(color);
  }

  setColor(hex) {
    const { r, g, b } = hexToRgb(hex);
    for (let i = 0; i < SAMPLES; i += 1) {
      // Oldest sample (index 0) is faintest.
      const fade = (i / (SAMPLES - 1)) ** 2;
      this.colors[i * 3] = (r / 255) * fade;
      this.colors[i * 3 + 1] = (g / 255) * fade;
      this.colors[i * 3 + 2] = (b / 255) * fade;
    }
    this.line.geometry.attributes.color.needsUpdate = true;
  }

  push(position, minStep) {
    if (Number.isFinite(this.last.x) && this.last.distanceToSquared(position) < minStep * minStep) {
      return;
    }
    this.last.copy(position);

    if (this.count === SAMPLES) {
      this.positions.copyWithin(0, 3);
      this.count -= 1;
    }
    const offset = this.count * 3;
    this.positions[offset] = position.x;
    this.positions[offset + 1] = position.y;
    this.positions[offset + 2] = position.z;
    this.count += 1;

    this.line.geometry.attributes.position.needsUpdate = true;
    this.line.geometry.setDrawRange(0, this.count);
  }

  clear() {
    this.count = 0;
    this.last.set(Number.NaN, Number.NaN, Number.NaN);
    this.line.geometry.setDrawRange(0, 0);
  }

  dispose() {
    this.line.geometry.dispose();
    this.line.material.dispose();
    this.line.removeFromParent();
  }
}

export class Trails {
  constructor({ scene, system, store }) {
    this.scene = scene;
    this.system = system;
    this.store = store;
    this.trails = new Map();
    this.active = false;
    this.scratch = new Vector3();

    const onStoreChange = () => {
      if (this.active) this.sync();
    };
    this.unsubscribes = ['add', 'remove', 'reset'].map((event) => store.on(event, onStoreChange));
    this.unsubscribes.push(
      store.on('update', ({ body, keys }) => {
        if (!this.active) return;
        const trail = this.trails.get(body.id);
        if (!trail) return;
        if (keys.includes('color')) trail.setColor(body.color);
        if (keys.some((key) => key !== 'name' && key !== 'color' && key !== 'description')) {
          trail.clear();
        }
      }),
    );
  }

  enable() {
    this.active = true;
    this.sync();
  }

  disable() {
    this.active = false;
    for (const trail of this.trails.values()) trail.dispose();
    this.trails.clear();
  }

  sync() {
    const wanted = this.store.list().filter((body) => body.type !== 'star');
    const ids = new Set(wanted.map((body) => body.id));
    for (const [id, trail] of this.trails) {
      if (!ids.has(id)) {
        trail.dispose();
        this.trails.delete(id);
      }
    }
    for (const body of wanted) {
      if (this.trails.has(body.id)) continue;
      const trail = new Trail(body.id, body.color);
      this.trails.set(body.id, trail);
      this.scene.add(trail.line);
    }
  }

  update() {
    if (!this.active) return;
    for (const [id, trail] of this.trails) {
      const view = this.system.viewOf(id);
      if (!view) continue;
      view.worldPosition(this.scratch);
      trail.push(this.scratch, Math.max(view.track.semiMajor * 0.004, 0.01));
    }
  }

  dispose() {
    this.disable();
    for (const off of this.unsubscribes) off();
    this.unsubscribes = [];
  }
}
