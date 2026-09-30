export const SEASONS = [
  {
    "id": "standard",
    "name": "Buddy",
    "label": "Standard",
    "start": null,
    "end": null,
    "period": "Immer wählbar · sonst in den Pausen",
    "note": "Das feste Markenlogo: unveränderter Buddy mit Blatt, großen Augen und Lächeln.",
    "accent": "#E39860"
  },
  {
    "id": "spring",
    "name": "Bloom Buddy",
    "label": "Frühling",
    "start": "03-01",
    "end": "05-31",
    "period": "1. März – 31. Mai",
    "note": "Blüte am Blatt und fröhliche Lachaugen. Der unverwechselbare Buddy-Kürbis bleibt die Basis.",
    "accent": "#E3A1B1"
  },
  {
    "id": "summer",
    "name": "Sunny Buddy",
    "label": "Sommer",
    "start": "06-01",
    "end": "08-31",
    "period": "1. Juni – 31. August",
    "note": "Eine kleine Palme wächst aus Buddys Stiel. Gestufte Blätter und entspannte Lachaugen bringen den Sommer mit.",
    "accent": "#ADC795"
  },
  {
    "id": "halloween",
    "name": "Hex Buddy",
    "label": "Herbst / Halloween",
    "start": "10-01",
    "end": "11-02",
    "period": "1. Oktober – 2. November",
    "note": "Geknickter Hex-Hut, helle Schnalle und ein freches Zwinkern. Magisch und freundlich.",
    "accent": "#B3A2D6"
  },
  {
    "id": "winter",
    "name": "Frost Buddy",
    "label": "Winter",
    "start": "12-01",
    "end": "02-29",
    "period": "1. Dezember – Ende Februar",
    "note": "Eisblaue Mütze, rosige Wangen und ein anliegender Schal mit seitlichem Knoten und kurzem Ende.",
    "accent": "#9BCDD7"
  }
];

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
