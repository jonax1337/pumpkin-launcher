// Run: node src/lib/contentList.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { sortRows } from './contentSort.ts';
import { undoUpdate } from './mods.ts';
import { activate, activePacks, deactivate, move, packId } from './packs.ts';

const mod = (id, extra = {}) => ({
  id, name: id, version: '1', source: { type: 'local' }, fileName: `${id}.jar`, sha1: null, enabled: true, kind: 'mod',
  requiredBy: [], pinned: false, packManaged: false, ...extra,
});

// --- Reihenfolge der Ressourcenpakete: das letzte der Datei gewinnt
const a = mod('a', { kind: 'resourcepack', fileName: 'a.zip' });
const b = mod('b', { kind: 'resourcepack', fileName: 'b.zip' });
const selection = ['vanilla', packId(a), 'fabric', packId(b)];
const managed = (id) => id === packId(a) || id === packId(b);
assert.deepEqual(activePacks(selection, [a, b]).map((m) => m.id), ['b', 'a'], 'wichtigstes zuerst');
assert.deepEqual(activePacks(['vanilla', 'file/unknown.zip'], [a, b]), [], 'Unbekanntes zählt nicht');
assert.deepEqual(activate(['vanilla'], 'file/a.zip'), ['vanilla', 'file/a.zip']);
assert.deepEqual(activate(selection, packId(a)), selection, 'schon gewählt');
assert.deepEqual(activate(activate(['vanilla'], packId(a)), packId(b)), ['vanilla', packId(a), packId(b)], 'zweites Paket baut auf dem aktuellen Stand auf');
assert.deepEqual(deactivate(selection, packId(a)), ['vanilla', 'fabric', packId(b)]);
assert.deepEqual(move(selection, packId(a), 'up', managed), ['vanilla', packId(b), 'fabric', packId(a)], 'nach oben = weiter hinten, über Eingebautes hinweg');
assert.deepEqual(move(selection, packId(b), 'down', managed), ['vanilla', packId(b), 'fabric', packId(a)]);
assert.equal(move(selection, packId(b), 'up', managed), selection, 'oben am Rand');
assert.equal(move(selection, packId(a), 'down', managed), selection, 'unten am Rand');
assert.equal(move(selection, 'file/none.zip', 'up', managed), selection, 'nicht gewählt');

// --- Sortierung
const rows = ['Mod 10', 'mod 2', 'Zeta', 'alpha'].map((name, i) => ({ mod: mod(name, { name }), i }));
const facts = new Map([
  ['Mod 10', { modId: 'Mod 10', sizeBytes: 50, modifiedMs: 300 }],
  ['mod 2', { modId: 'mod 2', sizeBytes: 900, modifiedMs: 100 }],
  ['Zeta', { modId: 'Zeta', sizeBytes: 900, modifiedMs: 200 }],
]);
const context = {
  titleOf: (m) => m.name,
  facts,
  statusRank: (m) => (m.name === 'Zeta' ? 0 : m.name === 'alpha' ? 3 : 2),
  language: 'de',
};
const order = (sort) => sortRows(rows, sort, context).map((r) => r.mod.name);
assert.deepEqual(order('default'), ['Mod 10', 'mod 2', 'Zeta', 'alpha'], 'Standard lässt die Reihenfolge');
assert.deepEqual(order('name'), ['alpha', 'mod 2', 'Mod 10', 'Zeta'], 'Zahlen als Zahlen, ohne Groß/Klein');
assert.deepEqual(order('size'), ['mod 2', 'Zeta', 'Mod 10', 'alpha'], 'groß zuerst, Gleiche nach Name, ohne Angabe zuletzt');
assert.deepEqual(order('date'), ['Mod 10', 'Zeta', 'mod 2', 'alpha'], 'neueste zuerst');
assert.deepEqual(order('status'), ['Zeta', 'mod 2', 'Mod 10', 'alpha'], 'Hinweise zuerst, Aus zuletzt');
assert.deepEqual(rows.map((r) => r.mod.name), ['Mod 10', 'mod 2', 'Zeta', 'alpha'], 'Eingabe bleibt unberührt');

// --- Rückgängig nach einem Update
const old = (id, v) => mod(id, { version: v, fileName: `${id}-${v}.jar`, sha1: `${id}${v}` });
const before = [old('sodium', '1'), old('lithium', '1'), mod('iris')];
const after = [old('sodium', '2'), old('lithium', '1'), mod('iris'), mod('cloth')];
const restored = undoUpdate(after, before, after);
assert.deepEqual(restored.map((m) => [m.id, m.version]), [['sodium', '1'], ['lithium', '1'], ['iris', '1']], 'neue Abhängigkeit fällt weg');
assert.equal(restored[0].fileName, 'sodium-1.jar');
const meanwhile = [{ ...after[0], enabled: false, pinned: true }, after[1], after[2], after[3], mod('later')];
const kept = undoUpdate(meanwhile, before, after);
assert.deepEqual(kept.map((m) => m.id), ['sodium', 'lithium', 'iris', 'later'], 'später Hinzugefügtes bleibt');
assert.equal(kept[0].version, '1');
assert.ok(!kept[0].enabled && kept[0].pinned, 'Schalter und Festhalten seit dem Update bleiben');
assert.deepEqual(undoUpdate(before, before, before), before, 'ohne Änderung nichts zu tun');

console.log('contentList.check: ok');
