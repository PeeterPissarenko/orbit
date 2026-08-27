/**
 * Downloads the planetary texture maps used by Orbit.
 *
 * The textures are published by Solar System Scope (https://www.solarsystemscope.com/textures/)
 * under the Creative Commons Attribution 4.0 International licence and are based on
 * NASA elevation and imagery data. See public/textures/CREDITS.md for the full attribution.
 *
 * Usage:  npm run textures:fetch          (skips files that already exist)
 *         npm run textures:fetch -- --force  (re-downloads everything)
 */

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'public', 'textures');
const BASE_URL = 'https://www.solarsystemscope.com/textures/download/';
const FORCE = process.argv.includes('--force');

const FILES = [
  '2k_sun.jpg',
  '2k_mercury.jpg',
  '2k_venus_surface.jpg',
  '2k_venus_atmosphere.jpg',
  '2k_earth_daymap.jpg',
  '2k_earth_nightmap.jpg',
  '2k_earth_clouds.jpg',
  '2k_moon.jpg',
  '2k_mars.jpg',
  '2k_jupiter.jpg',
  '2k_saturn.jpg',
  '2k_saturn_ring_alpha.png',
  '2k_uranus.jpg',
  '2k_neptune.jpg',
  '2k_ceres_fictional.jpg',
  '2k_eris_fictional.jpg',
  '2k_haumea_fictional.jpg',
  '2k_makemake_fictional.jpg',
  '2k_stars_milky_way.jpg',
];

async function exists(path) {
  try {
    const s = await stat(path);
    return s.size > 0;
  } catch {
    return false;
  }
}

async function download(name) {
  const target = join(OUT_DIR, name);
  if (!FORCE && (await exists(target))) {
    console.log(`  skip     ${name} (already present)`);
    return { name, skipped: true };
  }
  const res = await fetch(BASE_URL + name, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${name}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(target, buf);
  console.log(`  saved    ${name} (${(buf.length / 1024).toFixed(0)} kB)`);
  return { name, bytes: buf.length };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Fetching ${FILES.length} texture maps into public/textures ...`);
  const failures = [];
  for (const name of FILES) {
    try {
      await download(name);
    } catch (err) {
      failures.push(name);
      console.warn(`  FAILED   ${name}: ${err.message}`);
    }
  }
  if (failures.length) {
    console.warn(
      `\n${failures.length} texture(s) could not be downloaded. Orbit still runs: ` +
        'every body falls back to a procedurally generated texture when its file is missing.',
    );
    process.exitCode = 0;
  } else {
    console.log('\nAll textures downloaded.');
  }
}

main();
