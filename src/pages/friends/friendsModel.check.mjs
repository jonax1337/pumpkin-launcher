// Run: node src/pages/friends/friendsModel.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { FRIENDS_FIXTURES as fixtures } from '../../lib/friends-fixtures.ts';
import {
  activeCodeCount, canInvite, codeMayBeExpired, friendLabels, friendsBadgeCount, friendsGate, inviteFrom, onlineCount, visibleFriends,
} from './friendsModel.ts';

const friend = (over) => ({ ...fixtures['friend.online'], ...over });
const names = (list) => list.map((f) => f.displayName);

// Tore: Schlüsselbund vor verlorener Identität vor „aus“ vor Konto; sonst keines.
const state = (over) => ({ ...fixtures['friendsState.available'], ...over });
assert.equal(friendsGate(state({ availability: 'noSecretStore', enabled: false }), true), 'noSecretStore');
assert.equal(friendsGate(state({ availability: 'identityLost' }), true), 'identityLost');
assert.equal(friendsGate(state({ enabled: false }), true), 'disabled');
assert.equal(friendsGate(state({}), false), 'noMicrosoftAccount');
assert.equal(friendsGate(state({}), true), null);

// Zahl an der Seitenleiste: eingehende Anfragen + Einladungen + Hinweise; eigene Anfragen zählen nicht.
const incoming = fixtures['request.incoming'];
const outgoing = [fixtures['request.delivering'], fixtures['request.awaitingAnswer']];
const withNotice = [fixtures['friend.relayRenamed'], fixtures['friend.identityChanged']];
assert.equal(friendsBadgeCount([], [], []), 0);
assert.equal(friendsBadgeCount([incoming, ...outgoing], [], [fixtures['friend.online']]), 1);
assert.equal(friendsBadgeCount([incoming, ...outgoing], [fixtures.invite], withNotice), 4);

// Namen: Alias schlägt Anzeigename; gleiche Namen bekommen die erste Gruppe des Fingerabdrucks.
const alex = friend({ id: 'a', displayName: 'Alex', fingerprint: '1111 2222 3333 4444' });
const alexTwin = friend({ id: 'b', displayName: 'Alex', fingerprint: '9999 2222 3333 4444' });
const bea = friend({ id: 'c', displayName: 'Bea', alias: 'Bienchen', presence: 'offline', mcName: 'BeaMC' });
const labels = friendLabels([alex, alexTwin, bea]);
assert.equal(labels.get('a'), 'Alex · 1111');
assert.equal(labels.get('b'), 'Alex · 9999');
assert.equal(labels.get('c'), 'Bienchen');
assert.equal(friendLabels([alex, bea]).get('a'), 'Alex');
assert.equal(friendLabels([alex, friend({ id: 'd', displayName: 'Alex', alias: 'Lex' })]).get('a'), 'Alex', 'ein Alias macht den Namen eindeutig');

// Liste: alphabetisch, nach Anwesenheit nur gefiltert, nie sortiert; Suche in Namen, Alias und Minecraft-Namen.
const all = [bea, alexTwin, alex];
const plain = friendLabels(all);
assert.deepEqual(visibleFriends(all, plain, { query: '', onlineOnly: false }).map((f) => f.id), ['a', 'b', 'c']);
assert.deepEqual(visibleFriends(all, plain, { query: '', onlineOnly: true }).map((f) => f.id), ['a', 'b']);
assert.deepEqual(names(visibleFriends(all, plain, { query: 'bien', onlineOnly: false })), ['Bea'], 'Alias');
assert.deepEqual(names(visibleFriends(all, plain, { query: ' BEAmc ', onlineOnly: false })), ['Bea'], 'Minecraft-Name, Groß- und Kleinschreibung');
assert.deepEqual(visibleFriends(all, plain, { query: 'zzz', onlineOnly: false }), []);
assert.equal(onlineCount(all), 2);
assert.equal(onlineCount([friend({ presence: 'playing' }), bea]), 1);

// Einladen: nur mit eigener Sitzung, bei bestätigtem Online-Freund ohne Platz; Abgelehnte und Entfernte dürfen wieder.
const guests = fixtures.hostSession.guests;
const seat = (state, kicked = false) => ({ ...fixtures.hostSession, guests: [{ ...guests[0], friendId: alex.id, state, kicked }] });
assert.ok(!canInvite(alex, undefined));
assert.ok(canInvite(alex, { ...fixtures.hostSession, guests: [] }));
assert.ok(!canInvite(alex, seat('invited')));
assert.ok(!canInvite(alex, seat('connected')));
assert.ok(canInvite(alex, seat('declined')));
assert.ok(canInvite(alex, seat('left', true)));
assert.ok(canInvite(alex, seat('left')) === false, 'wer von selbst ging, behält die Einladung');
assert.ok(!canInvite(bea, { ...fixtures.hostSession, guests: [] }), 'offline');
assert.ok(!canInvite(friend({ confirmed: false }), seat('declined')), 'unbestätigt');
assert.ok(!canInvite(friend({ removedByPeer: true }), seat('declined')), 'hat die Freundschaft beendet');

// Einladung eines Freundes.
assert.equal(inviteFrom([fixtures.invite], friend({ id: fixtures.invite.from })), fixtures.invite);
assert.equal(inviteFrom([fixtures.invite], alex), undefined);

// Code vielleicht abgelaufen: erst über der Gültigkeit von 7 Tagen.
const ttl = fixtures.constants.codeTtlSecs;
const request = { ...fixtures['request.delivering'], createdAt: 1_000_000 };
assert.ok(!codeMayBeExpired(request, ttl, 1_000_000 + ttl));
assert.ok(codeMayBeExpired(request, ttl, 1_000_000 + ttl + 1));

// Aktive Codes: benutzte zählen nicht zum Limit.
assert.equal(activeCodeCount([{ used: false }, { used: true }, { used: false }]), 2);

console.log('friendsModel.check: ok');
