// Run: pnpm check:branding. Verify the fixed brand across native and embedded surfaces.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../../', import.meta.url);
const brand = new URL('branding/pumpkin-launcher/', root);
const read = path => readFileSync(new URL(path, root));
const mark = readFileSync(new URL('assets/mark.svg', brand));
assert.match(mark.toString(), /viewBox="0 0 16 16"/);
assert.doesNotMatch(mark.toString(), /<animate|<image|<script/);
assert.deepEqual(read('app-icon.svg'), mark);
assert.deepEqual(read('branding/pumpkin-launcher/web/favicon.svg'), mark);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', brand)));
assert.equal(manifest.identity, 'Pumpkin Block');
assert.deepEqual(manifest.canvas, [16, 16]);
assert.equal(manifest.grid, 16);
assert.equal(manifest.reference.replacementFonts, false);
const wordmark = read('branding/pumpkin-launcher/wordmark/light.svg').toString();
assert.match(wordmark, /viewBox="0 0 357 40"/);
assert.doesNotMatch(wordmark, /<image|<text|font-family/);
for (const [path, info] of Object.entries(manifest.files)) {
  const bytes = readFileSync(new URL(path, brand));
  assert.equal(bytes.length, info.bytes, path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), info.sha256, path);
}
for (const filename of ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.ico', 'icon.icns']) {
  assert.deepEqual(read('src-tauri/icons/' + filename), read('branding/pumpkin-launcher/assets/' + filename), filename);
}
for (const filename of ['logo.png', 'icon.png']) {
  assert.deepEqual(read('mod/src/main/resources/assets/pumpkin_bridge/' + filename), read('branding/pumpkin-launcher/assets/32x32.png'), filename);
}
for (const filename of ['sidebar.bmp', 'header.bmp']) {
  assert.deepEqual(read('src-tauri/installer/' + filename), read('branding/pumpkin-launcher/installer/' + filename), filename);
}
assert.ok(readdirSync(new URL('assets/', brand)).every(name => !['spring', 'summer', 'halloween', 'winter', 'standard'].includes(name)));
console.log('Branding OK: clean Pumpkin Block pixel grids, manifest hashes, identical app/mod/native icons and installer artwork.');
