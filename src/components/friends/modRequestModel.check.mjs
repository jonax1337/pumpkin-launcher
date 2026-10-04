// Run: node src/components/friends/modRequestModel.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { friends as deFriends } from '../../i18n/de/friends.ts';
import { friendsInvite as deInvite } from '../../i18n/de/friendsInvite.ts';
import { friends as enFriends } from '../../i18n/en/friends.ts';
import { friendsInvite as enInvite } from '../../i18n/en/friendsInvite.ts';
import { FRIENDS_FIXTURES as fixtures } from '../../lib/friends-fixtures.ts';
import {
  ACTIVITY_LIMIT, activityLine, activityText, confirmOperationLine, operationLine, SCOPED_OPS, scopeSentenceKey, withActivity,
} from './modRequestModel.ts';

const DICTS = [['de', { ...deFriends, ...deInvite }], ['en', { ...enFriends, ...enInvite }]];
// Die Vorgänge mit Bereich share oder social aus INGAME 5.4 (Spalte „Scope“ S und C).
const SCOPED_OP_NAMES = [
  'host.invite', 'request.answer', 'friend.addByName', 'invite.joinHere', 'friend.addByCode', 'code.create', 'code.revoke',
  'friend.rename', 'friend.remove', 'friend.block', 'blocked.unblock', 'friend.acknowledge',
];
const entry = (over) => ({ ...fixtures.modActivityEntry, ...over });

// Jeder Vorgang mit Bereich hat Satz und Benennung in beiden Sprachen; die Platzhalter sind nur {name}.
assert.deepEqual(Object.keys(SCOPED_OPS).sort(), [...SCOPED_OP_NAMES].sort());
for (const op of SCOPED_OP_NAMES) {
  for (const [language, words] of DICTS) {
    for (const key of [SCOPED_OPS[op].activity, SCOPED_OPS[op].operation]) {
      assert.ok(words[key], `${language}: ${key} fehlt`);
      for (const [, name] of words[key].matchAll(/\{(\w+)\}/g)) assert.equal(name, 'name', `${language}: ${key} kennt {${name}} nicht`);
    }
  }
}
for (const [language, words] of DICTS) {
  for (const key of ['friends.activity.unknown', 'friends.op.unknown', 'friends.activity.someone', 'friends.activity.toast', 'friends.activity.toastFailed']) {
    assert.ok(words[key], `${language}: ${key}`);
  }
  assert.ok(words[scopeSentenceKey('share')] && words[scopeSentenceKey('social')], language);
}

// Der Satz zu einem Vorgang trägt die Person, die die Mod nannte; ohne Person bleibt das Feld leer.
assert.deepEqual(activityLine(entry({})), { key: 'friends.activity.friendAddByName', name: 'Alex', op: 'friend.addByName' });
assert.deepEqual(activityLine(entry({ op: 'code.create', targetName: null })), { key: 'friends.activity.codeCreate', name: null, op: 'code.create' });
assert.deepEqual(operationLine({ op: 'host.invite', targetName: 'Alex, Bea' }), { key: 'friends.op.hostInvite', name: 'Alex, Bea', op: 'host.invite' });

// Die Rückfrage zum Teilen nennt jeden Freund, den die Mod einlädt, auch wenn der Launcher `targetName` auf 64 Zeichen kürzt.
const SUMMARY_NAME_CAP = 64;
const guests = Array.from({ length: fixtures.constants.maxGuests }, (_, n) => ({ friendId: `f${n}`, displayName: `Gast${n}_`.padEnd(32, 'x') }));
const cappedTarget = guests.map((g) => g.displayName).join(', ').slice(0, SUMMARY_NAME_CAP);
const shareLine = confirmOperationLine({ scope: 'share', friends: guests, summary: { op: 'host.invite', targetName: cappedTarget } });
assert.equal(shareLine.key, 'friends.op.hostInvite');
for (const guest of guests) assert.ok(shareLine.name.includes(guest.displayName), `${guest.displayName} fehlt in der Rückfrage`);
assert.ok(shareLine.name.length > SUMMARY_NAME_CAP, 'der Text ist nicht auf die Kürzung des Launchers beschränkt');
assert.equal(confirmOperationLine({ scope: 'share', friends: [], summary: { op: 'host.invite', targetName: null } }).name, null);
assert.deepEqual(
  confirmOperationLine({ scope: 'social', friends: [], summary: { op: 'friend.addByName', targetName: 'Alex' } }),
  { key: 'friends.op.friendAddByName', name: 'Alex', op: 'friend.addByName' },
  'im Bereich social nennt allein summary die Person',
);

// Ein unbekannter Vorgang (neuere Mod, ältere Oberfläche) erscheint unter seinem Namen und wirft nichts.
assert.equal(activityLine(entry({ op: 'friend.teleport' })).key, 'friends.activity.unknown');
assert.equal(operationLine({ op: 'toString', targetName: null }).key, 'friends.op.unknown', 'Namen von Object.prototype sind keine Vorgänge');

// Lief der Vorgang, nennt die Liste die Tat; lief er nicht (abgelehnt, gescheitert), den Versuch.
assert.equal(activityText(entry({ ok: true })).key, 'friends.activity.friendAddByName');
assert.equal(activityText(entry({ ok: false })).key, 'friends.op.friendAddByName');

// Die Liste: neueste zuerst, genau einmal je Vorgang, höchstens 100.
const at = (n) => `2026-10-04T12:${String(n % 60).padStart(2, '0')}:00Z`;
const first = entry({ at: at(1) });
const second = entry({ at: at(2), op: 'friend.block' });
let list = withActivity(withActivity([], first), second);
assert.deepEqual(list.map((e) => e.op), ['friend.block', 'friend.addByName']);
assert.deepEqual(withActivity(list, first).map((e) => e.at), [first.at, second.at], 'derselbe Vorgang rückt nach vorn, statt doppelt zu stehen');
assert.equal(withActivity(list, { ...first }).length, 2);
assert.equal(withActivity(list, entry({ at: at(1), ok: false })).length, 3, 'ein anderes Ergebnis ist ein anderer Vorgang');
list = [];
for (let n = 0; n < ACTIVITY_LIMIT + 20; n++) list = withActivity(list, entry({ at: `2026-10-04T13:00:00Z`, targetName: `Person${n}` }));
assert.equal(list.length, ACTIVITY_LIMIT);
assert.equal(list[0].targetName, `Person${ACTIVITY_LIMIT + 19}`, 'der neueste steht vorn');
assert.equal(list.at(-1).targetName, 'Person20', 'die ältesten fielen heraus');

console.log('modRequestModel.check: ok');
