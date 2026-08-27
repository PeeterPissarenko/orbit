/**
 * One celestial body, as Three.js objects.
 *
 * Node layout (a planet with a moon):
 *
 *   anchor            sits at the centre of the parent body
 *   +- orbit.group    the ellipse and its invisible pick tube
 *   +- pivot          moved to the orbital position every frame
 *      +- tilt        the axial tilt
 *      |  +- mesh     the sphere itself (spins inside the tilt)
 *      |  +- clouds
 *      |  +- rings
 *      +- halo        atmosphere, untilted so the rim glow stays circular
 *      +- marker      hover / selection ring, billboarded at the camera
 *      +- children    where a moon's own `anchor` gets attached
 *
 * Keeping the moon holder on the pivot rather than on the tilt is what makes a
 * moon follow its planet without inheriting its wobble.
 */

import {
  AdditiveBlending,
  BackSide,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';

import { OrbitTrack } from '../core/OrbitTrack.js';
import { DEG2RAD, TAU, hashString } from '../utils/math.js';
import { seedFor } from '../state/bodySchema.js';
import { applyDayNight, muteDayNight, surfaceTint } from './materials.js';
import { OrbitPathView } from './OrbitPathView.js';

/** Shared geometry - every sphere in the scene is this one, scaled. */
export const SPHERE_GEOMETRY = new SphereGeometry(1, 64, 32);
const MARKER_GEOMETRY = new RingGeometry(1.28, 1.325, 72);

/** How long a colour has to hold still before its surface is repainted. */
const PAINT_DEBOUNCE_MS = 260;

/**
 * The atmospheric rim glow.
 *
 * The renderer runs with a logarithmic depth buffer, so this custom shader has
 * to include the same log-depth chunks the built-in materials do; without them
 * it would write depth on a different curve from everything else and sort
 * wrongly against the planet it wraps.
 */
const HALO_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vViewNormal;
varying vec3 vViewPositionH;
void main() {
	vViewNormal = normalize( normalMatrix * normal );
	vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
	vViewPositionH = mvPosition.xyz;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
}`;

const HALO_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uOpacity;
uniform float uPower;
varying vec3 vViewNormal;
varying vec3 vViewPositionH;
void main() {
	#include <logdepthbuf_fragment>
	float rim = 1.0 - abs( dot( normalize( vViewNormal ), normalize( - vViewPositionH ) ) );
	float strength = pow( clamp( rim, 0.0, 1.0 ), uPower );
	gl_FragColor = vec4( uColor, strength * uOpacity );
	#include <colorspace_fragment>
}`;

/** Radial UVs, so a ring strip texture runs from the inner to the outer edge. */
function createRingGeometry(innerUnits, outerUnits) {
  const geometry = new RingGeometry(innerUnits, outerUnits, 160, 1);
  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const point = new Vector3();
  const span = Math.max(outerUnits - innerUnits, 1e-6);
  for (let i = 0; i < position.count; i += 1) {
    point.fromBufferAttribute(position, i);
    uv.setXY(i, (point.length() - innerUnits) / span, 0.5);
  }
  uv.needsUpdate = true;
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

export class BodyView {
  /**
   * @param {object} body
   * @param {object} context  { scale, textures, dayNightMaterials }
   */
  constructor(body, context) {
    this.id = body.id;
    this.type = body.type;
    this.context = context;
    this.body = body;
    this.disposed = false;
    this.proceduralToken = 0;
    this.paintTimer = 0;
    this.painted = false;
    this.proceduralKey = null;
    this.radiusUnits = 1;
    this.parentRadiusUnits = 0;
    this.spinPhase = 0;

    this.anchor = new Object3D();
    this.anchor.name = `anchor:${body.id}`;

    this.pivot = new Object3D();
    this.pivot.name = `pivot:${body.id}`;
    this.anchor.add(this.pivot);

    this.tilt = new Object3D();
    this.pivot.add(this.tilt);

    this.children = new Object3D();
    this.children.name = `children:${body.id}`;
    this.pivot.add(this.children);

    this.track = new OrbitTrack();

    this.material = this.createSurfaceMaterial(body);
    this.mesh = new Mesh(SPHERE_GEOMETRY, this.material);
    this.mesh.name = body.name;
    this.mesh.userData.pickable = 'body';
    this.mesh.userData.bodyId = body.id;
    this.tilt.add(this.mesh);

    this.clouds = null;
    this.rings = null;
    this.halo = null;
    this.glow = null;

    this.marker = new Mesh(
      MARKER_GEOMETRY,
      new MeshBasicMaterial({
        color: 0x9ad0ff,
        transparent: true,
        opacity: 0.9,
        side: DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.marker.visible = false;
    this.marker.renderOrder = 12;
    this.pivot.add(this.marker);

    this.orbit = body.type === 'star' ? null : new OrbitPathView(body, this.track);
    if (this.orbit) this.anchor.add(this.orbit.group);

    this.applyGeometry(body);
    this.applyAppearance(body);
  }

  /* ------------------------------------------------------------ materials */

  createSurfaceMaterial(body) {
    if (body.type === 'star') {
      return new MeshBasicMaterial({
        color: new Color(body.color),
        toneMapped: true,
      });
    }
    return new MeshStandardMaterial({
      color: new Color(body.color),
      roughness: 0.92,
      metalness: 0.0,
    });
  }

  /**
   * Applies colour, texture, clouds, rings and atmosphere.
   * Called on creation and whenever an appearance property changes.
   */
  applyAppearance(body) {
    this.body = body;
    const { textures } = this.context;
    const set = textures.setFor(body.textureId);

    // Invalidate any procedural paint job still in flight or still waiting.
    this.proceduralToken += 1;
    const token = this.proceduralToken;
    clearTimeout(this.paintTimer);

    const isStar = body.type === 'star';

    if (set) {
      // Moving to a photograph gives up this body's painted surface.
      textures.release(this.proceduralKey);
      this.proceduralKey = null;
      this.painted = false;
      // The same Texture instance doubles as the bump map: three samples data
      // maps raw, so there is no reason to upload the image to the GPU twice.
      const map = textures.file(set.file);
      this.material.map = map;
      if (!isStar) {
        this.material.bumpMap = set.bumpFromMap ? map : null;
        this.material.bumpScale = set.bumpFromMap ? set.bumpFromMap * 0.05 : 0;
        this.material.emissiveMap = null;
        this.material.emissive.setRGB(0, 0, 0);
      }
      this.material.color.copy(surfaceTint(body.color, true));

      if (set.nightFile && !isStar) {
        applyDayNight(this.material, textures.file(set.nightFile));
        this.context.dayNightMaterials.add(this.material);
      } else {
        muteDayNight(this.material);
      }
    } else {
      // Painted from the body's own colour.
      muteDayNight(this.material);
      this.material.map = null;
      if (!isStar) {
        this.material.bumpMap = null;
        this.material.emissiveMap = null;
        this.material.emissive.setRGB(0, 0, 0);
      }
      // The colour lands immediately; the painted surface follows.
      this.material.color.copy(surfaceTint(body.color, false));

      // Dragging the colour picker fires an input event per pixel of travel.
      // Painting a surface for each of them would queue hundreds of megabytes
      // of canvas work, so the request waits for the drag to settle.
      const request = () => {
        const size = body.type === 'moon' || body.radiusKm < 1500 ? 256 : 512;
        textures
          .requestProcedural({
            style: body.surfaceStyle,
            color: body.color,
            seed: seedFor(body),
            size,
          })
          .then((painted) => {
            if (this.disposed || token !== this.proceduralToken) {
              // Superseded before it landed: nobody adopted this surface, so
              // let the library reclaim it rather than leaving it stranded.
              textures.discard(painted.key);
              return;
            }
            if (this.proceduralKey !== painted.key) {
              // Only swap references when the key genuinely changed: releasing
              // and re-retaining the same key could dispose it in between.
              textures.release(this.proceduralKey);
              this.proceduralKey = painted.key;
              textures.retain(painted.key);
            }
            this.material.map = painted.map;
            if (!isStar) {
              this.material.bumpMap = painted.bumpMap;
              this.material.bumpScale = 0.04;
              if (painted.emissiveMap) {
                this.material.emissiveMap = painted.emissiveMap;
                this.material.emissive.setRGB(1, 1, 1);
                this.material.emissiveIntensity = 0.85;
              }
            }
            this.material.color.setRGB(1, 1, 1);
            this.material.needsUpdate = true;
          });
      };
      if (this.painted) this.paintTimer = setTimeout(request, PAINT_DEBOUNCE_MS);
      else request();
      this.painted = true;
    }
    this.material.needsUpdate = true;

    this.applyClouds(body, set);
    this.applyRings(body);
    this.applyHalo(body);
    this.applyGlow(body);
    this.orbit?.setColor(body.color);
  }

  applyClouds(body, set) {
    const config = set?.cloud;
    if (!config) {
      if (this.clouds) {
        this.clouds.removeFromParent();
        this.clouds.material.dispose();
        this.clouds = null;
      }
      return;
    }
    const { textures } = this.context;
    const texture = textures.file(config.file);
    if (!this.clouds) {
      const material = new MeshStandardMaterial({
        transparent: true,
        depthWrite: false,
        roughness: 1,
        metalness: 0,
      });
      this.clouds = new Mesh(SPHERE_GEOMETRY, material);
      this.clouds.renderOrder = 1;
      this.tilt.add(this.clouds);
    }
    const material = this.clouds.material;
    material.map = texture;
    // Earth's cloud map is white-on-black, so it is its own alpha channel.
    material.alphaMap = config.useAlpha ? texture : null;
    material.opacity = config.opacity;
    material.needsUpdate = true;
    this.clouds.userData.driftDegPerDay = config.driftDegPerDay ?? 0;
    this.clouds.userData.scale = config.scale ?? 1.01;
    this.clouds.scale.setScalar(this.radiusUnits * this.clouds.userData.scale);
  }

  applyRings(body) {
    if (!body.rings) {
      if (this.rings) {
        this.rings.geometry.dispose();
        this.rings.material.dispose();
        this.rings.removeFromParent();
        this.rings = null;
      }
      return;
    }
    const { textures } = this.context;
    // Ring radii are derived from the body's *rendered* radius rather than run
    // through the size scale again: a tiny moon whose radius has hit the
    // minimum-visible floor would otherwise get a ring hidden inside itself.
    const ratio = this.radiusUnits / Math.max(body.radiusKm, 1e-6);
    const inner = body.rings.innerKm * ratio;
    const outer = Math.max(body.rings.outerKm * ratio, inner * 1.05);
    const geometry = createRingGeometry(inner, outer);

    // One neutral strip per body identity, tinted per body: keyed on the id
    // alone, so dragging the ring or body colour never paints a new canvas.
    const map = body.rings.textureId
      ? textures.ringTexture(body.rings.textureId)
      : textures.ringStrip(hashString(body.id));

    if (!this.rings) {
      this.rings = new Mesh(
        geometry,
        new MeshBasicMaterial({
          side: DoubleSide,
          transparent: true,
          depthWrite: false,
          toneMapped: true,
        }),
      );
      this.rings.renderOrder = 2;
      this.tilt.add(this.rings);
    } else {
      this.rings.geometry.dispose();
      this.rings.geometry = geometry;
    }
    const material = this.rings.material;
    material.map = map;
    // A photographic ring is tinted the same gentle way a photographic surface
    // is, so the ring colour control still does something on Saturn.
    material.color.copy(surfaceTint(body.rings.color, Boolean(body.rings.textureId)));
    material.opacity = body.rings.opacity;
    material.needsUpdate = true;
  }

  /** The Sun's corona: a billboarded additive sprite, not post-processing. */
  applyGlow(body) {
    if (body.type !== 'star') return;
    if (!this.glow) {
      this.glow = new Sprite(
        new SpriteMaterial({
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          toneMapped: false,
        }),
      );
      this.glow.renderOrder = 4;
      this.pivot.add(this.glow);
    }
    // A single white gradient, tinted by the star's colour: regenerating a
    // 256x256 canvas on every input event of the colour picker would stutter.
    if (!this.glow.material.map) this.glow.material.map = this.context.textures.glow();
    this.glow.material.color.set(body.color);
    this.glow.material.opacity = 0.85;
    this.glow.material.needsUpdate = true;
    this.glow.scale.setScalar(this.radiusUnits * 7.5);
  }

  applyHalo(body) {
    if (!body.atmosphere) {
      if (this.halo) {
        this.halo.material.dispose();
        this.halo.removeFromParent();
        this.halo = null;
      }
      return;
    }
    if (!this.halo) {
      const material = new ShaderMaterial({
        vertexShader: HALO_VERTEX,
        fragmentShader: HALO_FRAGMENT,
        uniforms: {
          uColor: { value: new Color(body.atmosphere.color) },
          uOpacity: { value: body.atmosphere.opacity },
          uPower: { value: 2.6 },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: BackSide,
      });
      this.halo = new Mesh(SPHERE_GEOMETRY, material);
      this.halo.renderOrder = 3;
      this.pivot.add(this.halo);
    }
    const uniforms = this.halo.material.uniforms;
    uniforms.uColor.value.set(body.atmosphere.color);
    uniforms.uOpacity.value = body.atmosphere.opacity;
    this.halo.scale.setScalar(this.radiusUnits * (body.atmosphere.scale + 0.03));
  }

  /* ------------------------------------------------------------- geometry */

  /** Radius, tilt and everything that depends on them. */
  applyGeometry(body) {
    const { scale } = this.context;
    this.radiusUnits = scale.bodyRadius(body.radiusKm, { star: body.type === 'star' });
    this.mesh.scale.setScalar(this.radiusUnits);
    this.tilt.rotation.z = body.axialTiltDeg * DEG2RAD;
    this.marker.scale.setScalar(this.radiusUnits);
    if (this.clouds) this.clouds.scale.setScalar(this.radiusUnits * this.clouds.userData.scale);
    if (this.halo && body.atmosphere) {
      this.halo.scale.setScalar(this.radiusUnits * (body.atmosphere.scale + 0.03));
    }
    if (this.glow) this.glow.scale.setScalar(this.radiusUnits * 7.5);
    // Ring radii are derived from the rendered radius, so they move with it.
    if (this.rings) this.applyRings(body);
  }

  /**
   * Recomputes the orbit from the body's elements.
   * A moon needs its parent's real radius and its rendered radius, because its
   * orbit is expressed in planet radii (see `scale.moonOrbitRadius`).
   *
   * @param {object} body
   * @param {BodyView|null} parentView
   */
  applyOrbit(body, parentView = null) {
    if (body.type === 'star') return;
    const { scale } = this.context;
    this.parentRadiusUnits = parentView?.radiusUnits ?? 0;
    const semiMajor =
      body.type === 'moon' && parentView
        ? scale.moonOrbitRadius(
            body.distanceKm,
            parentView.body.radiusKm,
            parentView.radiusUnits,
            this.radiusUnits,
          )
        : scale.orbitDistance(body.distanceKm);

    this.track.set({
      semiMajor,
      eccentricity: body.eccentricity,
      periodDays: body.orbitalPeriodDays,
      inclinationDeg: body.inclinationDeg,
      ascendingNodeDeg: body.ascendingNodeDeg,
      argPeriapsisDeg: body.argPeriapsisDeg,
      meanAnomalyDeg: body.meanAnomalyDeg,
    });
    this.orbit?.rebuild();
  }

  /* -------------------------------------------------------------- runtime */

  /** Places the body for a given simulation time. */
  updateTransform(days) {
    if (this.type !== 'star') {
      this.track.positionAt(days, this.pivot.position);
    }
    const period = this.body.rotationPeriodHours;
    if (Number.isFinite(period) && Math.abs(period) > 1e-6) {
      const turns = ((days * 24) / period) % 1;
      this.spinPhase = turns * TAU;
      this.mesh.rotation.y = this.spinPhase;
      if (this.clouds) {
        const drift = ((days * (this.clouds.userData.driftDegPerDay ?? 0)) / 360) % 1;
        this.clouds.rotation.y = this.spinPhase + drift * TAU;
      }
    }
  }

  /** Billboards the hover / selection ring. */
  faceCamera(camera) {
    if (!this.marker.visible) return;
    this.marker.quaternion.copy(camera.quaternion);
  }

  setMarker(state) {
    if (state === 'none') {
      this.marker.visible = false;
      return;
    }
    this.marker.visible = true;
    this.marker.material.color.set(state === 'selected' ? '#8ec9ff' : '#ffffff');
    this.marker.material.opacity = state === 'selected' ? 0.6 : 0.32;
  }

  worldPosition(target = new Vector3()) {
    return this.pivot.getWorldPosition(target);
  }

  /** Screen-space radius in world units, used to frame the camera on a body. */
  get focusDistance() {
    return Math.max(this.radiusUnits * 6, 1.2);
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.paintTimer);
    this.context.textures.release(this.proceduralKey);
    this.proceduralKey = null;
    this.context.dayNightMaterials.delete(this.material);
    this.material.dispose();
    this.marker.material.dispose();
    if (this.clouds) this.clouds.material.dispose();
    if (this.rings) {
      this.rings.geometry.dispose();
      this.rings.material.dispose();
    }
    if (this.halo) this.halo.material.dispose();
    if (this.glow) this.glow.material.dispose();
    this.orbit?.dispose();
    this.anchor.removeFromParent();
  }
}
