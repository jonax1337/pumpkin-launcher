// Run: node src/pages/instances/libraryModel.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { hasFilters, matchesFilters, movedGroup, NO_FILTERS, orderedGroups, rangeBetween, sectionsOf, versionsOf } from './libraryModel.ts';

const inst = (id, name, minecraftVersion, loader, group = null) => ({ id, name, minecraftVersion, loader, group });
const survival = inst('a', 'Survival', '1.21.4', 'fabric', 'Freunde');
const create = inst('b', 'Create', '1.20.1', 'forge', 'Modpacks');
const vanilla = inst('c', 'Vanilla', '1.21.4', 'vanilla');

// Filter: Suche (Name oder Version), Loader und Version wirken zusammen.
assert.ok(matchesFilters(survival, NO_FILTERS));
assert.ok(matchesFilters(survival, { ...NO_FILTERS, query: ' SURV ' }));
assert.ok(matchesFilters(create, { ...NO_FILTERS, query: '1.20' }));
assert.ok(!matchesFilters(create, { ...NO_FILTERS, loader: 'fabric' }));
assert.ok(matchesFilters(vanilla, { ...NO_FILTERS, version: '1.21.4' }));
assert.ok(!matchesFilters(create, { ...NO_FILTERS, version: '1.21.4' }));

assert.ok(!hasFilters(NO_FILTERS));
assert.ok(!hasFilters({ ...NO_FILTERS, query: '  ' }));
assert.ok(hasFilters({ ...NO_FILTERS, version: '1.20.1' }));

// Versionen: einmal je Version, die höchste zuerst (numerisch, nicht alphabetisch).
assert.deepEqual(versionsOf([create, survival, vanilla, inst('d', 'Alt', '1.9', 'vanilla')]), ['1.21.4', '1.20.1', '1.9']);

// Gruppen: gewählte Reihenfolge zuerst, Neue und Unbekannte danach; Verschieben tauscht Nachbarn und hält am Rand an.
assert.deepEqual(orderedGroups(['A', 'B', 'C'], ['C', 'X', 'A']), ['C', 'A', 'B']);
assert.deepEqual(movedGroup(['A', 'B', 'C'], 'B', -1), ['B', 'A', 'C']);
assert.deepEqual(movedGroup(['A', 'B', 'C'], 'B', 1), ['A', 'C', 'B']);
assert.deepEqual(movedGroup(['A', 'B', 'C'], 'A', -1), ['A', 'B', 'C']);
assert.deepEqual(movedGroup(['A', 'B', 'C'], 'C', 1), ['A', 'B', 'C']);
assert.deepEqual(movedGroup(['A', 'B'], 'Z', 1), ['A', 'B']);

// Abschnitte: Reihenfolge der Gruppen, ohne Gruppe zuletzt, leere Abschnitte entfallen.
const sections = sectionsOf([survival, create, vanilla], ['Modpacks', 'Freunde', 'Leer']);
assert.deepEqual(sections.map(([group, members]) => [group, members.map((i) => i.id)]), [['Modpacks', ['b']], ['Freunde', ['a']], [null, ['c']]]);
assert.deepEqual(sectionsOf([survival], ['Freunde']).map(([group]) => group), ['Freunde']);

// Bereich (Umschalt-Klick): in beide Richtungen gleich, ohne bekannte Enden leer.
const ids = ['a', 'b', 'c', 'd'];
assert.deepEqual(rangeBetween(ids, 'b', 'd'), ['b', 'c', 'd']);
assert.deepEqual(rangeBetween(ids, 'd', 'b'), ['b', 'c', 'd']);
assert.deepEqual(rangeBetween(ids, 'a', 'a'), ['a']);
assert.deepEqual(rangeBetween(ids, 'a', 'z'), []);

console.log('libraryModel.check.mjs: ok');
