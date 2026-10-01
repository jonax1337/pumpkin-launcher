// Run: node src/lib/routes.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { discoverUrl, instanceUrl, newInstanceUrl, readDiscoverParams, readInstanceTab, readNewInstanceStart } from './routes.ts';

const params = (url) => new URL(url, 'app://launcher').searchParams;

// Neue Instanz: jede Adresse, die der Absender baut, liest der Dialog wieder als derselbe Start.
assert.equal(newInstanceUrl(), '/instances?neu=1');
assert.equal(newInstanceUrl({ type: 'import' }), '/instances?neu=import');
for (const start of [{ type: 'blank' }, { type: 'import' }, { type: 'file', path: 'C:\Spiele\Mein Pack & mehr.mrpack' }]) {
  assert.deepEqual(readNewInstanceStart(params(newInstanceUrl(start))), start);
}
assert.equal(readNewInstanceStart(params('/instances')), null);

// Entdecken: Modrinth bleibt aus der Adresse, die Quelle eines Anbieters nicht; die alte Adresse /mods führt zu „mod“.
assert.equal(discoverUrl(), '/discover');
assert.equal(discoverUrl({ tab: 'mod' }), '/discover?tab=mod');
assert.equal(discoverUrl({ tab: 'modpack', source: 'modrinth', project: 'abc' }), '/discover?tab=modpack&projekt=abc');
assert.deepEqual(readDiscoverParams(params(discoverUrl({ tab: 'modpack', source: 'ftb', project: 'abc' }))), { tab: 'modpack', source: 'ftb', project: 'abc' });

// Instanz: unbekannte Tabs fallen auf die Inhalte zurück.
assert.equal(instanceUrl('x1'), '/instances/x1');
assert.equal(instanceUrl('x1', 'console'), '/instances/x1?tab=console');
assert.equal(readInstanceTab(params(instanceUrl('x1', 'worlds'))), 'worlds');
assert.equal(readInstanceTab(params('/instances/x1?tab=gibtsnicht')), 'content');
console.log('routes ok');
