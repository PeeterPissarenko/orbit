/**
 * Material helpers.
 *
 * The interesting one is `applyDayNight`: it patches a standard material so the
 * side of a planet facing away from the Sun reveals its night-time map (city
 * lights on Earth) instead of going flat black. That is the clearest possible
 * demonstration that the scene is genuinely lit by a light source at the Sun's
 * position rather than uniformly.
 */

import { Color, Vector3 } from 'three';

const WHITE = new Color(0xffffff);

/**
 * How strongly a body's colour tints a photographic texture.
 * Full strength would destroy the map; zero would make the colour control feel
 * dead. A quarter reads clearly without turning Earth into a sweet wrapper.
 */
export const PHOTO_TINT = 0.4;

/** The Color a body's material should use, given whether it wears a photo map. */
export function surfaceTint(hexColor, hasPhotoTexture) {
  const color = new Color(hexColor);
  if (!hasPhotoTexture) return color;
  return color.clone().lerpColors(WHITE, color, PHOTO_TINT);
}

const FRAGMENT_HEAD = /* glsl */ `
uniform sampler2D uNightMap;
uniform float uNightIntensity;
uniform vec3 uSunViewPosition;
void main() {`;

/**
 * `vMapUv` only exists when the material has a colour map: three declares it
 * inside `#ifdef USE_MAP`. Guarding the whole block means a body can lose its
 * photographic map (switching Surface to "Painted from colour") without the
 * patched program failing to link.
 */
const NIGHT_INJECTION = /* glsl */ `
	#ifdef USE_MAP
	{
		vec3 fragViewPosition = - vViewPosition;
		vec3 sunDirection = normalize( uSunViewPosition - fragViewPosition );
		float facing = dot( normalize( vNormal ), sunDirection );
		float nightAmount = smoothstep( 0.10, -0.10, facing );
		vec3 cityLights = texture2D( uNightMap, vMapUv ).rgb;
		outgoingLight += cityLights * cityLights * nightAmount * uNightIntensity;
	}
	#endif
	#include <opaque_fragment>`;

/**
 * Adds a night-side emissive pass to a MeshStandardMaterial.
 * Safe to call on any material: if the shader does not look the way we expect
 * (a future three.js reshuffle, say) the patch quietly does nothing.
 */
export function applyDayNight(material, nightMap, intensity = 2.4) {
  if (!material || !nightMap || !material.map) return null;

  // Patch once per material, ever.
  //
  // three caches one compiled program per (parameters + customProgramCacheKey)
  // and only assigns `materialProperties.uniforms` when it compiles a *new*
  // one. Installing a second uniforms object later would leave the renderer
  // uploading into an object nothing reads, so re-attaching just refreshes the
  // values in the object the program was compiled with.
  const existing = material.userData.dayNightUniforms;
  if (existing) {
    existing.uNightMap.value = nightMap;
    existing.uNightIntensity.value = intensity;
    return existing;
  }

  const uniforms = {
    uNightMap: { value: nightMap },
    uNightIntensity: { value: intensity },
    uSunViewPosition: { value: new Vector3() },
  };

  material.onBeforeCompile = (shader) => {
    if (
      !shader.fragmentShader.includes('#include <opaque_fragment>') ||
      !shader.fragmentShader.includes('void main() {')
    ) {
      return;
    }
    shader.uniforms.uNightMap = uniforms.uNightMap;
    shader.uniforms.uNightIntensity = uniforms.uNightIntensity;
    shader.uniforms.uSunViewPosition = uniforms.uSunViewPosition;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', FRAGMENT_HEAD)
      .replace('#include <opaque_fragment>', NIGHT_INJECTION);
  };
  // Without a distinct cache key three would hand us an unpatched program.
  material.customProgramCacheKey = () => 'orbit-day-night';
  material.userData.dayNightUniforms = uniforms;
  material.needsUpdate = true;
  return uniforms;
}

/**
 * Silences the night pass, so a body that stops using a night-mapped surface
 * stops wearing another world's city lights.
 *
 * Deliberately does NOT unpatch the material: swapping the program cache key
 * back and forth would leave the renderer holding a uniforms object the
 * re-compiled program never sees. Turning the intensity down to zero costs one
 * multiply per fragment and is exactly reversible.
 */
export function muteDayNight(material) {
  const uniforms = material?.userData?.dayNightUniforms;
  if (!uniforms) return false;
  uniforms.uNightIntensity.value = 0;
  return true;
}

/** Feeds the Sun's position, in view space, to every patched material. */
export function updateDayNightUniforms(materials, sunWorldPosition, camera) {
  if (materials.length === 0) return;
  const viewPosition = new Vector3()
    .copy(sunWorldPosition)
    .applyMatrix4(camera.matrixWorldInverse);
  for (const material of materials) {
    const uniforms = material.userData?.dayNightUniforms;
    if (uniforms) uniforms.uSunViewPosition.value.copy(viewPosition);
  }
}
