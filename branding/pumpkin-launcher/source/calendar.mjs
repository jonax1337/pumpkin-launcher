export function seasonForDate(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return 'standard';
  const parsed = new Date(isoDate + 'T12:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== isoDate) return 'standard';
  const md = isoDate.slice(5);
  return SEASONS.find(s => s.start && (s.start <= s.end ? md >= s.start && md <= s.end : md >= s.start || md <= s.end))?.id ?? 'standard';
}
// Runnable boundary check, using the same resolver as the browser preview.
if (typeof process !== 'undefined' && process.argv.includes('--check')) {
  const { strictEqual } = await import('node:assert');
  for (const [date, expected] of [
    ['2026-01-01','winter'],['2026-02-28','winter'],['2028-02-29','winter'],
    ['2026-03-01','spring'],['2026-05-31','spring'],['2026-06-01','summer'],
    ['2026-08-31','summer'],['2026-09-01','standard'],['2026-09-30','standard'],
    ['2026-10-01','halloween'],['2026-11-02','halloween'],['2026-11-03','standard'],
    ['2026-11-30','standard'],['2026-12-01','winter'],['2026-12-31','winter'],
    ['2026-02-29','standard'],['2026-13-01','standard'],['','standard']
  ]) strictEqual(seasonForDate(date), expected, date);
  console.log('18 season/date boundary checks passed');
}
