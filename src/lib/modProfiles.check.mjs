// Run: node src/lib/modProfiles.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { activeProfileOf, applyProfile, captureProfile, changeCount, cleanProfileName, isModified, profileNamed } from './modProfiles.ts';

const mod = (id, extra = {}) => ({
  id, name: id, version: '1', source: { type: 'local' }, fileName: `${id}.jar`, sha1: null, enabled: true, kind: 'mod',
  requiredBy: [], pinned: false, packManaged: false, ...extra,
});
const states = (mods) => mods.map((m) => [m.id, m.enabled]);

// --- Schnappschuss: nur schaltbare Inhalte, Ressourcenpakete gehören in kein Profil
const saved = [mod('a'), mod('b', { enabled: false }), mod('s', { kind: 'shader' }), mod('r', { kind: 'resourcepack' })];
const profile = captureProfile('p1', 'Performance', saved);
assert.deepEqual(profile, { id: 'p1', name: 'Performance', enabledIds: ['a', 's'], knownIds: ['a', 'b', 's'] });

// --- Anwenden: Bekanntes folgt dem Profil, Späteres bleibt, Festhalten und Ressourcenpakete bleiben
const now = [
  mod('a', { enabled: false, pinned: true }), mod('b', { enabled: true }), mod('s'), mod('r', { kind: 'resourcepack', enabled: false }),
  mod('later-on'), mod('later-off', { enabled: false }),
];
const applied = applyProfile(now, profile);
assert.deepEqual(states(applied), [['a', true], ['b', false], ['s', true], ['r', false], ['later-on', true], ['later-off', false]]);
assert.ok(applied[0].pinned, 'Festhalten bleibt');
assert.equal(applied[2], now[2], 'unveränderte Einträge bleiben dieselben Objekte');
assert.equal(changeCount(now, profile), 2, 'a geht an, b geht aus');
assert.equal(changeCount(applied, profile), 0);

// --- Entfernte Inhalte werden übergangen
assert.deepEqual(states(applyProfile([mod('b')], profile)), [['b', false]]);
assert.equal(changeCount([], profile), 0);

// --- „Geändert“: nur beim aktiven Profil, sobald Anwenden etwas umschalten würde
const instance = (mods, activeModProfile) => ({ mods, modProfiles: [profile], activeModProfile });
assert.equal(activeProfileOf(instance(saved, 'p1')), profile);
assert.equal(activeProfileOf(instance(saved, null)), undefined);
assert.equal(activeProfileOf(instance(saved, 'gone')), undefined, 'ein Profil, das es nicht mehr gibt, ist nicht aktiv');
assert.ok(!isModified(instance(saved, 'p1')));
assert.ok(isModified(instance(now, 'p1')));
assert.ok(!isModified(instance(now, null)), 'ohne aktives Profil gibt es nichts zu ändern');
assert.ok(!isModified(instance([...saved, mod('later')], 'p1')), 'Späteres ändert das Profil nicht');

// --- Namen: getrimmt, 1 bis 40 Zeichen, gleichnamige ohne Rücksicht auf Groß- und Kleinschreibung
assert.equal(cleanProfileName('  Performance '), 'Performance');
assert.equal(cleanProfileName('   '), null);
assert.equal(cleanProfileName('x'.repeat(40)), 'x'.repeat(40));
assert.equal(cleanProfileName('x'.repeat(41)), null);
assert.equal(profileNamed([profile], ' PERFORMANCE '), profile);
assert.equal(profileNamed([profile], 'Other'), undefined);

console.log('modProfiles.check: ok');
