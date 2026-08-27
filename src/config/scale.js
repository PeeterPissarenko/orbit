/**
 * Everything about turning real Solar System numbers into scene units.
 *
 * The Solar System is mostly empty space. If distances and radii shared one
 * linear scale, a scene wide enough to hold Neptune would draw Earth about two
 * thousandths of a pixel across. Orbit therefore uses separate linear scales -
 * one for orbital distances, one for body radii - so proportions stay exactly
 * right *within* each family (Jupiter really is 11x Earth here, Neptune really
 * is 30x further out than Earth) while the whole system stays readable.
 *
 * Moons need a third treatment, explained at `moonOrbitRadius` below.
 *
 * Nothing here is a magic number without a comment: change a value and the
 * whole simulation rescales consistently.
 */

/** One astronomical unit - the mean Earth-Sun distance. */
export const AU_KM = 149_597_870.7;

/** Reference radii, used to document what the scale factors produce. */
export const EARTH_RADIUS_KM = 6371;
export const SUN_RADIUS_KM = 695_700;

const COMPRESSED = {
  id: 'compressed',
  label: 'Classroom scale',
  description:
    'Distances and sizes are each scaled linearly, but with different factors, so every planet stays visible. Relative proportions inside each group are exact.',

  /** Orbital distance: 1 AU -> 100 scene units (Neptune lands 3007 units out). */
  unitsPerAu: 100,

  /** Planet & moon radii: 5 800 km -> 1 unit (Earth 1.10, Jupiter 12.05). */
  kmPerRadiusUnit: 5800,

  /**
   * The Sun is compressed about six times harder still (19.3 units): big
   * enough to dominate Jupiter's 12, small enough to leave clear space inside
   * Mercury's perihelion at 30.7 units.
   */
  kmPerSunRadiusUnit: 36_000,

  /**
   * Tiny moons like Phobos would otherwise be far below one pixel. This is a
   * *soft* floor - see `bodyRadius` - so the size slider keeps doing something
   * visible all the way down instead of flatlining.
   */
  minBodyRadiusUnits: 0.06,

  /** Moon orbit compression - see `moonOrbitRadius`. */
  moonBaseRadii: 1.8,
  moonGain: 1.2,
  moonExponent: 0.55,

  /** A comfortable opening shot: the Sun out to about the orbit of Mars. */
  defaultCameraDistance: 380,
  maxCameraDistance: 9000,
};

const TRUE_TO_LIFE = {
  id: 'true',
  label: 'True scale',
  description:
    'One single scale for sizes and distances - exactly as the real Solar System is proportioned. The planets become specks, which is the point: space is overwhelmingly empty.',
  unitsPerAu: AU_KM / 347_850,
  kmPerRadiusUnit: 347_850,
  kmPerSunRadiusUnit: 347_850,
  minBodyRadiusUnits: 0,
  /** base 0, gain 1, exponent 1 collapses the moon formula back to linear. */
  moonBaseRadii: 0,
  moonGain: 1,
  moonExponent: 1,
  defaultCameraDistance: 2600,
  maxCameraDistance: 120_000,
};

export const SCALE_MODES = { compressed: COMPRESSED, true: TRUE_TO_LIFE };
export const DEFAULT_SCALE_MODE = 'compressed';

/**
 * Builds the conversion helpers for one scale mode.
 * @param {'compressed'|'true'} modeId
 */
export function createScale(modeId = DEFAULT_SCALE_MODE) {
  const mode = SCALE_MODES[modeId] ?? COMPRESSED;

  const orbitDistance = (km) => (km / AU_KM) * mode.unitsPerAu;

  /**
   * The raw, unfloored radius. Used wherever a *ratio* is wanted rather than a
   * drawable size, so that shrinking a body keeps behaving sensibly even after
   * its drawn size has bottomed out.
   */
  const rawRadius = (km, { star = false } = {}) =>
    km / (star ? mode.kmPerSunRadiusUnit : mode.kmPerRadiusUnit);

  /**
   * A *soft* minimum size. A hard `Math.max` would make every body under about
   * 350 km render identically, so the size slider would appear dead down there.
   * Adding `floor * e^(-raw/floor)` instead keeps the result strictly
   * increasing, never smaller than the floor, and - because the extra term
   * decays exponentially - indistinguishable from the exact linear scale for
   * anything bigger than a large asteroid.
   */
  const bodyRadius = (km, options = {}) => {
    const raw = rawRadius(km, options);
    const floor = mode.minBodyRadiusUnits;
    if (floor <= 0) return raw;
    return raw + floor * Math.exp(-raw / floor);
  };

  return {
    ...mode,

    /** Semi-major axis of a heliocentric orbit: km -> scene units. */
    orbitDistance,

    /** Radius of a planet, moon or star: km -> scene units. */
    bodyRadius,

    /** Radius without the visibility floor. */
    rawRadius,

    /**
     * Moon orbits, measured in *planet radii* rather than kilometres.
     *
     * Our Moon sits 60 Earth radii out; Io sits 6 Jupiter radii out. Scaling
     * both linearly puts Io inside Jupiter once Jupiter has been drawn twelve
     * units wide. Compressing the ratio instead - a gentle power curve with a
     * floor of 1.8 planet radii - keeps every moon outside its planet *and*
     * outside its rings, while preserving the ordering inside each system:
     * Io is still closer than Europa, which is still closer than Ganymede.
     *
     * In true-scale mode the curve's parameters collapse it back to plain
     * linear, so nothing is faked there.
     */
    moonOrbitRadius(distanceKm, parentRadiusKm, parentRadiusUnits, moonRadiusUnits = 0) {
      const safeParentKm = Math.max(parentRadiusKm, 1e-3);
      const ratio = Math.max(distanceKm, 1) / safeParentKm;
      const renderedRatio = mode.moonBaseRadii + mode.moonGain * ratio ** mode.moonExponent;

      // Multiply by the *raw* parent radius, not the floored one. Using the
      // floored value would make a shrinking planet's moons fly outwards,
      // because the ratio keeps growing while the multiplier stops shrinking.
      const raw = rawRadius(safeParentKm) * renderedRatio;

      // ...but never let a moon end up inside the planet as it is drawn.
      const clearance = parentRadiusUnits * 1.5 + moonRadiusUnits * 2.2;
      return mode.moonBaseRadii > 0 ? Math.max(raw, clearance) : raw;
    },
  };
}
