// Run: node src/lib/onPlay.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { effectiveOnPlay, resolveFriendsEnabled } from './onPlay.ts';

// Nur „Schließen“ ändert sich, und nur, wenn das Backend nicht ausdrücklich „aus“ gemeldet hat.
for (const friendsEnabled of [null, true]) {
  assert.equal(effectiveOnPlay('close', friendsEnabled), 'minimize', `close, ${friendsEnabled}`);
}
assert.equal(effectiveOnPlay('close', false), 'close');
for (const mode of ['keep', 'minimize']) {
  for (const friendsEnabled of [null, true, false]) {
    assert.equal(effectiveOnPlay(mode, friendsEnabled), mode, `${mode}, ${friendsEnabled}`);
  }
}

const TIMEOUT_MS = 50;
const neverCalled = () => assert.fail('fetchEnabled darf mit gespiegeltem Wert nicht laufen');

// Gespiegelter Wert: ohne Abfrage.
assert.equal(await resolveFriendsEnabled(true, neverCalled, TIMEOUT_MS), true);
assert.equal(await resolveFriendsEnabled(false, neverCalled, TIMEOUT_MS), false);

// Ohne gespiegelten Wert zählt die Antwort, auch ein „aus“ (dann bleibt „Schließen“ bei „Schließen“).
assert.equal(await resolveFriendsEnabled(null, async () => false, TIMEOUT_MS), false);
assert.equal(await resolveFriendsEnabled(null, async () => true, TIMEOUT_MS), true);

// Abfrage scheitert oder kommt nicht rechtzeitig: unbekannt (null), also Minimieren.
assert.equal(await resolveFriendsEnabled(null, () => Promise.reject(new Error('Backend')), TIMEOUT_MS), null);
assert.equal(await resolveFriendsEnabled(null, () => { throw new Error('sofort'); }, TIMEOUT_MS), null);
const startedAt = Date.now();
assert.equal(await resolveFriendsEnabled(null, () => new Promise(() => {}), TIMEOUT_MS), null);
assert.ok(Date.now() - startedAt >= TIMEOUT_MS - 5, 'wartet die Frist ab');

// Eine späte Antwort nach der Frist ändert nichts mehr.
assert.equal(await resolveFriendsEnabled(null, () => new Promise((resolve) => setTimeout(() => resolve(false), TIMEOUT_MS * 3)), TIMEOUT_MS), null);

console.log('onPlay checks passed');
