/**
 * BONUS - real cast shadows.
 *
 * The Sun's point light renders a shadow cube map, so a moon passing between
 * its planet and the Sun genuinely eclipses it. Off by default because a
 * point-light shadow map is six render passes.
 */

import { PCFShadowMap } from 'three';

export class Shadows {
  constructor({ renderer, sceneManager, system }) {
    this.renderer = renderer;
    this.sceneManager = sceneManager;
    this.system = system;
    this.active = false;
  }

  enable() {
    if (this.active) return;
    this.active = true;

    const light = this.sceneManager.sunLight;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.camera.near = 0.4;
    light.shadow.camera.far = 2200;
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.03;

    this.applyToBodies(true);
  }

  disable() {
    if (!this.active) return;
    this.active = false;
    const light = this.sceneManager.sunLight;
    light.castShadow = false;
    this.renderer.shadowMap.enabled = false;
    // A point light's shadow is a cube render target: hand it back rather than
    // leaving six 2048x2048 buffers on the GPU for the rest of the session.
    light.shadow.dispose();
    this.applyToBodies(false);
  }

  /** New bodies added while shadows are on need the flags too. */
  refresh() {
    if (this.active) this.applyToBodies(true);
  }

  applyToBodies(enabled) {
    for (const view of this.system.views.values()) {
      const isStar = view.type === 'star';
      view.mesh.castShadow = enabled && !isStar;
      view.mesh.receiveShadow = enabled && !isStar;
      view.mesh.material.needsUpdate = true;
      if (view.rings) {
        view.rings.receiveShadow = enabled;
        view.rings.material.needsUpdate = true;
      }
      if (view.clouds) view.clouds.material.needsUpdate = true;
    }
  }

  update() {}

  dispose() {
    this.disable();
  }
}
