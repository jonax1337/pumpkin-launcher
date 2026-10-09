// Run: node src/app/palette/paletteModel.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { arrangeItems, firstRunnableIndex, flattenSections, matchScore, moveActive, normalizeText } from './paletteModel.ts';

const item = (id, title, extra = {}) => ({ id, group: 'actions', title, icon: 'gear', keywords: [], run() {}, ...extra });
const titlesOf = (sections) => flattenSections(sections).map((entry) => entry.title);
const idsOf = (sections) => flattenSections(sections).map((entry) => entry.id);

// Normalisierung: Groß-/Kleinschreibung, Akzente und ß.
assert.equal(normalizeText('Über Café Straße'), 'uber cafe strasse');
assert.notEqual(matchScore('uber', item('a', 'Über den Launcher')), null, 'ohne Umlaut gefunden');
assert.notEqual(matchScore('ÜBER', item('a', 'uber')), null, 'mit Umlaut und Großschreibung gefunden');
assert.notEqual(matchScore('strasse', item('a', 'Straße öffnen')), null, 'ß passt auf ss');

// Stufen: Präfix vor Wortanfang vor Teilfolge.
const prefix = matchScore('fab', item('p', 'Fabric testen'));
const wordPrefix = matchScore('fab', item('w', 'Mein Fabric'));
const subsequence = matchScore('fab', item('s', 'Fun and brave'));
assert.ok(prefix > wordPrefix && wordPrefix > subsequence, 'Präfix > Wortanfang > Teilfolge');
assert.equal(matchScore('fab', item('x', 'Vanilla')), null, 'ohne Treffer kein Wert');
assert.equal(matchScore('fbz', item('x', 'Fabric')), null, 'Reihenfolge der Teilfolge zählt');

// Teilfolge: die engere Spanne gewinnt, unabhängig davon, wo sie steht.
const tight = matchScore('pft', item('t', 'Play Fabric Test'));
const loose = matchScore('pft', item('l', 'Play a long Fabric journey Test'));
assert.ok(tight > loose && loose !== null, 'engere Teilfolge zuerst');
assert.notEqual(matchScore('aab', item('x', 'aaab')), null, 'Wiederholte Buchstaben bleiben auffindbar');

// Mehrere Wörter: jedes muss vorkommen, die Reihenfolge ist egal.
assert.notEqual(matchScore('play fab', item('a', 'Play Fabric')), null);
assert.notEqual(matchScore('fab play', item('a', 'Play Fabric')), null);
assert.equal(matchScore('play forge', item('a', 'Play Fabric')), null, 'ein fehlendes Wort schließt aus');
assert.equal(matchScore('   ', item('a', 'Play Fabric')), 0, 'leere Eingabe passt zu allem');

// Suchbegriffe und Untertitel: gefunden, aber hinter dem Titel.
const byTitle = matchScore('settings', item('t', 'Settings'));
const byKeyword = matchScore('settings', item('k', 'Gear', { keywords: ['settings'] }));
const bySubtitle = matchScore('settings', item('s', 'Gear', { subtitle: 'Settings' }));
assert.ok(byTitle > byKeyword && byKeyword > bySubtitle && bySubtitle !== null, 'Titel > Suchbegriff > Untertitel');

// Kürzerer Titel zuerst bei gleicher Stufe.
const exact = matchScore('play fabric', item('a', 'Play Fabric'));
const longer = matchScore('play fabric', item('b', 'Play Fabric Test'));
assert.ok(exact > longer, 'genauer vor länger');

// Anordnung: Gruppen bleiben in fester Reihenfolge, auch wenn ein späterer Treffer besser ist.
const mixed = [
  item('a1', 'Zeig Fabric', { group: 'actions' }),
  item('n1', 'Fabric Navigation', { group: 'navigation' }),
  item('i1', 'Play Fabric', { group: 'instances' }),
  item('i2', 'Fabric Prefix', { group: 'instances' }),
];
const found = arrangeItems(mixed, 'fabric', []);
assert.deepEqual(found.map((section) => section.id), ['instances', 'navigation', 'actions'], 'stabile Gruppenfolge');
assert.deepEqual(idsOf(found), ['i2', 'i1', 'n1', 'a1'], 'je Gruppe nach Güte');
assert.deepEqual(arrangeItems(mixed, 'nope', []), [], 'ohne Treffer keine Abschnitte');

// Gleiche Güte: der zuletzt benutzte zuerst, sonst die Reihenfolge der Quelle.
const twins = [item('a', 'Alpha'), item('b', 'Alpha'), item('c', 'Alpha')];
assert.deepEqual(idsOf(arrangeItems(twins, 'alpha', [])), ['a', 'b', 'c'], 'stabile Quellfolge');
assert.deepEqual(idsOf(arrangeItems(twins, 'alpha', ['c', 'b'])), ['c', 'b', 'a'], 'zuletzt benutzte zuerst');

// Leeres Suchfeld: zuletzt Ausgeführtes zuerst (neueste oben), ohne Doppelung, Unbekanntes fällt weg.
const idle = [item('a', 'A', { group: 'navigation' }), item('b', 'B', { group: 'instances' }), item('c', 'C', { group: 'actions' })];
const idleSections = arrangeItems(idle, '', ['c', 'gone', 'a']);
assert.deepEqual(idleSections.map((section) => section.id), ['recent', 'instances'], 'zuletzt benutzt, dann Gruppen');
assert.deepEqual(idsOf(idleSections), ['c', 'a', 'b'], 'neueste zuerst, nicht doppelt');
assert.deepEqual(arrangeItems(idle, '  ', []).map((section) => section.id), ['instances', 'navigation', 'actions'], 'nur Leerzeichen zählen als leer');

// Tastatur: Auf/Ab im Kreis, Pos1/Ende an den Enden, leere Liste bleibt bei 0.
assert.equal(moveActive(0, 3, 'down'), 1);
assert.equal(moveActive(2, 3, 'down'), 0);
assert.equal(moveActive(0, 3, 'up'), 2);
assert.equal(moveActive(1, 3, 'home'), 0);
assert.equal(moveActive(1, 3, 'end'), 2);
assert.equal(moveActive(0, 0, 'down'), 0);
assert.equal(moveActive(0, 0, 'up'), 0);

// Startauswahl: der erste ausführbare Eintrag, sonst der erste.
const blocked = item('p', 'Play', { disabledReason: 'Startet' });
assert.equal(firstRunnableIndex([blocked, item('o', 'Open')]), 1);
assert.equal(firstRunnableIndex([blocked]), 0);
assert.equal(firstRunnableIndex([]), 0);
assert.deepEqual(titlesOf([{ id: 'actions', items: [blocked] }]), ['Play']);

console.log('paletteModel.check: ok');
