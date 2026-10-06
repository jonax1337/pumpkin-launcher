// Run: node src/components/friends/breakerModel.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { friendsHost as de } from '../../i18n/de/friendsHost.ts';
import { friendsHost as en } from '../../i18n/en/friendsHost.ts';
import { runBreakerChoice } from './breakerModel.ts';

/** Schritte, die ihre Aufrufe der Reihe nach aufschreiben; `failing` lässt einen davon ablehnen. */
function recordedSteps(failing) {
  const calls = [];
  const step = (name) => async () => {
    calls.push(name);
    if (name === failing) throw new Error(`${name} failed`);
  };
  return { calls, steps: { switchOff: step('switchOff'), retry: step('retry'), start: step('start') } };
}

// „Ohne Pumpkin Bridge starten“: Schalter der Instanz aus, danach der Start.
let run = recordedSteps();
await runBreakerChoice('startWithout', run.steps);
assert.deepEqual(run.calls, ['switchOff', 'start']);

// „Trotzdem erneut versuchen“: Sperre aufheben, danach der Start.
run = recordedSteps();
await runBreakerChoice('retryAnyway', run.steps);
assert.deepEqual(run.calls, ['retry', 'start']);

// Der Start wartet auf den ersten Schritt: er darf den Zustand nicht überholen.
let switchedOff = false;
await runBreakerChoice('startWithout', {
  switchOff: async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    switchedOff = true;
  },
  retry: async () => {},
  start: async () => assert.equal(switchedOff, true, 'der Start kam vor dem Ausschalten'),
});

// Scheitert der Zustand, startet nichts (sonst stürzte das Spiel mit der Mod erneut ab), und der Fehler kommt beim Aufrufer an.
for (const [choice, failing] of [['startWithout', 'switchOff'], ['retryAnyway', 'retry']]) {
  run = recordedSteps(failing);
  await assert.rejects(runBreakerChoice(choice, run.steps), { message: `${failing} failed` });
  assert.deepEqual(run.calls, [failing]);
}

// Ein Fehler beim Start selbst geht ebenfalls an den Aufrufer.
run = recordedSteps('start');
await assert.rejects(runBreakerChoice('startWithout', run.steps), { message: 'start failed' });

// Beide Sprachen verwenden dieselben Platzhalter im Dialog.
for (const key of ['title', 'text', 'detail', 'startWithout', 'retry']) {
  const placeholders = (words) => [...words[`friendsHost.breaker.${key}`].matchAll(/\{(\w+)\}/g)].map(([, name]) => name);
  assert.ok(en[`friendsHost.breaker.${key}`], key);
  assert.deepEqual(placeholders(en), placeholders(de), key);
}

console.log('breakerModel.check: ok');
