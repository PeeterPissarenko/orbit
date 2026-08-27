/**
 * The shape of a celestial body, plus the rules that keep user input sane.
 *
 * A "body" is plain, serialisable data - no Three.js objects anywhere. The 3D
 * layer subscribes to the store and mirrors this data into the scene, which is
 * what makes create / update / delete straightforward and undo-able.
 */

import { AU_KM } from '../config/scale.js';
import { clamp, createId, hashString } from '../utils/math.js';

export const BODY_TYPES = ['star', 'planet', 'moon'];

/** Slider ranges. Generous on purpose: this is a toy box, not a textbook. */
export const LIMITS = {
  radiusKm: { min: 5, max: 400000 },
  starRadiusKm: { min: 10000, max: 3000000 },
  /**
   * The inner limit keeps a planet clear of the Sun as it is *drawn* (the Sun
   * is compressed less than the planets, so it reaches about 0.19 AU on the
   * distance scale); the outer limit is chosen so that Kepler's third law
   * still lands inside `orbitalPeriodDays.max` at the far end.
   */
  planetDistanceKm: { min: 0.26 * AU_KM, max: 200 * AU_KM },
  moonDistanceKm: { min: 500, max: 30000000 },
  orbitalPeriodDays: { min: 0.02, max: 1200000 },
  rotationPeriodHours: { min: 0.05, max: 20000 },
  axialTiltDeg: { min: 0, max: 180 },
  eccentricity: { min: 0, max: 0.85 },
  inclinationDeg: { min: 0, max: 180 },
  angleDeg: { min: 0, max: 360 },
};

/** Surface styles drive the procedurally generated texture for custom worlds. */
export const SURFACE_STYLES = [
  { id: 'rocky', label: 'Rocky & cratered' },
  { id: 'terran', label: 'Continents & ocean' },
  { id: 'gas', label: 'Gas giant bands' },
  { id: 'icy', label: 'Icy & smooth' },
  { id: 'lava', label: 'Molten' },
  { id: 'star', label: 'Star' },
];

const HEX = /^#[0-9a-f]{6}$/i;

export function normaliseColor(value, fallback = '#cccccc') {
  if (typeof value !== 'string') return fallback;
  let hex = value.trim();
  if (!hex.startsWith('#')) hex = `#${hex}`;
  if (/^#[0-9a-f]{3}$/i.test(hex)) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return HEX.test(hex) ? hex.toLowerCase() : fallback;
}

function num(value, fallback, range, { allowNegative = false } = {}) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (allowNegative) {
    const sign = parsed < 0 ? -1 : 1;
    return sign * clamp(Math.abs(parsed), range.min, range.max);
  }
  return clamp(parsed, range.min, range.max);
}

/** Distance limits depend on whether the body orbits a star or a planet. */
export function distanceLimitsFor(type) {
  return type === 'moon' ? LIMITS.moonDistanceKm : LIMITS.planetDistanceKm;
}

/**
 * Kepler's third law, in the only form a classroom needs:
 * a planet twice as far from the Sun takes 2^1.5 times longer to get round.
 */
export function keplerPeriodDays(distanceKm) {
  const au = Math.max(distanceKm, 1) / AU_KM;
  return 365.256 * au ** 1.5;
}

/** The same idea for moons, calibrated so our Moon comes out at 27.3 days. */
export function moonPeriodDays(distanceKm, parentRadiusKm = 6371) {
  const massProxy = (parentRadiusKm / 6371) ** 3;
  const a = Math.max(distanceKm, 1) / 384400;
  return (27.3217 * a ** 1.5) / Math.sqrt(Math.max(massProxy, 1e-4));
}

/**
 * Fills in every field, clamps every number and guarantees the result is safe
 * to hand to the renderer. Unknown keys are dropped.
 */
export function normaliseBody(raw = {}, { fallbackType = 'planet' } = {}) {
  // Tolerate null / a string / anything else a hand-edited file might hold.
  const input = raw && typeof raw === 'object' ? raw : {};
  const type = BODY_TYPES.includes(input.type) ? input.type : fallbackType;
  const isStar = type === 'star';
  const radiusRange = isStar ? LIMITS.starRadiusKm : LIMITS.radiusKm;
  const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : createId(type);
  const name =
    typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 40) : 'Unnamed';

  const body = {
    id,
    type,
    parentId: isStar ? null : (input.parentId ?? 'sun'),
    name,
    color: normaliseColor(input.color, isStar ? '#ffcf6b' : '#b9c2cc'),
    textureId: typeof input.textureId === 'string' && input.textureId ? input.textureId : null,
    surfaceStyle: SURFACE_STYLES.some((s) => s.id === input.surfaceStyle)
      ? input.surfaceStyle
      : isStar
        ? 'star'
        : 'rocky',
    radiusKm: num(input.radiusKm, isStar ? 695700 : 6371, radiusRange),
    distanceKm: isStar ? 0 : num(input.distanceKm, AU_KM, distanceLimitsFor(type)),
    orbitalPeriodDays: isStar
      ? 0
      : num(input.orbitalPeriodDays, 365.256, LIMITS.orbitalPeriodDays, { allowNegative: true }),
    rotationPeriodHours: num(input.rotationPeriodHours, 24, LIMITS.rotationPeriodHours, {
      allowNegative: true,
    }),
    axialTiltDeg: num(input.axialTiltDeg, 0, LIMITS.axialTiltDeg),
    eccentricity: isStar ? 0 : num(input.eccentricity, 0, LIMITS.eccentricity),
    inclinationDeg: isStar ? 0 : num(input.inclinationDeg, 0, LIMITS.inclinationDeg),
    ascendingNodeDeg: isStar ? 0 : num(input.ascendingNodeDeg, 0, LIMITS.angleDeg),
    argPeriapsisDeg: isStar ? 0 : num(input.argPeriapsisDeg, 0, LIMITS.angleDeg),
    meanAnomalyDeg: isStar ? 0 : num(input.meanAnomalyDeg, 0, LIMITS.angleDeg),
    description: typeof input.description === 'string' ? input.description.slice(0, 400) : '',
    builtIn: input.builtIn === true,
    rings: null,
    atmosphere: null,
  };

  if (input.rings && typeof input.rings === 'object') {
    const inner = num(input.rings.innerKm, body.radiusKm * 1.2, {
      min: 1,
      max: LIMITS.radiusKm.max * 8,
    });
    const outer = num(input.rings.outerKm, inner * 2, { min: 1, max: LIMITS.radiusKm.max * 12 });
    // Dragging one edge past the other swaps them rather than inflating either,
    // and a ring can never end up buried inside the body it belongs to.
    const floor = body.radiusKm * 1.05;
    const low = Math.max(Math.min(inner, outer), floor);
    const high = Math.max(inner, outer);
    body.rings = {
      innerKm: low,
      outerKm: Math.max(high, low * 1.05),
      textureId: typeof input.rings.textureId === 'string' ? input.rings.textureId : null,
      color: normaliseColor(input.rings.color, '#d8d0be'),
      opacity: clamp(Number(input.rings.opacity ?? 0.8) || 0.8, 0.05, 1),
    };
  }

  if (input.atmosphere && typeof input.atmosphere === 'object') {
    body.atmosphere = {
      color: normaliseColor(input.atmosphere.color, '#8fc0ff'),
      opacity: clamp(Number(input.atmosphere.opacity ?? 0.3) || 0.3, 0.02, 1),
      scale: clamp(Number(input.atmosphere.scale ?? 1.03) || 1.03, 1.005, 1.4),
    };
  }

  return body;
}

