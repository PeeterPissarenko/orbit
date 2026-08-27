/**
 * BONUS - the main asteroid belt.
 *
 * 2 400 bodies between Mars and Jupiter, drawn as screen-space points rather
 * than meshes. At any zoom that shows the belt at all, a correctly sized
 * asteroid is a small fraction of a pixel - Ceres, the largest, would be 0.08
 * units across here - so meshes would be invisible and oversized meshes would
 * be a lie. Constant-size points read as what the belt actually is from a
 * distance: a band of dust.
 *
 * Each rock keeps its own circular orbit with its own inclination, and obeys
 * Kepler's third law, so the inner belt visibly laps the outer belt.
 */

import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, PointsMaterial } from 'three';

import { AU_KM } from '../config/scale.js';
import { TAU, mulberry32 } from '../utils/math.js';

const COUNT = 2400;
const INNER_AU = 2.06;
const OUTER_AU = 3.32;

export class AsteroidBelt {
  constructor({ scene, scale, textures }) {
    this.scene = scene;
    this.scale = scale;
    this.textures = textures;
    this.points = null;
    this.positions = new Float32Array(COUNT * 3);
    this.basisA = new Float32Array(COUNT * 3);
    this.basisB = new Float32Array(COUNT * 3);
    this.phase = new Float32Array(COUNT);
    this.angularSpeed = new Float32Array(COUNT);
  }

  enable() {
    if (this.points) return;
    this.build();

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new BufferAttribute(this.colors, 3));
    geometry.computeBoundingSphere();

    const material = new PointsMaterial({
      size: 2.8,
      sizeAttenuation: false,
      vertexColors: true,
      map: this.textures?.glow() ?? null,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    this.points = new Points(geometry, material);
    this.points.name = 'asteroid-belt';
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  /** Precomputes each rock's orbital plane, phase and angular speed. */
  build() {
    const random = mulberry32(20240617);
    this.colors = new Float32Array(COUNT * 3);

    for (let i = 0; i < COUNT; i += 1) {
      // Slightly clustered towards the middle of the belt, like the real one.
      const t = (random() + random()) / 2;
      const au = INNER_AU + t * (OUTER_AU - INNER_AU);
      const semiMajor = this.scale.orbitDistance(au * AU_KM);
      const inclination = (random() - 0.5) * 0.26;
      const node = random() * TAU;

      const cosN = Math.cos(node);
      const sinN = Math.sin(node);
      const cosI = Math.cos(inclination);
      const sinI = Math.sin(inclination);

      this.basisA[i * 3] = semiMajor * cosN;
      this.basisA[i * 3 + 1] = 0;
      this.basisA[i * 3 + 2] = -semiMajor * sinN;

      this.basisB[i * 3] = semiMajor * (-sinN * cosI);
      this.basisB[i * 3 + 1] = semiMajor * sinI;
      this.basisB[i * 3 + 2] = -semiMajor * (cosN * cosI);

      this.phase[i] = random() * TAU;
      // Kepler's third law: the inner belt laps the outer belt.
      this.angularSpeed[i] = TAU / (365.256 * au ** 1.5);

      // Weathered greys and browns, a few brighter than the rest.
      const brightness = 0.5 + random() ** 2 * 0.5;
      const warmth = 0.82 + random() * 0.18;
      this.colors[i * 3] = brightness;
      this.colors[i * 3 + 1] = brightness * warmth;
      this.colors[i * 3 + 2] = brightness * warmth * 0.86;
    }
    this.update(0, 0);
  }

  disable() {
    if (!this.points) return;
    this.points.removeFromParent();
    this.points.geometry.dispose();
    this.points.material.dispose();
    this.points = null;
  }

  update(_dt, days) {
    const positions = this.positions;
    for (let i = 0; i < COUNT; i += 1) {
      const angle = this.phase[i] + this.angularSpeed[i] * days;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const a = i * 3;
      positions[a] = this.basisA[a] * cos + this.basisB[a] * sin;
      positions[a + 1] = this.basisA[a + 1] * cos + this.basisB[a + 1] * sin;
      positions[a + 2] = this.basisA[a + 2] * cos + this.basisB[a + 2] * sin;
    }
    if (this.points) this.points.geometry.attributes.position.needsUpdate = true;
  }

  /** The belt is laid out in scene units, so a scale change rebuilds it. */
  rescale(scale) {
    this.scale = scale;
    if (!this.points) return;
    this.disable();
    this.enable();
  }

  dispose() {
    this.disable();
  }
}
