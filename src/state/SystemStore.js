/**
 * The single source of truth for what is in the simulation.
 *
 * Everything else - the 3D scene, the body tree, the inspector, the tooltip -
 * reads from here and reacts to its events. That one-way flow is what keeps
 * "add a planet" a three-line operation instead of a scavenger hunt.
 *
 * Events emitted:
 *   add     { body }
 *   update  { body, keys, previous }
 *   remove  { bodies }            (the body and every descendant)
 *   reset   { bodies }
 *   select  { id, previous }
 */

import { defaultSystem } from '../data/solarSystem.js';
import { normaliseBody, distanceLimitsFor } from './bodySchema.js';

export class SystemStore {
  constructor(initial) {
    /** @type {Map<string, object>} */
    this.bodies = new Map();
    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();
    this.selectedId = null;
    /**
     * Bumped whenever the whole system is replaced. An "undo delete" offer
     * captured before a reset or an import must not resurrect bodies into a
     * system they never belonged to.
     */
    this.generation = 0;
    this.load(initial ?? defaultSystem(), { silent: true });
  }

  /* ---------------------------------------------------------------- events */

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    this.listeners.get(event)?.delete(handler);
  }

  emit(event, payload) {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of [...handlers]) handler(payload);
  }

  /* ---------------------------------------------------------------- reads */

  get(id) {
    return this.bodies.get(id) ?? null;
  }

  has(id) {
    return this.bodies.has(id);
  }

  /** Insertion order, which is always parents before children. */
  list() {
    return [...this.bodies.values()];
  }

  get size() {
    return this.bodies.size;
  }

  star() {
    return this.list().find((body) => body.type === 'star') ?? null;
  }

  planets() {
    return this.list()
      .filter((body) => body.type === 'planet')
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }

  moons() {
    return this.list().filter((body) => body.type === 'moon');
  }

  childrenOf(id) {
    return this.list()
      .filter((body) => body.parentId === id)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }

  /** A body plus every descendant, deepest last. */
  descendantsOf(id) {
    const out = [];
    // A corrupted import could describe a parent cycle; the visited set means
    // that becomes a no-op rather than a stack overflow.
    const visited = new Set([id]);
    const walk = (parentId) => {
      for (const child of this.childrenOf(parentId)) {
        if (visited.has(child.id)) continue;
        visited.add(child.id);
        out.push(child);
        walk(child.id);
      }
    };
    walk(id);
    return out;
  }

  /** Distance from the centre of the system, following the parent chain. */
  heliocentricDistanceKm(id) {
    let body = this.get(id);
    let total = 0;
    const guard = new Set();
    while (body && body.parentId && body.parentId !== body.id && !guard.has(body.id)) {
      guard.add(body.id);
      total += body.distanceKm;
      body = this.get(body.parentId);
    }
    return total;
  }

  /* ---------------------------------------------------------------- writes */

  add(partial) {
    const parentId = partial.parentId ?? 'sun';
    const fallbackType = partial.type ?? 'planet';
    const body = normaliseBody({ ...partial, parentId }, { fallbackType });

    if (body.type !== 'star' && !this.bodies.has(body.parentId)) {
      const star = this.star();
      if (!star) return null;
      body.parentId = star.id;
      body.type = 'planet';
    }
    body.name = this.uniqueName(body.name, body.id);
    body.builtIn = false;

    this.bodies.set(body.id, body);
    this.emit('add', { body });
    return body;
  }

  /**
   * Patches one body. Returns the list of keys that actually changed so the
   * renderer can rebuild only what it must.
   */
  update(id, patch) {
    const current = this.bodies.get(id);
    if (!current) return null;

    const merged = normaliseBody({ ...current, ...patch }, { fallbackType: current.type });
    // Identity and lineage are never editable through a patch.
    merged.id = current.id;
    merged.type = current.type;
    merged.parentId = current.parentId;
    merged.builtIn = current.builtIn;
    if (typeof patch.name === 'string') merged.name = this.uniqueName(merged.name, id);

    const keys = [];
    for (const key of Object.keys(merged)) {
      if (!shallowEqual(merged[key], current[key])) keys.push(key);
    }
    if (keys.length === 0) return { body: current, keys };

    const previous = { ...current };
    this.bodies.set(id, merged);
    this.emit('update', { body: merged, keys, previous });
    return { body: merged, keys };
  }

  /** Removes a body and everything orbiting it. The star cannot be removed. */
  remove(id) {
    const body = this.bodies.get(id);
    if (!body || body.type === 'star') return [];
    const doomed = [body, ...this.descendantsOf(id)];
    for (const item of doomed) this.bodies.delete(item.id);
    if (doomed.some((item) => item.id === this.selectedId)) this.select(null);
    this.emit('remove', { bodies: doomed });
    return doomed;
  }

  /**
   * Puts previously removed bodies back, parents first (used by undo).
   * @returns {number} how many actually came back
   */
  restore(bodies) {
    const ordered = [...bodies].sort((a, b) => depth(a, bodies) - depth(b, bodies));
    let restored = 0;
    for (const raw of ordered) {
      const body = normaliseBody(raw, { fallbackType: raw.type });
      body.builtIn = raw.builtIn === true;
      // A body whose parent has since been deleted too has nowhere to go back to.
      if (body.type !== 'star' && !this.bodies.has(body.parentId)) continue;
      this.bodies.set(body.id, body);
      this.emit('add', { body });
      restored += 1;
    }
    return restored;
  }

  /**
   * Replaces the whole system (used by reset, load and import).
   * @returns {{ok: boolean, reason?: string, count: number}}
   */
  load(bodies, { silent = false } = {}) {
    const next = new Map();
    // Anything that is not an object at all (a null in a hand-edited file) is
    // dropped rather than allowed to throw halfway through the import.
    const incoming = (Array.isArray(bodies) ? bodies : []).filter(
      (raw) => raw && typeof raw === 'object',
    );
    const star = incoming.find((raw) => raw.type === 'star');
    const starId = star?.id ?? 'sun';
    const presentIds = new Set(incoming.map((raw) => raw.id).filter(Boolean));

    // Parents must exist before their children, both here and in the scene
    // graph that mirrors this map, so the input is sorted by depth first.
    const parentOf = new Map(incoming.map((raw) => [raw.id, raw.parentId]));
    const depthOf = (id) => {
      let depth = 0;
      let current = id;
      const seen = new Set();
      while (current && !seen.has(current) && depth < 16) {
        seen.add(current);
        const parent = parentOf.get(current);
        if (!parent || !presentIds.has(parent)) break;
        current = parent;
        depth += 1;
      }
      return depth;
    };
    const ordered = incoming
      .map((raw, index) => ({ raw, index, depth: depthOf(raw.id) }))
      .sort((a, b) => a.depth - b.depth || a.index - b.index)
      .map((entry) => entry.raw);

    for (const raw of ordered) {
      const body = normaliseBody(raw, { fallbackType: raw.type ?? 'planet' });
      body.builtIn = raw.builtIn ?? isBuiltInId(body.id);
      if (body.type !== 'star') {
        // A missing or self-referencing parent (a corrupted save, a
        // hand-edited file) is adopted by the star. A moon cannot orbit a star,
        // so it is promoted to a planet: otherwise it would exist in the data
        // but never appear in the body tree.
        if (body.parentId === body.id || !next.has(body.parentId)) {
          body.parentId = starId;
          if (body.type === 'moon') {
            body.type = 'planet';
            body.distanceKm = normaliseBody({ ...body, type: 'planet' }).distanceKm;
          }
        }
      }
      next.set(body.id, body);
    }

    const hasStar = [...next.values()].some((b) => b.type === 'star');
    if (!hasStar) {
      // A system with no star is not a system - fall back to the real one.
      this.bodies = new Map(defaultSystem().map((b) => [b.id, normaliseBody(b)]));
      for (const body of this.bodies.values()) body.builtIn = true;
    } else {
      this.bodies = next;
    }
    this.selectedId = null;
    this.generation += 1;
    if (!silent) this.emit('reset', { bodies: this.list() });
    return hasStar
      ? { ok: true, count: this.bodies.size }
      : { ok: false, reason: 'no-star', count: this.bodies.size };
  }

  reset() {
    const fresh = defaultSystem().map((body) => ({ ...body, builtIn: true }));
    return this.load(fresh);
  }

  /* ------------------------------------------------------------- selection */

  select(id) {
    const next = id && this.bodies.has(id) ? id : null;
    if (next === this.selectedId) return next;
    const previous = this.selectedId;
    this.selectedId = next;
    this.emit('select', { id: next, previous });
    return next;
  }

  get selected() {
    return this.selectedId ? this.get(this.selectedId) : null;
  }

  /* ------------------------------------------------------------ utilities */

  uniqueName(name, ownId) {
    const taken = new Set(
      this.list()
        .filter((body) => body.id !== ownId)
        .map((body) => body.name.toLowerCase()),
    );
    if (!taken.has(name.toLowerCase())) return name;
    let suffix = 2;
    while (taken.has(`${name} ${suffix}`.toLowerCase())) suffix += 1;
    return `${name} ${suffix}`;
  }

  /** Clamp helper shared with the UI so sliders and the store always agree. */
  distanceLimits(id) {
    const body = this.get(id);
    return distanceLimitsFor(body?.type ?? 'planet');
  }

  serialize() {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      bodies: this.list().map((body) => ({ ...body })),
    };
  }
}

function shallowEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === 'object') {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((key) => shallowEqual(a[key], b[key]));
  }
  return false;
}

function depth(body, pool) {
  let d = 0;
  let current = body;
  const byId = new Map(pool.map((item) => [item.id, item]));
  while (current?.parentId && byId.has(current.parentId) && d < 16) {
    current = byId.get(current.parentId);
    d += 1;
  }
  return d;
}

const BUILT_IN_IDS = new Set(defaultSystem().map((body) => body.id));
function isBuiltInId(id) {
  return BUILT_IN_IDS.has(id);
}
