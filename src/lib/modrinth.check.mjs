// Run: node src/lib/modrinth.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { modLoadersFor, pickPackVersion, pickVersion, progressLabel, progressShare, progressShortLabel, removeWithDependencies, undoRemove } from './modrinth.ts';

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

// Pack-Version: jeder unterstützte Loader, stabil bevorzugt, sonst Grund.
const pv = (id, loaders, version_type = 'release') => ({ id, loaders, version_type });
assert.equal(pickPackVersion([pv('x', ['liteloader']), pv('b', ['fabric'], 'beta'), pv('r', ['quilt'])]).version.id, 'r');
assert.equal(pickPackVersion([pv('v', ['minecraft'])]).version.id, 'v');
assert.equal(pickPackVersion([pv('f', ['forge'], 'beta'), pv('n', ['neoforge'])]).version.id, 'n');
assert.deepEqual(pickPackVersion([pv('x', ['liteloader'])]), { version: null, reason: 'Keine unterstützte Version' });
assert.ok(pickPackVersion([]).reason);
assert.deepEqual(modLoadersFor('quilt'), ['quilt', 'fabric']);
assert.deepEqual(modLoadersFor('vanilla'), []);
// Fortschritt: Sichern zeigt Balken und Text, Kurzform für Zeilen.
assert.equal(progressShare({ phase: 'backup', done: 6, total: 24 }), 0.25);
assert.equal(progressShare({ phase: 'extract', done: 1, total: 2 }), null);
assert.equal(progressLabel({ phase: 'backup', done: 6, total: 24 }), 'Sichert 6 von 24…');
assert.equal(progressShortLabel({ phase: 'hash', done: 1, total: 2 }), 'Erkennt');
console.log('Modrinth checks passed');
