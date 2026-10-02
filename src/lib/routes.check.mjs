// Run: node src/lib/routes.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { discoverUrl, instanceUrl, newInstanceUrl, readDiscoverParams, readInstanceTab, readNewInstanceStart } from './routes.ts';

const params = (url) => new URL(url, 'app://launcher').searchParams;

// Neue Instanz: jede Adresse, die der Absender baut, liest der Dialog wieder als derselbe Start.
assert.equal(newInstanceUrl(), '/instances?neu=1');
assert.equal(newInstanceUrl({ type: 'import' }), '/instances?neu=import');
assert.equal(newInstanceUrl({ type: 'file', path: '' }), '/instances?neu=file');
for (const start of [{ type: 'blank' }, { type: 'import' }, { type: 'file', path: '' }, { type: 'file', path: 'C:\Spiele\Mein Pack & mehr.mrpack' }]) {
  assert.deepEqual(readNewInstanceStart(params(newInstanceUrl(start))), start);
}
assert.equal(readNewInstanceStart(params('/instances')), null);

// Entdecken: „alle Quellen“ bleibt aus der Adresse, jede einzelne Quelle nicht; ein Projekt nennt seine Quelle als „anbieter“.
assert.equal(discoverUrl(), '/discover');
assert.equal(discoverUrl({ tab: 'mod', source: 'all' }), '/discover?tab=mod');
assert.equal(discoverUrl({ tab: 'mod', source: 'modrinth' }), '/discover?tab=mod&quelle=modrinth');
assert.equal(
  discoverUrl({ tab: 'modpack', project: 'abc', projectSource: 'curseforge' }),
  '/discover?tab=modpack&projekt=abc&anbieter=curseforge',
);
const ftbPack = { tab: 'modpack', source: 'ftb', project: 'abc', projectSource: 'ftb' };
assert.deepEqual(readDiscoverParams(params(discoverUrl(ftbPack))), ftbPack);
// Ohne Projekt gibt es keinen Anbieter in der Adresse.
assert.equal(discoverUrl({ source: 'ftb', projectSource: 'ftb' }), '/discover?quelle=ftb');

// Instanz: unbekannte Tabs fallen auf die Inhalte zurück.
assert.equal(instanceUrl('x1'), '/instances/x1');
assert.equal(instanceUrl('x1', 'console'), '/instances/x1?tab=console');
assert.equal(readInstanceTab(params(instanceUrl('x1', 'worlds'))), 'worlds');
assert.equal(readInstanceTab(params('/instances/x1?tab=gibtsnicht')), 'content');
console.log('routes ok');
