/** Human readable formatting for the numbers shown in the UI and tooltips. */

import { AU_KM } from '../config/scale.js';

const NUMBER = new Intl.NumberFormat('en-GB');
const NUMBER_1 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
const NUMBER_2 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });
const NUMBER_3 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 3 });

export function formatKm(km) {
  const value = Math.abs(km);
  if (value >= 1e9) return `${NUMBER_2.format(km / 1e9)} billion km`;
  if (value >= 1e6) return `${NUMBER_2.format(km / 1e6)} million km`;
  if (value >= 1000) return `${NUMBER.format(Math.round(km))} km`;
  return `${NUMBER_1.format(km)} km`;
}

export function formatAu(km) {
  const au = km / AU_KM;
  if (au >= 100) return `${NUMBER_1.format(au)} AU`;
  if (au >= 0.01) return `${NUMBER_3.format(au)} AU`;
  return `${au.toExponential(2)} AU`;
}

/** "1.00 AU (149.60 million km)" - the phrasing used in the hover card. */
export function formatDistance(km, { withAu = true } = {}) {
  if (!withAu) return formatKm(km);
  return `${formatAu(km)} · ${formatKm(km)}`;
}

export function formatDiameter(radiusKm) {
  return formatKm(radiusKm * 2);
}

/** Orbital period: days for the fast ones, years for the slow ones. */
export function formatPeriod(days) {
  const value = Math.abs(days);
  const sign = days < 0 ? 'retrograde ' : '';
  if (value >= 365.25 * 2) return `${sign}${NUMBER_2.format(value / 365.25)} Earth years`;
  if (value >= 1) return `${sign}${NUMBER_2.format(value)} Earth days`;
  return `${sign}${NUMBER_1.format(value * 24)} hours`;
}

/** Rotation period, expressed the way an atlas would. */
export function formatRotation(hours) {
  const value = Math.abs(hours);
  const suffix = hours < 0 ? ' (retrograde)' : '';
  if (value >= 48) return `${NUMBER_2.format(value / 24)} days${suffix}`;
  return `${NUMBER_2.format(value)} hours${suffix}`;
}

/** Simulation speed, written the way a human would say it. */
export function formatSpeed(daysPerSecond) {
  const v = Math.abs(daysPerSecond);
  if (v < 1e-9) return 'paused';
  if (v >= 365.25) return `${NUMBER_2.format(v / 365.25)} years / second`;
  if (v >= 30) return `${NUMBER_1.format(v / 30.44)} months / second`;
  if (v >= 1) return `${NUMBER_2.format(v)} days / second`;
  return `${NUMBER_1.format(v * 24)} hours / second`;
}

/** Elapsed simulated time. Keeps its sign: time can run backwards here. */
export function formatElapsed(days) {
  const abs = Math.abs(days);
  const sign = days < 0 ? '-' : '';
  const years = Math.floor(abs / 365.25);
  const rest = Math.floor(abs - years * 365.25);
  if (years > 0) return `${sign}${NUMBER.format(years)} y ${rest} d`;
  return `${sign}${NUMBER_1.format(abs)} d`;
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

/** J2000.0 epoch - the reference date the built-in orbital elements start from. */
export const EPOCH_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

export function formatSimulationDate(days) {
  const ms = EPOCH_MS + days * 86400000;
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return '—';
  return DATE_FORMAT.format(new Date(ms));
}

export function formatNumber(value, digits = 2) {
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: digits }).format(value);
}
