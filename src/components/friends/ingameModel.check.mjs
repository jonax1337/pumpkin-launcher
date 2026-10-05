// Run: node src/components/friends/ingameModel.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { friendsHost as de } from '../../i18n/de/friendsHost.ts';
import { friendsHost as en } from '../../i18n/en/friendsHost.ts';
import { ADDED_LOADER, ingameRow, withAddedLoader } from './ingameModel.ts';

const FAILURES = ['fabricIncompatibleModSet', 'mixinApplyFailed', 'modLoadingError', 'unsupportedClassVersion', 'unknown'];
const SIMPLE_REASONS = [
  'notInBuild', 'vanilla', 'quilt', 'noNode', 'unverified', 'loaderVersionUnknown', 'javaUnknown', 'idCollision', 'offlineAccount',
  'bridgeNotRunning', 'instanceOff', 'globallyOff',
];
const REASONS = [
  ...SIMPLE_REASONS.map((type) => ({ type })),
  { type: 'loaderTooOld', need: '0.16.0' },
  { type: 'javaTooOld', need: 21 },
  ...FAILURES.map((reason) => ({ type: 'breaker', reason })),
];
const NODE = { id: '1.21.1-fabric', minecraft: '1.21.1', loader: 'fabric' };
const instance = { loader: 'fabric', minecraftVersion: '1.21.1' };
const status = (state, reason = null, node = NODE) => ({ state, reason, node });
const row = (state, reason, node) => ingameRow(status(state, reason, node), instance);

// aktiv: Text mit Loader und Version, Schalter an, noch nicht verbunden.
assert.deepEqual(row('active'), {
  line: { key: 'friendsHost.ingame.active', loader: 'fabric', minecraft: '1.21.1' }, toggle: 'on', action: null, connected: false,
});
assert.equal(ingameRow(status('active', null, { ...NODE, loader: 'neoforge' }), instance).line.loader, 'neoforge', 'der Loader der Zelle zählt');
assert.equal(ingameRow(status('active', null, null), instance).line.loader, 'fabric', 'ohne Zelle der Loader der Instanz');

// verbunden: das Etikett zeigt es, der Schalter bleibt für den nächsten Start.
assert.deepEqual(row('connected'), { line: { key: 'friendsHost.ingame.connected' }, toggle: 'on', action: null, connected: true });

// aus: Schalter aus; steht die Einstellung dahinter, gibt es keinen Schalter der Instanz.
assert.deepEqual(row('off', { type: 'instanceOff' }), { line: { key: 'friendsHost.ingame.off' }, toggle: 'off', action: null, connected: false });
assert.equal(row('off', null).line.key, 'friendsHost.ingame.off');
assert.deepEqual(row('off', { type: 'globallyOff' }).toggle, null);
assert.equal(row('off', { type: 'globallyOff' }).line.key, 'friendsHost.ingame.reason.globallyOff');

// nach einem Startfehler: Grund im Text, Schalter aus und „Erneut versuchen“.
const tripped = row('autoOff', { type: 'breaker', reason: 'mixinApplyFailed' });
assert.deepEqual(tripped, {
  line: { key: 'friendsHost.ingame.reason.breaker', failure: 'mixinApplyFailed' }, toggle: 'off', action: 'retry', connected: false,
});
assert.equal(row('autoOff', null).line.key, 'friendsHost.ingame.autoOff');

// nicht verfügbar: kein Schalter, nur bei Vanilla das Angebot auf Fabric; sonst nie eine Aktion.
for (const reason of REASONS.filter((r) => r.type !== 'instanceOff' && r.type !== 'globallyOff' && r.type !== 'breaker')) {
  const unavailable = row('unavailable', reason, null);
  assert.equal(unavailable.toggle, null, reason.type);
  assert.equal(unavailable.action, reason.type === 'vanilla' ? 'addFabric' : null, reason.type);
  assert.equal(unavailable.connected, false, reason.type);
}
assert.deepEqual(row('unavailable', { type: 'vanilla' }, null).line, { key: 'friendsHost.ingame.reason.vanilla' });
assert.deepEqual(row('unavailable', { type: 'noNode' }, null).line, { key: 'friendsHost.ingame.reason.noNode', loader: 'fabric', minecraft: '1.21.1' });
assert.deepEqual(row('unavailable', { type: 'unverified' }, null).line, { key: 'friendsHost.ingame.reason.unverified', loader: 'fabric', minecraft: '1.21.1' });
assert.deepEqual(row('unavailable', { type: 'loaderTooOld', need: '0.16.0' }, null).line, { key: 'friendsHost.ingame.reason.loaderTooOld', loader: 'fabric', need: '0.16.0' });
assert.deepEqual(row('unavailable', { type: 'javaTooOld', need: 21 }, null).line, { key: 'friendsHost.ingame.reason.javaTooOld', need: 21 });

// Jeder Zustand mit jedem Grund hat in beiden Sprachen einen Text, dessen Platzhalter die Zeile füllt.
const PLACEHOLDER_FIELDS = { loader: 'loader', minecraft: 'minecraft', need: 'need', failure: 'failure' };
for (const state of ['active', 'connected', 'off', 'autoOff', 'unavailable']) {
  for (const reason of [null, ...REASONS]) {
    const { line } = row(state, reason, null);
    for (const [language, words] of [['de', de], ['en', en]]) {
      const text = words[line.key];
      assert.ok(text, `${language}: ${line.key} fehlt (${state}/${reason?.type})`);
      for (const [, name] of text.matchAll(/\{(\w+)\}/g)) {
        assert.ok(name in PLACEHOLDER_FIELDS, `${language}: ${line.key} kennt {${name}} nicht`);
        assert.notEqual(line[PLACEHOLDER_FIELDS[name]], undefined, `${language}: ${line.key} braucht ${name} (${state}/${reason?.type})`);
      }
    }
  }
}
for (const failure of FAILURES) {
  assert.ok(de[`friendsHost.ingame.failure.${failure}`] && en[`friendsHost.ingame.failure.${failure}`], failure);
}

// „Fabric hinzufügen?“ ändert nur den Loader und lässt die Loader-Version leer; alles andere der Instanz bleibt.
const vanilla = { id: 'inst-vanilla', name: 'Vanilla', loader: 'vanilla', loaderVersion: null, minecraftVersion: '1.21.1', modCount: 0 };
assert.equal(ADDED_LOADER, 'fabric');
assert.deepEqual(withAddedLoader(vanilla), { ...vanilla, loader: 'fabric', loaderVersion: null });
assert.equal(withAddedLoader({ ...vanilla, loader: 'quilt', loaderVersion: '0.2' }).loaderVersion, null);

console.log('ingameModel.check: ok');
