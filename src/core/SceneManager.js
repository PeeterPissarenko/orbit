/**
 * Renderer, camera, controls, lighting and the render loop.
 *
 * Two things here are worth knowing about:
 *
 * 1. Lighting is a single point light sitting inside the Sun with `decay = 0`.
 *    Real inverse-square falloff would leave Neptune in total darkness, but a
 *    non-decaying point light still lights each body from the Sun's direction,
 *    which is what produces the day/night terminator you can see on every
 *    planet. A dim blue ambient keeps night sides readable instead of black.
 *
 * 2. The scene spans from a moon 0.05 units across to a sky sphere 150 000
 *    units away. A conventional depth buffer cannot resolve that range, so the
 *    renderer uses a logarithmic depth buffer.
 */

import {
  ACESFilmicToneMapping,
  AmbientLight,
  BackSide,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PointLight,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { DEG2RAD, clamp } from '../utils/math.js';

const SKY_RADIUS = 150000;

export class SceneManager {
  constructor({ canvas, scale }) {
    this.canvas = canvas;
    this.scale = scale;
    this.frameCallbacks = new Set();
    this.contextLost = false;

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = false;

    this.scene = new Scene();

    this.camera = new PerspectiveCamera(52, 1, 0.02, 400000);
    this.camera.position.set(0, scale.defaultCameraDistance * 0.42, scale.defaultCameraDistance);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.9;
    this.controls.panSpeed = 0.7;
    this.controls.minDistance = 0.05;
    this.controls.maxDistance = scale.maxCameraDistance;
    this.controls.target.set(0, 0, 0);

    this.sunLight = new PointLight(0xfff3dd, 4.2, 0, 0);
    this.sunLight.name = 'sunlight';
    this.scene.add(this.sunLight);

    this.ambient = new AmbientLight(0x2a3a58, 0.34);
    this.scene.add(this.ambient);

    this.sky = null;
    this.lastFrameMs = 0;

    /** Optional: a function returning the world position to keep centred. */
    this.followProvider = null;
    this.flight = null;

    this.handleResize = this.handleResize.bind(this);
    window.addEventListener('resize', this.handleResize);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.handleResize);
      this.resizeObserver.observe(canvas.parentElement ?? canvas);
    }

    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);

    this.handleResize();
  }

  onContextLost = (event) => {
    event.preventDefault();
    this.contextLost = true;
  };

  onContextRestored = () => {
    this.contextLost = false;
  };

  /** The Milky Way, painted on the inside of a very large sphere. */
  addStarfield(texture) {
    if (this.sky) return this.sky;
    const geometry = new SphereGeometry(SKY_RADIUS, 64, 40);
    const material = new MeshBasicMaterial({
      map: texture,
      side: BackSide,
      depthWrite: false,
      toneMapped: false,
    });
    this.sky = new Mesh(geometry, material);
    this.sky.name = 'starfield';
    // The galactic plane is tilted about 60 degrees from the ecliptic.
    this.sky.rotation.x = 60 * DEG2RAD;
    this.sky.rotation.z = 30 * DEG2RAD;
    this.sky.matrixAutoUpdate = false;
    this.sky.updateMatrix();
    this.scene.add(this.sky);
    return this.sky;
  }

  setStarfieldVisible(visible) {
    if (this.sky) this.sky.visible = visible;
  }

  /** Re-derives camera limits after a scale-mode change. */
  applyScale(scale) {
    this.scale = scale;
    this.controls.maxDistance = scale.maxCameraDistance;
    this.frameCamera(scale.defaultCameraDistance);
  }

  frameCamera(distance) {
    const direction = new Vector3()
      .subVectors(this.camera.position, this.controls.target)
      .normalize();
    if (direction.lengthSq() < 1e-6) direction.set(0, 0.42, 1).normalize();
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(direction.multiplyScalar(distance));
    this.controls.update();
  }

  /**
   * Eases the camera towards a body. Distance is chosen so the body fills a
   * comfortable part of the frame whatever its size.
   */
  flyTo(position, radius) {
    const distance = clamp(radius * 5.5, 0.4, this.scale.maxCameraDistance * 0.5);
    const offset = new Vector3()
      .subVectors(this.camera.position, this.controls.target)
      .normalize()
      .multiplyScalar(distance);
    if (!Number.isFinite(offset.x) || offset.lengthSq() < 1e-8) offset.set(0, distance * 0.4, distance);
    this.flight = {
      target: position.clone(),
      position: position.clone().add(offset),
      elapsed: 0,
      duration: 0.85,
    };
  }

  cancelFlight() {
    this.flight = null;
  }

  handleResize() {
    const parent = this.canvas.parentElement ?? document.body;
    const width = Math.max(parent.clientWidth || window.innerWidth, 1);
    const height = Math.max(parent.clientHeight || window.innerHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  /** @param {(dt: number) => void} callback */
  onFrame(callback) {
    this.frameCallbacks.add(callback);
    return () => this.frameCallbacks.delete(callback);
  }

  start() {
    this.lastFrameMs = performance.now();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  stop() {
    this.renderer.setAnimationLoop(null);
  }

  tick() {
    const now = performance.now();
    const dt = Math.min((now - this.lastFrameMs) / 1000, 0.25);
    this.lastFrameMs = now;
    for (const callback of this.frameCallbacks) callback(dt);

    this.updateCamera(dt);
    this.controls.update();

    if (!this.contextLost) this.renderer.render(this.scene, this.camera);
  }

  updateCamera(dt) {
    if (this.flight) {
      this.flight.elapsed += dt;
      const t = clamp(this.flight.elapsed / this.flight.duration, 0, 1);
      const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      this.controls.target.lerp(this.flight.target, eased * 0.35 + 0.05);
      this.camera.position.lerp(this.flight.position, eased * 0.35 + 0.05);
      if (t >= 1) this.flight = null;
      return;
    }

    if (this.followProvider) {
      const next = this.followProvider();
      if (next) {
        const delta = new Vector3().subVectors(next, this.controls.target);
        this.controls.target.copy(next);
        this.camera.position.add(delta);
      }
    }
  }

  screenshot(filename = 'orbit.png') {
    this.renderer.render(this.scene, this.camera);
    this.renderer.domElement.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this.handleResize);
    this.resizeObserver?.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.controls.dispose();
    if (this.sky) {
      this.sky.geometry.dispose();
      this.sky.material.dispose();
    }
    this.renderer.dispose();
  }
}
