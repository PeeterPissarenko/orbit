/**
 * The photographic texture maps that ship with the project.
 *
 * Files live in public/textures and are fetched at runtime, so the app works
 * offline once cloned - no CDN, no API keys. Every entry degrades gracefully:
 * if a file is missing the body falls back to a procedurally painted surface.
 *
 * Image credit: Solar System Scope (solarsystemscope.com/textures), CC BY 4.0,
 * built from NASA elevation and imagery data. See public/textures/CREDITS.md.
 */

/** Prefixed so the build works from any base path. */
export const texturePath = (file) => `${import.meta.env.BASE_URL}textures/${file}`;

/**
 * cloud: an extra shell drawn just above the surface.
 *   useAlpha  - treat the image's own brightness as opacity (Earth's clouds)
 *   opacity   - overall strength
 *   driftDegPerDay - how fast the shell slides relative to the surface
 */
export const TEXTURE_SETS = {
  sun: {
    label: 'Sun',
    file: '2k_sun.jpg',
    emissive: true,
  },
  mercury: { label: 'Mercury', file: '2k_mercury.jpg', bumpFromMap: 0.4 },
  venus: {
    label: 'Venus',
    file: '2k_venus_surface.jpg',
    bumpFromMap: 0.3,
    cloud: {
      file: '2k_venus_atmosphere.jpg',
      useAlpha: false,
      opacity: 0.95,
      scale: 1.012,
      driftDegPerDay: -1.5,
    },
  },
  earth: {
    label: 'Earth',
    file: '2k_earth_daymap.jpg',
    nightFile: '2k_earth_nightmap.jpg',
    bumpFromMap: 0.25,
    cloud: {
      file: '2k_earth_clouds.jpg',
      useAlpha: true,
      opacity: 0.8,
      scale: 1.008,
      driftDegPerDay: 6,
    },
  },
  moon: { label: 'Moon', file: '2k_moon.jpg', bumpFromMap: 0.6 },
  mars: { label: 'Mars', file: '2k_mars.jpg', bumpFromMap: 0.5 },
  jupiter: { label: 'Jupiter', file: '2k_jupiter.jpg' },
  saturn: { label: 'Saturn', file: '2k_saturn.jpg' },
  uranus: { label: 'Uranus', file: '2k_uranus.jpg' },
  neptune: { label: 'Neptune', file: '2k_neptune.jpg' },
  ceres: { label: 'Ceres (grey rock)', file: '2k_ceres_fictional.jpg', bumpFromMap: 0.5 },
  eris: { label: 'Eris (pale ice)', file: '2k_eris_fictional.jpg', bumpFromMap: 0.4 },
  haumea: { label: 'Haumea (mottled)', file: '2k_haumea_fictional.jpg', bumpFromMap: 0.4 },
  makemake: { label: 'Makemake (red rock)', file: '2k_makemake_fictional.jpg', bumpFromMap: 0.4 },
};

export const RING_TEXTURES = {
  saturnRing: { label: 'Saturn ring', file: '2k_saturn_ring_alpha.png' },
};

export const STARFIELD_TEXTURE = '2k_stars_milky_way.jpg';

/**
 * Options offered in the inspector's "Surface" dropdown.
 * A star gets the Sun's own map in the list too, or its dropdown would show a
 * blank entry and the map could never be chosen again once changed.
 */
export function textureOptionsFor(bodyType) {
  const entries = Object.entries(TEXTURE_SETS).filter(
    ([id]) => id !== 'sun' || bodyType === 'star',
  );
  return [
    { id: '', label: 'Painted from colour' },
    ...entries.map(([id, set]) => ({ id, label: set.label })),
  ];
}
