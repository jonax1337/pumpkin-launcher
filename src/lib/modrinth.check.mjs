// Run: node src/lib/modrinth.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { isAbsoluteMrpack, modCompatibility, pickVersion, progressLabel, removeWithDependencies, undoRemove } from './modrinth.ts';
for (const path of ['C:\\packs\\test.mrpack', 'C:/packs/test.MRPACK', '/tmp/a.mrpack', '\\\\server\\share\\a.mrpack']) assert.equal(isAbsoluteMrpack(path), true, path);
for (const path of ['test.mrpack', 'C:test.mrpack', '/tmp/test.zip', '', 'https://example.com/a.mrpack']) assert.equal(isAbsoluteMrpack(path), false, path);
const instance = { loader: 'fabric', minecraftVersion: '1.21.1' };
const version = { loaders: ['fabric'], game_versions: ['1.21.1'] };
assert.equal(modCompatibility(instance, version), null);
assert.ok(modCompatibility(undefined, version));
assert.ok(modCompatibility(instance, undefined));
for (const loader of ['vanilla', 'forge', 'quilt', 'neoforge']) assert.ok(modCompatibility({ ...instance, loader }, version));
assert.ok(modCompatibility(instance, { ...version, game_versions: ['1.21'] }));
assert.ok(modCompatibility(instance, { ...version, loaders: ['forge'] }));

// Entfernen mit Abhängigkeiten: Iris und Mod Menu brauchen Fabric API, Sodium braucht nur Iris.
const m = (id, requiredBy = []) => ({ id, name: id, source: { type: 'modrinth', projectId: id, versionId: 'v' }, requiredBy, enabled: true });
const mods = [m('iris'), m('sodium', ['iris']), m('api', ['iris', 'menu']), m('menu'), { ...m('local'), source: { type: 'local' } }];
const r = removeWithDependencies(mods, 'iris');
assert.deepEqual(r.removed.map((x) => x.id), ['iris', 'sodium']);
assert.deepEqual(r.mods.map((x) => [x.id, x.requiredBy]), [['api', ['menu']], ['menu', []], ['local', []]]);
assert.equal(r.mods[1], mods[3], 'unveränderte Einträge bleiben dieselben Objekte');
assert.deepEqual(removeWithDependencies(r.mods, 'menu').removed.map((x) => x.id), ['menu', 'api']);
assert.deepEqual(removeWithDependencies(mods, 'local').removed.map((x) => x.id), ['local']);
assert.deepEqual(removeWithDependencies(mods, 'fehlt').removed, []);
// Rückgängig: Reihenfolge und requiredBy von vorher, Schalter von jetzt, Neues bleibt.
const now = [{ ...r.mods[0], enabled: false }, r.mods[1], r.mods[2], m('neu')];
const undone = undoRemove(now, mods, r.removed);
assert.deepEqual(undone.map((x) => x.id), ['iris', 'sodium', 'api', 'menu', 'local', 'neu']);
assert.deepEqual(undone[2].requiredBy, ['iris', 'menu']);
assert.equal(undone[2].enabled, false);

const v = (id, version_type) => ({ id, version_type });
assert.equal(pickVersion([v('a', 'beta'), v('b', 'release'), v('c', 'release')]).id, 'b');
assert.equal(pickVersion([v('a', 'alpha'), v('b', 'beta')]).id, 'a');
assert.equal(pickVersion([]), null);
assert.equal(progressLabel({ phase: 'resolve', done: 0, total: 1 }), 'Wird geprüft…');
assert.equal(progressLabel({ phase: 'download', done: 2, total: 7 }), 'Lädt 3 von 7…');
console.log('Modrinth checks passed');
