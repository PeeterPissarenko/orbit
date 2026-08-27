/**
 * Bonus functionality lives behind feature flags.
 *
 * The brief is explicit: bonus features must not change the project's default
 * behaviour. Every flag below therefore defaults to OFF. They can be switched on
 * three ways, in ascending priority:
 *
 *   1. the "Bonus lab" section of the control panel (persisted per browser),
 *   2. a URL parameter:  ?bonus=labels,trails   or   ?bonus=all   or ?bonus=none
 *   3. calling app.flags.set(id, true) from the console.
 *
 * Nothing in src/ reads a bonus flag outside of a clearly marked bonus module.
 */

const STORAGE_KEY = 'orbit.bonus.v1';

export const BONUS_FEATURES = [
  {
    id: 'labels',
    label: 'Always-on name labels',
    description: 'Pins every body name to the screen instead of only on hover.',
  },
  {
    id: 'trails',
    label: 'Orbit trails',
    description: 'Each planet paints a fading comet-like trail as it travels.',
  },
  {
    id: 'asteroidBelt',
    label: 'Asteroid belt',
    description:
      'Adds 2 400 rocks between Mars and Jupiter, drawn much larger than life so you can see them.',
  },
  {
    id: 'trueScale',
    label: 'True-scale mode',
    description: 'Rescales sizes and distances onto one honest linear scale.',
  },
  {
    id: 'shadows',
    label: 'Cast shadows',
    description: 'Planets and moons cast real shadows - watch for an eclipse.',
  },
  {
    id: 'stats',
    label: 'Performance readout',
    description: 'Live FPS, frame time, draw calls and triangle count.',
  },
  {
    id: 'autoQuality',
    label: 'Adaptive quality',
    description: 'Drops render resolution automatically if the frame rate sags.',
  },
  {
    id: 'screenshot',
    label: 'Screenshot button',
    description: 'Saves the current view as a PNG you can print for the classroom.',
  },
];

const DEFAULTS = Object.freeze(
  Object.fromEntries(BONUS_FEATURES.map((feature) => [feature.id, false])),
);

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function readUrl() {
  let search = '';
  try {
    search = window.location.search;
  } catch {
    return null;
  }
  const params = new URLSearchParams(search);
  if (!params.has('bonus')) return null;
  const raw = params.get('bonus').trim().toLowerCase();
  if (raw === '' || raw === 'none' || raw === 'off') return { ...DEFAULTS };
  if (raw === 'all' || raw === 'on') {
    return Object.fromEntries(BONUS_FEATURES.map((f) => [f.id, true]));
  }
  const wanted = new Set(raw.split(/[,+ ]+/).filter(Boolean));
  const known = new Map(BONUS_FEATURES.map((f) => [f.id.toLowerCase(), f.id]));
  const result = { ...DEFAULTS };
  for (const id of wanted) {
    const match = known.get(id);
    if (match) result[match] = true;
  }
  return result;
}

export class FeatureFlags {
  constructor() {
    const stored = readStored();
    const url = readUrl();
    this.values = { ...DEFAULTS, ...stored, ...(url ?? {}) };
    this.listeners = new Set();
    this.urlDriven = url !== null;
  }

  get(id) {
    return this.values[id] === true;
  }

  /** Every flag as a plain object - handy in the console. */
  all() {
    return { ...this.values };
  }

  set(id, value) {
    const next = value === true;
    if (!(id in DEFAULTS)) return false;
    if (this.values[id] === next) return false;
    this.values[id] = next;
    this.persist();
    for (const listener of this.listeners) listener(id, next, this.values);
    return true;
  }

  toggle(id) {
    return this.set(id, !this.get(id));
  }

  reset() {
    for (const id of Object.keys(DEFAULTS)) this.set(id, false);
  }

  /** @param {(id: string, value: boolean, all: object) => void} listener */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.values));
    } catch {
      /* private mode - flags simply do not persist */
    }
  }

  /** A shareable URL that reproduces the current bonus configuration. */
  toUrl() {
    const active = BONUS_FEATURES.filter((f) => this.get(f.id)).map((f) => f.id);
    const url = new URL(window.location.href);
    if (active.length === 0) url.searchParams.delete('bonus');
    else url.searchParams.set('bonus', active.join(','));
    return url.toString();
  }
}
