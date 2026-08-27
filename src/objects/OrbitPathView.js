/**
 * The visible ellipse a body travels along - and the invisible tube that makes
 * it possible to hover over.
 *
 * A raycast against a one-pixel line is close to impossible with a mouse, so
 * every orbit carries a second, slightly fat tube of geometry that is never
 * drawn (`colorWrite: false`) but is always pickable. Hovering the path is
 * therefore as forgiving as hovering the planet itself.
 */

import {
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  TubeGeometry,
} from 'three';

import { clamp } from '../utils/math.js';

const LINE_SEGMENTS = 320;
const HIT_SEGMENTS = 120;

export class OrbitPathView {
  /**
   * @param {object} body   the body whose orbit this is
   * @param {import('../core/OrbitTrack.js').OrbitTrack} track
   */
  constructor(body, track) {
    this.bodyId = body.id;
    this.track = track;
    this.baseColor = new Color(body.color);
    this.hovered = false;
    this.selected = false;

    this.group = new Object3D();
    this.group.name = `orbit:${body.id}`;

    this.lineMaterial = new LineBasicMaterial({
      color: this.baseColor.clone(),
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    });
    this.line = new Line(new BufferGeometry(), this.lineMaterial);
    this.line.frustumCulled = false;
    this.line.renderOrder = -1;
    this.group.add(this.line);

    // Invisible, but always raycastable.
    this.hitMaterial = new MeshBasicMaterial({
      colorWrite: false,
      depthWrite: false,
    });
    this.hitMesh = new Mesh(new BufferGeometry(), this.hitMaterial);
    this.hitMesh.renderOrder = -2;
    this.hitMesh.userData.orbitOf = body.id;
    this.hitMesh.userData.pickable = 'orbit';
    this.group.add(this.hitMesh);

    this.rebuildHandle = 0;
    this.rebuildNow();
  }

  /**
   * Regenerates both curves, at most once per animation frame.
   * A slider drag fires input events far faster than the display refreshes,
   * and each rebuild allocates a 320-point line and a tube.
   */
  rebuild() {
    if (this.rebuildHandle) return;
    this.rebuildHandle = requestAnimationFrame(() => {
      this.rebuildHandle = 0;
      this.rebuildNow();
    });
  }

  rebuildNow() {
    const points = this.track.samplePath(LINE_SEGMENTS);
    // Close the loop explicitly so the line meets itself exactly.
    const linePoints = [...points, points[0].clone()];

    const lineGeometry = new BufferGeometry().setFromPoints(linePoints);
    this.line.geometry.dispose();
    this.line.geometry = lineGeometry;

    const curve = new CatmullRomCurve3(points, true, 'centripetal');
    // Fat enough to hover comfortably, capped so a distant orbit's pick tube
    // does not become a wall that swallows everything else.
    const radius = clamp(this.track.semiMajor * 0.02, 0.03, 9);
    const hitGeometry = new TubeGeometry(curve, HIT_SEGMENTS, radius, 4, true);
    this.hitMesh.geometry.dispose();
    this.hitMesh.geometry = hitGeometry;
  }

  setColor(hex) {
    this.baseColor.set(hex);
    this.applyState();
  }

  setHovered(hovered) {
    if (this.hovered === hovered) return;
    this.hovered = hovered;
    this.applyState();
  }

  setSelected(selected) {
    if (this.selected === selected) return;
    this.selected = selected;
    this.applyState();
  }

  setVisible(visible) {
    this.line.visible = visible;
  }

  applyState() {
    const emphasised = this.hovered || this.selected;
    this.lineMaterial.color.copy(this.baseColor);
    if (emphasised) this.lineMaterial.color.offsetHSL(0, 0.1, 0.22);
    this.lineMaterial.opacity = this.hovered ? 0.95 : this.selected ? 0.75 : 0.34;
  }

  dispose() {
    if (this.rebuildHandle) cancelAnimationFrame(this.rebuildHandle);
    this.line.geometry.dispose();
    this.lineMaterial.dispose();
    this.hitMesh.geometry.dispose();
    this.hitMaterial.dispose();
    this.group.removeFromParent();
  }
}
