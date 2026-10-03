// Run: node src/store/friendDialogQueue.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { FRIENDS_FIXTURES as fixtures } from '../lib/friends-fixtures.ts';
import { closeActive, dropInvite, dropModConfirm, emptyDialogQueue, enqueue, MOD_CONFIRM_TTL_MS, promote } from './friendDialogQueue.ts';

const invite = (inviteId) => ({ kind: 'invite', inviteId });
const modConfirm = (requestId) => ({ kind: 'modConfirm', confirm: { ...fixtures['event.modConfirm'], requestId } });
const ids = (dialogs) => dialogs.map((d) => (d.kind === 'invite' ? d.inviteId : d.confirm.requestId));

// Nie zwei Dialoge zugleich: ein zweiter wartet, bis der erste geschlossen ist.
let queue = promote(enqueue(enqueue(emptyDialogQueue, invite('a')), invite('b')));
assert.equal(queue.active.inviteId, 'a');
assert.deepEqual(ids(queue.waiting), ['b']);
assert.equal(promote(queue), queue, 'bei offenem Dialog bleibt alles, wie es ist');
queue = promote(closeActive(queue));
assert.equal(queue.active.inviteId, 'b');
assert.deepEqual(queue.waiting, []);
assert.equal(promote(closeActive(queue)).active, null, 'nichts wartet: nichts öffnet sich');

// Dieselbe Einladung kommt nicht doppelt, ob sie offen ist oder wartet (Toast „Ansehen“ nach dem Auto-Öffnen).
queue = promote(enqueue(emptyDialogQueue, invite('a')));
assert.equal(enqueue(queue, invite('a')), queue);
queue = enqueue(queue, invite('b'));
assert.equal(enqueue(queue, invite('b')), queue);
assert.equal(enqueue(enqueue(emptyDialogQueue, modConfirm('r1')), modConfirm('r1')).waiting.length, 1);
assert.equal(enqueue(enqueue(emptyDialogQueue, modConfirm('r1')), modConfirm('r2')).waiting.length, 2);

// Die Bitte der Mod verfällt nach zwei Minuten und geht vor einer wartenden Einladung.
queue = enqueue(enqueue(enqueue(emptyDialogQueue, invite('a')), invite('b')), modConfirm('r1'));
queue = promote(queue);
assert.equal(queue.active.kind, 'modConfirm');
assert.deepEqual(ids(queue.waiting), ['a', 'b']);

// Widerruf: aus der Warteschlange und aus dem offenen Dialog; fremde Einladungen bleiben.
queue = promote(enqueue(enqueue(emptyDialogQueue, invite('a')), invite('b')));
assert.deepEqual(dropInvite(queue, 'b'), { active: queue.active, waiting: [] });
assert.equal(dropInvite(queue, 'a').active, null);
assert.deepEqual(ids(dropInvite(queue, 'a').waiting), ['b']);
assert.equal(dropInvite(queue, 'zzz').active.inviteId, 'a');
const withMod = promote(enqueue(emptyDialogQueue, modConfirm('r1')));
assert.equal(dropInvite(withMod, 'r1').active.kind, 'modConfirm', 'eine Einladung zu widerrufen schließt keine Mod-Bitte');

// Verfall: die abgelaufene Bitte der Mod verschwindet aus dem offenen Dialog und aus der Warteschlange und gibt die nächsten frei.
assert.equal(MOD_CONFIRM_TTL_MS, 120_000, 'so lange wartet das Backend (CONFIRM_WAIT)');
queue = promote(enqueue(enqueue(enqueue(emptyDialogQueue, modConfirm('r1')), modConfirm('r2')), invite('a')));
assert.equal(dropModConfirm(queue, 'r1').active, null, 'die offene, verfallene Bitte schließt');
assert.equal(promote(dropModConfirm(queue, 'r1')).active.confirm.requestId, 'r2', 'danach öffnet sich der nächste Dialog');
assert.deepEqual(ids(dropModConfirm(queue, 'r2').waiting), ['a'], 'eine wartende, verfallene Bitte fällt heraus');
assert.equal(dropModConfirm(queue, 'r2').active.confirm.requestId, 'r1', 'die offene Bitte bleibt, wenn eine andere verfällt');
assert.equal(dropModConfirm(queue, 'zzz').waiting.length, 2);
assert.equal(dropModConfirm(promote(enqueue(emptyDialogQueue, invite('r1'))), 'r1').active.inviteId, 'r1', 'eine Einladung verfällt nicht mit der Bitte');

console.log('friendDialogQueue.check: ok');
