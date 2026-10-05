import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { currentSeason } from '../src/branding/calendar.ts';

const root = new URL('../', import.meta.url);
const { id } = currentSeason();
const source = new URL(`branding/pumpkin-launcher/assets/${id}/`, root);
const target = new URL('src-tauri/icons/', root);
const { run } = createRequire(import.meta.url)('@tauri-apps/cli');
// Das Kürbis-Motiv lässt im 32er-Raster rundum Luft; Taskbar/Explorer zeigen das Icon dadurch zu klein.
// Also auf die belegte Fläche zuschneiden (quadratisch, mittig), bevor die nativen Icons entstehen.
const svg = await readFile(new URL('mark.svg', source), 'utf8');
const rects = [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g)].map(m => m.slice(1).map(Number));
const minX = Math.min(...rects.map(([x]) => x));
const minY = Math.min(...rects.map(([, y]) => y));
const maxX = Math.max(...rects.map(([x, , w]) => x + w));
const maxY = Math.max(...rects.map(([, y, , h]) => y + h));
const side = Math.max(maxX - minX, maxY - minY);
const viewX = minX - Math.floor((side - (maxX - minX)) / 2);
const viewY = minY - Math.floor((side - (maxY - minY)) / 2);
const cropped = svg.replace(/viewBox="[^"]*"/, `viewBox="${viewX} ${viewY} ${side} ${side}"`);
const work = await mkdtemp(join(tmpdir(), 'pumpkin-icon-'));
try {
  const markFile = join(work, 'mark.svg');
  await writeFile(markFile, cropped);
  // Alle nativen Icons (Windows, Mobil, PNGs) kommen aus dem zugeschnittenen SVG; keine alten Zeichen im Paket.
  await run(['icon', markFile, '--output', fileURLToPath(target)]);
  // The in-game entry uses the launcher's unmodified, pixel-sharp 32px mark.
  await copyFile(new URL('32x32.png', source), new URL('mod/src/main/resources/assets/pumpkin_bridge/logo.png', root));
} finally {
  await rm(work, { recursive: true, force: true });
}
console.log(`Pumpkin Launcher: native Icons für ${id} aktualisiert.`);
