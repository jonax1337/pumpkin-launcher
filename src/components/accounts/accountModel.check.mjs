// Run: node src/components/accounts/accountModel.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { keyOf, pickLaunchAccount } from './accountModel.ts';

const ms = { kind: 'microsoft', id: 'm1', username: 'Alex' };
const offline = { kind: 'offline', name: 'Steve' };
const known = [ms, offline];

assert.equal(keyOf(ms), 'ms:m1');
assert.equal(keyOf(offline), 'off:Steve');

// Das eigene Konto der Instanz gewinnt gegen das aktive: Der Beitritt prüft dieses, nicht das aktive Konto.
assert.equal(pickLaunchAccount(known, 'off:Steve', ms), offline);
assert.equal(pickLaunchAccount(known, 'ms:m1', offline), ms);

// Ohne eigenes Konto, oder wenn es nicht mehr existiert, startet das aktive.
assert.equal(pickLaunchAccount(known, null, ms), ms);
assert.equal(pickLaunchAccount(known, 'ms:gone', offline), offline);
assert.equal(pickLaunchAccount([ms], 'off:Steve', ms), ms, 'ein Offline-Konto, das nicht mehr starten darf, zählt nicht');

// Gibt es kein nutzbares Konto, startet nichts.
assert.equal(pickLaunchAccount([], null, null), null);

console.log('accountModel.check: ok');
