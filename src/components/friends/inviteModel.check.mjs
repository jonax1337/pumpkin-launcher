// Run: node src/components/friends/inviteModel.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { FRIENDS_FIXTURES as fixtures } from '../../lib/friends-fixtures.ts';
import { actionAllowed, canJoinWith, chosenCandidate, inviteAction, needsMicrosoftAccount } from './inviteModel.ts';

const ready = fixtures['joinPlan.ready'];
const missing = fixtures['joinPlan.missing'];
const vanilla = fixtures['joinPlan.vanilla'];
const candidate = (instanceId, over = {}) => ({ instanceId, name: instanceId, matches: true, missing: [], extra: [], ...over });

// Der Dialog zeigt die gewählte Instanz, sonst die beste (die erste); eine unbekannte Wahl fällt auf die beste zurück.
const two = { ...ready, candidates: [candidate('a'), candidate('b')] };
assert.equal(chosenCandidate(two, null).instanceId, 'a');
assert.equal(chosenCandidate(two, 'b').instanceId, 'b');
assert.equal(chosenCandidate(two, 'gone').instanceId, 'a');
assert.equal(chosenCandidate({ ...ready, candidates: [] }, 'a'), undefined);

// Urteile: ready → Beitreten; noInstance → Vanilla anlegen, nur wenn das Backend es anbietet; sonst keine Hauptaktion.
assert.equal(inviteAction(ready, chosenCandidate(ready, null)), 'join');
assert.equal(inviteAction(ready, undefined), 'none', 'ready ohne Instanz kann nicht beitreten');
assert.equal(inviteAction(ready, candidate('x', { matches: false })), 'none', 'eine Instanz, die nicht passt, tritt nicht bei');
assert.equal(inviteAction(missing, chosenCandidate(missing, null)), 'none');
assert.equal(inviteAction(vanilla, undefined), 'createVanilla');
assert.equal(inviteAction({ ...vanilla, createVanilla: false }, undefined), 'none');
assert.equal(inviteAction({ ...ready, verdict: 'versionUnsupported' }, candidate('a')), 'none');

// Offline-Konto: Beitreten ist gesperrt und bekommt den Hinweis; Vanilla anlegen und alles ohne Aktion bleiben davon unberührt.
assert.equal(actionAllowed('join', true), true);
assert.equal(actionAllowed('join', false), false);
assert.equal(actionAllowed('createVanilla', false), true);
assert.equal(actionAllowed('none', true), false);
assert.equal(needsMicrosoftAccount('join', false), true);
assert.equal(needsMicrosoftAccount('join', true), false);
assert.equal(needsMicrosoftAccount('none', false), false);
assert.equal(needsMicrosoftAccount('createVanilla', false), false);

// Beitreten hängt am Konto, mit dem die Instanz wirklich startet (nicht am aktiven): nur ein Microsoft-Konto reicht, kein Konto auch nicht.
assert.equal(canJoinWith({ kind: 'microsoft', id: 'm1', username: 'Alex' }), true);
assert.equal(canJoinWith({ kind: 'offline', name: 'Steve' }), false);
assert.equal(canJoinWith(null), false);

console.log('inviteModel.check: ok');
