// Run: node src/lib/friendCode.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { friendCodeBodyGroups, isFriendCodeShape, normalizeFriendCode } from './friendCode.ts';
import { FRIENDS_LIMITS } from './friends-types.ts';

// Goldener Vektor aus Anhang B der Spezifikation; das Backend prüft denselben Code (code.rs).
const CODE = 'pumpkin-aiaaaaicamcakbqhbaequcymbuha6earcijrifiwc4mbsgq3dqor4h5augrkhjffu2t2rvw3';
const GROUPED_BODY = 'aiaa aaic amca kbqh baeq ucym buha 6ear cijr ifiw c4mb sgq3 dqor 4h5a ugrk hjff u2t2 rvw3';

assert.equal(FRIENDS_LIMITS.codeLength, 80);
assert.equal(FRIENDS_LIMITS.codePrefix.length + FRIENDS_LIMITS.codeBodyLength, FRIENDS_LIMITS.codeLength);
assert.equal(CODE.length, FRIENDS_LIMITS.codeLength);

// Form: die Normalform und jede Schreibweise, die das Backend akzeptiert.
assert.equal(normalizeFriendCode(CODE), CODE);
assert.equal(normalizeFriendCode(`  ${CODE.toUpperCase()}\n`), CODE, 'Großbuchstaben und Ränder');
assert.equal(normalizeFriendCode(`pumpkin-${GROUPED_BODY}`), CODE, 'gruppiert mit Leerzeichen');
assert.equal(normalizeFriendCode(`pumpkin-${GROUPED_BODY.replaceAll(' ', '-')}`), CODE, 'gruppiert mit Bindestrichen');
assert.ok(isFriendCodeShape(CODE));

// Falsche Form: Präfix, Länge, Alphabet (kein 0, 1, 8, 9, kein Sonderzeichen).
for (const wrong of [
  '', 'pumpkin-', CODE.slice(1), CODE.replace('pumpkin-', 'pumpkim-'), CODE.slice(0, -1), `${CODE}a`,
  `pumpkin-${'a'.repeat(71)}0`, `pumpkin-${'a'.repeat(71)}1`, `pumpkin-${'a'.repeat(71)}8`, `pumpkin-${'a'.repeat(71)}_`,
  ` ${CODE.slice('pumpkin-'.length)}`,
]) {
  assert.ok(!isFriendCodeShape(wrong), JSON.stringify(wrong));
}

// Gruppen: 18 Vierergruppen ergeben wieder den Rumpf.
const groups = friendCodeBodyGroups(CODE);
assert.equal(groups.length, 18);
assert.equal(groups.join(' '), GROUPED_BODY);
assert.ok(groups.every((group) => group.length === 4));

console.log('friendCode.check: ok');
