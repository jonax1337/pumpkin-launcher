import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { currentSeason } from '../src/branding/calendar.ts';

const root = new URL('../', import.meta.url);
const { id } = currentSeason();
const source = new URL(`branding/pumpkin-launcher/assets/${id}/`, root);
const target = new URL('src-tauri/icons/', root);
const { run } = createRequire(import.meta.url)('@tauri-apps/cli');
// Auch die früher generierten Windows-/Mobil-Icons ersetzen; keine alten Zeichen im Paket.
await run(['icon', fileURLToPath(new URL('mark.svg', source)), '--output', fileURLToPath(target)]);
for (const name of ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.ico', 'icon.icns']) {
  await copyFile(new URL(name, source), new URL(name, target));
}
await copyFile(new URL('128x128@2x.png', source), new URL('icon.png', target));
console.log(`Pumpkin Launcher: native Icons für ${id} aktualisiert.`);
