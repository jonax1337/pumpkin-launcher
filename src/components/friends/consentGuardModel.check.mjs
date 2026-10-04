// Run: node src/components/friends/consentGuardModel.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { acceptsActivation, changeAttention, CONSENT_GUARD_MS, isArmed, lockedForMs, openGuard } from './consentGuardModel.ts';

const KEYBOARD = { by: 'keyboard' };
const pointer = (downAt) => ({ by: 'pointer', downAt });

assert.equal(CONSENT_GUARD_MS, 1000, 'mindestens eine Sekunde (INGAME 5.5)');

// Sichtbar und fokussiert: genau 1000 ms gesperrt, nicht einer weniger.
let guard = openGuard(5000, true);
assert.equal(lockedForMs(guard, 5000), 1000);
assert.equal(lockedForMs(guard, 5400), 600);
assert.equal(isArmed(guard, 5999), false, 'eine Millisekunde zu früh');
assert.equal(isArmed(guard, 6000), true, 'nach 1000 ms frei');
assert.equal(lockedForMs(guard, 9000), 0, 'bleibt frei, solange sich nichts ändert');

// Ohne Fokus (oder bei verdecktem Fenster) läuft die Zeit nicht: auch nach Minuten bleibt alles gesperrt.
guard = openGuard(5000, false);
assert.equal(lockedForMs(guard, 5000), null);
assert.equal(isArmed(guard, 600_000), false);

// Die Zeit beginnt, sobald das Fenster den Fokus bekommt, und nicht schon beim Öffnen.
guard = changeAttention(guard, 8000, true);
assert.equal(isArmed(guard, 8999), false);
assert.equal(isArmed(guard, 9000), true);

// Jeder Wechsel von Fokus oder Sichtbarkeit beginnt neu, auch ein „Fokus“, der schon galt.
guard = openGuard(0, true);
guard = changeAttention(guard, 900, true);
assert.equal(isArmed(guard, 1000), false, 'der Wechsel bei 900 ms setzt die Zeit zurück');
assert.equal(isArmed(guard, 1899), false);
assert.equal(isArmed(guard, 1900), true);

// Fokus verloren: sofort wieder gesperrt, auch wenn die Sekunde schon um war.
guard = openGuard(0, true);
assert.equal(isArmed(guard, 2000), true);
guard = changeAttention(guard, 2000, false);
assert.equal(isArmed(guard, 2000), false);
assert.equal(isArmed(guard, 10_000), false);
guard = changeAttention(guard, 10_000, true);
assert.equal(isArmed(guard, 10_999), false, 'nach der Rückkehr beginnt die Sekunde neu');
assert.equal(isArmed(guard, 11_000), true);

// Das Erscheinen des Dialogs bleibt beim Fokuswechsel erhalten: ein früherer Druck zählt weiter nicht.
assert.equal(guard.shownAt, 0);

// Auslösen per Tastatur zählt nur nach der Wartezeit.
guard = openGuard(5000, true);
assert.equal(acceptsActivation(guard, 5500, KEYBOARD), false);
assert.equal(acceptsActivation(guard, 6000, KEYBOARD), true);

// Ein Zeiger zählt, wenn sein Druck nach dem Erscheinen auf der Schaltfläche begann.
assert.equal(acceptsActivation(guard, 6100, pointer(6050)), true);
assert.equal(acceptsActivation(guard, 6100, pointer(5000)), true, 'Druck im selben Moment wie das Erscheinen zählt');

// Der Klick, der den Dialog auslöste (Druck vor dem Erscheinen), und ein Druck anderswo zählen nicht, auch nicht nach der Wartezeit.
assert.equal(acceptsActivation(guard, 7000, pointer(4990)), false, 'Druck begann vor dem Dialog');
assert.equal(acceptsActivation(guard, 7000, pointer(null)), false, 'Druck begann nicht auf der Schaltfläche');

// Auch ein gültiger Druck hilft nicht innerhalb der Wartezeit (Fokus kam gerade zurück).
guard = changeAttention(guard, 7000, true);
assert.equal(acceptsActivation(guard, 7200, pointer(7100)), false);
assert.equal(acceptsActivation(guard, 8000, pointer(7100)), true);

console.log('consentGuardModel.check: ok');
