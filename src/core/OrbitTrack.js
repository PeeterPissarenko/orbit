/**
 * Keplerian orbit maths.
 *
 * Bodies do not travel on circles here. Each one follows a real ellipse defined
 * by its six orbital elements, which means Mercury visibly speeds up at
 * perihelion and Pluto-like eccentricities behave the way a textbook says they
 * should. Solving Kepler's equation once per body per frame is cheap: a handful
 * of Newton iterations on a couple of dozen bodies costs microseconds.
 *
 * Frame convention: orbital elements are given in ecliptic coordinates
 * (X towards the reference direction, Y 90 degrees along the ecliptic,
 * Z towards ecliptic north). Three.js is Y-up, so the mapping used throughout
 * the project is  scene = (X, Z, -Y)  - the ecliptic becomes the XZ plane.
 */

import { Vector3 } from 'three';
import { DEG2RAD, TAU, clamp } from '../utils/math.js';

/**
 * Solves Kepler's equation  M = E - e sin E  for the eccentric anomaly E.
 * Newton-Raphson from a good starting guess converges in 3-5 iterations for
 * every eccentricity this app allows.
 */
export function solveKepler(meanAnomaly, eccentricity) {
  const e = clamp(eccentricity, 0, 0.95);
  let M = meanAnomaly % TAU;
  if (M < 0) M += TAU;
  if (e < 1e-8) return M;

  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 12; i += 1) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    const delta = f / fp;
    E -= delta;
    if (Math.abs(delta) < 1e-10) break;
  }
  return E;
}

/**
 * One body's orbit, with the expensive trigonometry precomputed.
 *
 * `P` points at periapsis, `Q` is a quarter turn ahead of it in the orbital
 * plane; together they turn an eccentric anomaly into a 3D position with two
 * multiply-adds and no trig beyond sin/cos of E.
 */
export class OrbitTrack {
  constructor() {
    this.semiMajor = 1;
    this.eccentricity = 0;
    this.periodDays = 365.256;
    this.meanAnomaly0 = 0;
    this.P = new Vector3(1, 0, 0);
    this.Q = new Vector3(0, 0, -1);
    this.normal = new Vector3(0, 1, 0);
    this.semiMinorFactor = 1;
    this.revision = 0;
  }

  /**
   * @param {object} elements
   * @param {number} elements.semiMajor      semi-major axis, scene units
   * @param {number} elements.eccentricity   0 .. 0.85
   * @param {number} elements.periodDays     signed: negative orbits retrograde
   * @param {number} elements.inclinationDeg
   * @param {number} elements.ascendingNodeDeg
   * @param {number} elements.argPeriapsisDeg
   * @param {number} elements.meanAnomalyDeg
   */
  set(elements) {
    const e = clamp(elements.eccentricity ?? 0, 0, 0.85);
    const i = (elements.inclinationDeg ?? 0) * DEG2RAD;
    const omega = (elements.ascendingNodeDeg ?? 0) * DEG2RAD;
    const argp = (elements.argPeriapsisDeg ?? 0) * DEG2RAD;

    this.semiMajor = Math.max(elements.semiMajor ?? 1, 1e-6);
    this.eccentricity = e;
    this.periodDays = elements.periodDays ?? 365.256;
    this.meanAnomaly0 = (elements.meanAnomalyDeg ?? 0) * DEG2RAD;
    this.semiMinorFactor = Math.sqrt(1 - e * e);

    const cosO = Math.cos(omega);
    const sinO = Math.sin(omega);
    const cosI = Math.cos(i);
    const sinI = Math.sin(i);
    const cosW = Math.cos(argp);
    const sinW = Math.sin(argp);

    // Periapsis direction and the in-plane perpendicular, in ecliptic axes.
    const px = cosO * cosW - sinO * sinW * cosI;
    const py = sinO * cosW + cosO * sinW * cosI;
    const pz = sinW * sinI;

    const qx = -cosO * sinW - sinO * cosW * cosI;
    const qy = -sinO * sinW + cosO * cosW * cosI;
    const qz = cosW * sinI;

    // ecliptic (X, Y, Z) -> Three.js (X, Z, -Y)
    this.P.set(px, pz, -py);
    this.Q.set(qx, qz, -qy);
    this.normal.crossVectors(this.P, this.Q).normalize();
    this.revision += 1;
    return this;
  }

  /** Mean anomaly at a given simulation time, in radians. */
  meanAnomalyAt(days) {
    if (!Number.isFinite(this.periodDays) || Math.abs(this.periodDays) < 1e-6) {
      return this.meanAnomaly0;
    }
    return this.meanAnomaly0 + (TAU * days) / this.periodDays;
  }

  /** Writes the position at simulation time `days` into `target`. */
  positionAt(days, target = new Vector3()) {
    const E = solveKepler(this.meanAnomalyAt(days), this.eccentricity);
    return this.positionAtEccentricAnomaly(E, target);
  }

  positionAtEccentricAnomaly(E, target = new Vector3()) {
    const a = this.semiMajor;
    const x = a * (Math.cos(E) - this.eccentricity);
    const y = a * this.semiMinorFactor * Math.sin(E);
    target.set(
      this.P.x * x + this.Q.x * y,
      this.P.y * x + this.Q.y * y,
      this.P.z * x + this.Q.z * y,
    );
    return target;
  }

  /** The closed ellipse, as `segments` points, ready for a line or a tube. */
  samplePath(segments = 256) {
    const points = new Array(segments);
    for (let i = 0; i < segments; i += 1) {
      points[i] = this.positionAtEccentricAnomaly((i / segments) * TAU, new Vector3());
    }
    return points;
  }

  get periapsis() {
    return this.semiMajor * (1 - this.eccentricity);
  }

  get apoapsis() {
    return this.semiMajor * (1 + this.eccentricity);
  }
}
