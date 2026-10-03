// Run: node src/components/friends/sharingModel.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { FRIENDS_FIXTURES as fixtures } from '../../lib/friends-fixtures.ts';
import { friendLabels } from '../../pages/friends/friendsModel.ts';
import {
  canKick, canReinvite, closeWarning, connectedGuestCount, guestStatus, hostNameOf, invitableFriends, nextJoin, parseManualPort, seatsLeft,
  shareState,
} from './sharingModel.ts';

const { hostSession, lanStatus } = fixtures;
const friend = (over) => ({ ...fixtures['friend.online'], ...over });
const guest = (state, kicked = false) => ({ ...hostSession.guests[0], state, kicked });
const sessionWith = (...guests) => ({ ...hostSession, guests });
const ids = (list) => list.map((f) => f.id);

// Zustand des Abschnitts: die eigene Sitzung vor allem, dann Version, Spiel, Port.
const base = { instanceId: hostSession.instanceId, versionSupported: true, running: true, lan: lanStatus, session: undefined };
assert.equal(shareState({ ...base, versionSupported: false }).kind, 'versionUnsupported');
assert.equal(shareState({ ...base, versionSupported: false, running: false }).kind, 'versionUnsupported', 'die Version geht vor „nicht gestartet“');
assert.equal(shareState({ ...base, versionSupported: undefined }).kind, 'ready', 'unbekannte Version zählt als unterstützt');
assert.equal(shareState({ ...base, running: false }).kind, 'notRunning');
assert.equal(shareState({ ...base, lan: null }).kind, 'waitingForLan');
assert.deepEqual(shareState(base), { kind: 'ready', lan: lanStatus });
assert.equal(shareState({ ...base, session: hostSession }).kind, 'sharing');
assert.equal(shareState({ ...base, session: hostSession, running: false, versionSupported: false }).kind, 'sharing', 'eine laufende Sitzung bleibt sichtbar');
assert.equal(shareState({ ...base, session: { ...hostSession, instanceId: 'other' } }).kind, 'ready', 'die Sitzung einer anderen Instanz ändert diese nicht');

// Port von Hand: nur ganze Zahlen von 1024 bis 65535.
assert.equal(parseManualPort('25565'), 25565);
assert.equal(parseManualPort(' 1024 '), 1024);
assert.equal(parseManualPort('65535'), 65535);
for (const bad of ['', '1023', '65536', '0', '-1', '12.5', '12a', '1e4', '099999', '123456']) assert.equal(parseManualPort(bad), null, bad);

// Plätze: abgelehnte und entfernte Gäste geben ihren Platz frei, wer von selbst ging, behält ihn.
assert.equal(seatsLeft(undefined), fixtures.constants.maxGuests);
assert.equal(seatsLeft(hostSession), fixtures.constants.maxGuests - 2, 'verbunden und eingeladen belegen einen Platz');
assert.equal(seatsLeft(sessionWith(guest('left'), guest('declined'), guest('left', true))), fixtures.constants.maxGuests - 1);

// Wen man einladen kann: online, bestätigt, ohne Platz; alphabetisch, auch bei gleichen Namen mit Fingerabdruck.
const alex = friend({ id: 'a', displayName: 'Alex' });
const bea = friend({ id: 'b', displayName: 'Bea', presence: 'playing' });
const cleo = friend({ id: 'c', displayName: 'Cleo', presence: 'offline' });
const dino = friend({ id: 'd', displayName: 'Dino', confirmed: false });
const eli = friend({ id: 'e', displayName: 'Eli', removedByPeer: true });
const everyone = [bea, eli, dino, cleo, alex];
const labels = friendLabels(everyone);
assert.deepEqual(ids(invitableFriends(everyone, labels, undefined)), ['a', 'b']);
const seated = (friendId, state, kicked = false) => sessionWith({ ...guest(state, kicked), friendId });
assert.deepEqual(ids(invitableFriends(everyone, labels, seated('a', 'invited'))), ['b'], 'wer eingeladen ist, erscheint nicht');
assert.deepEqual(ids(invitableFriends(everyone, labels, seated('a', 'declined'))), ['a', 'b'], 'Abgelehnte dürfen wieder');
assert.deepEqual(ids(invitableFriends(everyone, labels, seated('a', 'left', true))), ['a', 'b'], 'Entfernte dürfen wieder');
assert.deepEqual(ids(invitableFriends(everyone, labels, seated('a', 'left'))), ['b'], 'wer von selbst ging, behält die Einladung');

// Gäste in der Liste.
assert.deepEqual(hostSession.guests.map(guestStatus), ['connected', 'invited', 'declined', 'kicked']);
assert.equal(guestStatus(guest('left')), 'left');
assert.deepEqual(hostSession.guests.map(canReinvite), [false, false, true, true]);
assert.deepEqual(hostSession.guests.map(canKick), [true, true, false, false]);
assert.equal(connectedGuestCount(hostSession), 1);

// Beitritt: ein neuer ersetzt den alten, dessen spätes „ended“ trifft den neuen nicht; der Gastgeber bleibt bekannt.
const joinEvent = (joinId, state) => ({ ...fixtures['event.joinSession.connected'], joinId, state });
const waiting = { type: 'waitingForGame' };
const ended = { type: 'ended', reason: 'left' };
const first = nextJoin(null, joinEvent('j1', waiting), 'Alex');
assert.equal(first.hostName, 'Alex');
const connected = nextJoin(first, joinEvent('j1', { type: 'connected', path: 'direct', rttMs: 38 }), null);
assert.equal(connected.hostName, 'Alex', 'der Name bleibt, auch wenn die Einladung inzwischen fehlt');
assert.equal(connected.event.state.type, 'connected');
assert.equal(nextJoin(connected, joinEvent('j1', ended), null), null);
const second = nextJoin(connected, joinEvent('j2', waiting), 'Bea');
assert.equal(second.hostName, 'Bea');
assert.equal(nextJoin(second, joinEvent('j1', ended), null), second, 'das Ende des alten Beitritts lässt den neuen stehen');
assert.equal(nextJoin(null, joinEvent('j1', ended), null), null);
assert.equal(hostNameOf([fixtures.invite], fixtures.invite.id), fixtures.invite.fromName);
assert.equal(hostNameOf([fixtures.invite], 'unbekannt'), null);
assert.equal(hostNameOf(undefined, fixtures.invite.id), null);

// Fenster schließen: nur fragen, wenn etwas läuft.
assert.equal(closeWarning(false, false), null);
assert.equal(closeWarning(true, false), 'hosting');
assert.equal(closeWarning(false, true), 'joining');
assert.equal(closeWarning(true, true), 'both');

console.log('sharingModel.check: ok');