/** A stable per-body random seed so procedural textures never flicker. */
export function seedFor(body) {
  return hashString(`${body.id}:${body.surfaceStyle}:${body.color}`);
}

const NEW_PLANET_COLORS = [
  '#7fd1c9',
  '#e77f9b',
  '#f2b134',
  '#8f7fe8',
  '#66c96b',
  '#e86f4a',
  '#4fb4f2',
  '#d9d24f',
];

/**
 * Sensible starting values for a brand new planet: parked in the first
 * comfortable gap beyond the outermost planet, sized like Earth, with a period
 * that already obeys Kepler's third law.
 */
export function planetTemplate(existingBodies) {
  const planets = existingBodies.filter((b) => b.type === 'planet');
  const { min, max } = LIMITS.planetDistanceKm;
  const outermost = planets.reduce((furthest, b) => Math.max(furthest, b.distanceKm), 0.4 * AU_KM);

  let distanceKm = outermost * 1.35;
  if (distanceKm > max * 0.97) {
    // No room left on the outside: drop the new world into the widest gap
    // instead of stacking every extra planet on top of the 200 AU limit.
    const rings = [min, ...planets.map((b) => b.distanceKm).sort((a, b) => a - b), max];
    let bestRatio = 0;
    for (let i = 0; i < rings.length - 1; i += 1) {
      const ratio = rings[i + 1] / Math.max(rings[i], 1);
      if (ratio > bestRatio) {
        bestRatio = ratio;
        distanceKm = Math.sqrt(rings[i] * rings[i + 1]);
      }
    }
  }
  distanceKm = clamp(distanceKm, min, max);
  const index = planets.length;
  return {
    type: 'planet',
    parentId: 'sun',
    name: `New planet ${index + 1}`,
    color: NEW_PLANET_COLORS[index % NEW_PLANET_COLORS.length],
    textureId: null,
    surfaceStyle: 'rocky',
    radiusKm: 6371,
    distanceKm,
    orbitalPeriodDays: keplerPeriodDays(distanceKm),
    rotationPeriodHours: 24,
    axialTiltDeg: 12,
    eccentricity: 0,
    inclinationDeg: 0,
    ascendingNodeDeg: Math.round(Math.random() * 360),
    argPeriapsisDeg: 0,
    meanAnomalyDeg: Math.round(Math.random() * 360),
    description: 'A world of your own invention.',
  };
}

/** Sensible starting values for a new moon of `parent`. */
export function moonTemplate(parent, siblings) {
  const outermost = siblings.reduce((furthest, b) => Math.max(furthest, b.distanceKm), 0);
  const wanted = outermost > 0 ? outermost * 1.6 : Math.max(parent.radiusKm * 25, 20000);
  const distanceKm = clamp(wanted, LIMITS.moonDistanceKm.min, LIMITS.moonDistanceKm.max);
  return {
    type: 'moon',
    parentId: parent.id,
    name: `${parent.name} ${romanNumeral(siblings.length + 1)}`,
    color: '#cbd3da',
    textureId: null,
    surfaceStyle: 'rocky',
    radiusKm: Math.max(parent.radiusKm * 0.27, 200),
    distanceKm,
    orbitalPeriodDays: moonPeriodDays(distanceKm, parent.radiusKm),
    rotationPeriodHours: 48,
    axialTiltDeg: 0,
    eccentricity: 0,
    inclinationDeg: 0,
    ascendingNodeDeg: Math.round(Math.random() * 360),
    argPeriapsisDeg: 0,
    meanAnomalyDeg: Math.round(Math.random() * 360),
    description: 'A little companion.',
  };
}

const ROMAN = [
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

export function romanNumeral(value) {
  let n = Math.max(1, Math.round(value));
  let out = '';
  while (n > 0) {
    const [amount, glyph] = ROMAN.find(([a]) => a <= n) ?? [1, 'I'];
    out += glyph;
    n -= amount;
  }
  return out;
}
