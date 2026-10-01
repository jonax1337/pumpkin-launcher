// Run: node src/lib/errors.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { BackendError, cancelledError, isCancelled, toBackendError } from './errors.ts';

// Wie das Backend einen Fehler zurückweist: `{ code, message }` (AppError).
const fromBackend = toBackendError({ code: 'cancelled', message: 'Vorgang abgebrochen' });
assert.ok(fromBackend instanceof BackendError && fromBackend instanceof Error);
assert.equal(fromBackend.message, 'Vorgang abgebrochen');
assert.equal(fromBackend.code, 'cancelled');
assert.ok(isCancelled(fromBackend));
assert.ok(isCancelled(cancelledError()), 'der Mock meldet den Abbruch wie das Backend');

// Der Abbruch hängt am Code, nicht am Wortlaut.
assert.ok(isCancelled(toBackendError({ code: 'cancelled', message: 'ganz anderer Text' })));
assert.ok(!isCancelled(toBackendError({ code: 'io', message: 'Vorgang abgebrochen' })));
assert.ok(!isCancelled(new Error('Vorgang abgebrochen')));
assert.ok(!isCancelled('Vorgang abgebrochen'));
assert.ok(!isCancelled(undefined));

// Plugin-Fehler: string oder Objekt ohne Code; die Meldung bleibt lesbar, die Ursache erhalten.
const plain = toBackendError('Aktualisierung fehlgeschlagen');
assert.equal(plain.message, 'Aktualisierung fehlgeschlagen');
assert.equal(plain.code, null);
assert.equal(plain.cause, 'Aktualisierung fehlgeschlagen');
assert.equal(toBackendError({ message: 'kaputt' }).message, 'kaputt');
assert.equal(toBackendError({ detail: 1 }).message, '{"detail":1}');

console.log('errors.check: ok');
