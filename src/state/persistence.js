/**
 * Autosave to localStorage, plus export / import of a system as a JSON file.
 *
 * Everything here fails softly: a browser in private mode, a full quota or a
 * corrupted save must never stop the simulation from starting.
 */

const STORAGE_KEY = 'orbit.system.v1';
const SAVE_DEBOUNCE_MS = 400;

export function loadSavedSystem() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.bodies) || parsed.bodies.length === 0) return null;
    return parsed.bodies;
  } catch {
    return null;
  }
}

export function clearSavedSystem() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing we can do, and nothing that matters */
  }
}

/**
 * Persists the store after every change, debounced so that dragging a slider
 * does not hammer localStorage.
 */
export function attachAutosave(store) {
  let timer = 0;
  let enabled = true;

  const save = () => {
    timer = 0;
    if (!enabled) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store.serialize()));
    } catch {
      enabled = false; // quota or private mode: stop trying, keep running
    }
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, SAVE_DEBOUNCE_MS);
  };

  const unsubscribes = ['add', 'update', 'remove', 'reset'].map((event) =>
    store.on(event, schedule),
  );

  return {
    flush: save,
    detach() {
      if (timer) clearTimeout(timer);
      for (const off of unsubscribes) off();
    },
  };
}

export function exportSystem(store, filename = 'orbit-system.json') {
  const blob = new Blob([JSON.stringify(store.serialize(), null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Opens a file picker and returns the parsed body list, or null if cancelled. */
export function importSystem() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';
    document.body.appendChild(input);

    const cleanup = () => input.remove();

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        cleanup();
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        cleanup();
        try {
          const parsed = JSON.parse(String(reader.result));
          const bodies = Array.isArray(parsed) ? parsed : parsed?.bodies;
          resolve(Array.isArray(bodies) && bodies.length ? bodies : null);
        } catch {
          resolve(null);
        }
      };
      reader.onerror = () => {
        cleanup();
        resolve(null);
      };
      reader.readAsText(file);
    });

    input.addEventListener('cancel', () => {
      cleanup();
      resolve(null);
    });

    input.click();
  });
}
