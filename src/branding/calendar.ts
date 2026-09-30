import { SEASONS, seasonForDate, type SeasonId } from '../../branding/pumpkin-launcher/seasons.mjs';

export { SEASONS };
export type { SeasonId } from '../../branding/pumpkin-launcher/seasons.mjs';
export type PumpkinChoice = 'auto' | SeasonId;

/** Kalender des Nutzers, auch kurz vor/nach Mitternacht unabhängig von UTC. */
export function currentSeason(date = new Date(), choice: PumpkinChoice = 'auto') {
  const fixed = SEASONS.find((season) => season.id === choice);
  if (fixed) return fixed;
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return SEASONS.find((season) => season.id === seasonForDate(iso))!;
}

export function nextSeasonCheck(date = new Date()) {
  const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  // Auch eine geänderte Systemzeit innerhalb einer Minute übernehmen.
  return Math.max(1, Math.min(60_000, midnight.getTime() - date.getTime()));
}
