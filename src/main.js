/**
 * Entry point.
 *
 * Boots the application, hides the loading screen once the first frame is on
 * screen, and turns any start-up failure (an ancient browser, WebGL disabled,
 * a laptop with the GPU switched off) into a readable message rather than a
 * blank black page.
 */

import './ui/styles.css';
import { App } from './App.js';

const canvas = document.getElementById('viewport');
const uiContainer = document.getElementById('ui');
const boot = document.getElementById('boot');
const bootHint = document.getElementById('boot-hint');

function failToBoot(message, error) {
  if (error) console.error('[Orbit] start-up failed:', error);
  if (!boot || !bootHint) return;
  boot.classList.remove('is-done');
  bootHint.classList.add('is-error');
  bootHint.textContent = message;
}

function hideBootScreen() {
  if (!boot) return;
  boot.classList.add('is-done');
  setTimeout(() => boot.remove(), 600);
}

function hasWebGL() {
  try {
    const probe = document.createElement('canvas');
    return Boolean(
      window.WebGL2RenderingContext &&
        (probe.getContext('webgl2') || probe.getContext('webgl')),
    );
  } catch {
    return false;
  }
}

function main() {
  if (!canvas || !uiContainer) {
    failToBoot('Orbit could not find its canvas. Try reloading the page.');
    return;
  }
  if (!hasWebGL()) {
    failToBoot(
      'This browser cannot open a WebGL window, so the 3D view will not run. ' +
        'Check that hardware acceleration is switched on in your browser settings, then reload.',
    );
    return;
  }

  let app;
  try {
    app = new App({ canvas, uiContainer });
    app.start();
  } catch (error) {
    failToBoot(
      'Orbit could not start. The browser console has the details - hardware acceleration ' +
        'being switched off is the usual cause.',
      error,
    );
    return;
  }

  // Expose the running app for the console: handy while marking or debugging.
  window.orbit = app;

  requestAnimationFrame(() => requestAnimationFrame(hideBootScreen));
}

main();
