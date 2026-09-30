// Run: pnpm check:branding (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { currentSeason, nextSeasonCheck, SEASONS } from './calendar.ts';
import { seasonForDate } from '../../branding/pumpkin-launcher/seasons.mjs';

for (const [month, day, expected] of [
  [1, 1, 'winter'], [2, 28, 'winter'], [3, 1, 'spring'], [5, 31, 'spring'],
  [6, 1, 'summer'], [8, 31, 'summer'], [9, 1, 'standard'], [9, 30, 'standard'],
  [10, 1, 'halloween'], [11, 2, 'halloween'], [11, 3, 'standard'],
  [11, 30, 'standard'], [12, 1, 'winter'], [12, 31, 'winter'],
]) {
  for (const hour of [0, 12, 23]) assert.equal(currentSeason(new Date(2026, month - 1, day, hour)).id, expected);
  for (const { id } of SEASONS) {
    assert.equal(currentSeason(new Date(2026, month - 1, day), id).id, id, 'Fixed choice ignores every seasonal boundary');
  }
}
assert.equal(currentSeason(new Date(2026, 9, 1), 'auto').id, 'halloween', 'Returning to auto uses the current date');
assert.equal(currentSeason(new Date(2026, 9, 1), 'unknown').id, 'halloween', 'Unknown stored choice falls back to auto');
assert.equal(currentSeason(new Date(2028, 1, 29)).id, 'winter');
for (const invalid of ['', '2026-02-29', '2026-13-01', '2026-04-31']) assert.equal(seasonForDate(invalid), 'standard');
assert.equal(nextSeasonCheck(new Date(2026, 8, 30, 23, 59, 59, 500)), 500);
assert.equal(nextSeasonCheck(new Date(2026, 9, 1)), 60_000);

if (!process.argv.includes('--tz-child')) {
  for (const TZ of ['Europe/Berlin', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
    execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--tz-child'], { env: { ...process.env, TZ } });
  }
  const root = new URL('../../branding/pumpkin-launcher/', import.meta.url);
  for (const { id } of SEASONS) {
    for (const mood of ['idle', 'hello', 'loading', 'success', 'oops', 'sleep', 'poster']) {
      const svg = readFileSync(new URL(`motion/${id}/${mood}.svg`, root), 'utf8');
      assert.match(svg, /viewBox="0 0 48 48"/);
      if (mood !== 'poster') assert.match(svg, /prefers-reduced-motion/);
    }
    assert.match(readFileSync(new URL(`assets/${id}/mark.svg`, root), 'utf8'), /<svg/);
    assert.equal(readFileSync(new URL(`assets/${id}/128x128.png`, root)).subarray(1, 4).toString(), 'PNG');
  }
  console.log('Branding OK: automatic and fixed choices, season boundaries, local midnight, leap year, 3 time zones, all 45 runtime assets.');
}
