import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = new URL('../', import.meta.url);
const source = new URL('branding/pumpkin-launcher/assets/', root);
const target = new URL('src-tauri/icons/', root);
const installerSource = new URL('branding/pumpkin-launcher/installer/', root);
const installerTarget = new URL('src-tauri/installer/', root);
const { run } = createRequire(import.meta.url)('@tauri-apps/cli');

// The canonical SVG draws Pumpkin Block on a fixed 16x16 pixel grid.
await run(['icon', fileURLToPath(new URL('mark.svg', source)), '--output', fileURLToPath(target)]);
for (const filename of ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.ico', 'icon.icns']) {
  await copyFile(new URL(filename, source), new URL(filename, target));
}
await mkdir(installerTarget, { recursive: true });
for (const filename of ['sidebar.bmp', 'header.bmp']) {
  await copyFile(new URL(filename, installerSource), new URL(filename, installerTarget));
}
console.log('Pumpkin Launcher: Pumpkin Block icons and installer artwork synchronized.');
