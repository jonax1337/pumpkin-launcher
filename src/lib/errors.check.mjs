// Run: node src/lib/errors.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { BackendError, cancelledError, isCancelled, toBackendError } from './errors.ts';
import { setCurrentLanguage } from '../i18n/core.ts';

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

// Fehlercodes: das Backend schickt `key`, `params` und `details` neben dem deutschen `message`; übersetzt wird in die Sprache der Oberfläche.
const running = { code: 'invalid', message: 'Instanz läuft noch', key: 'errors.instance.stillRunning' };
const missing = { code: 'invalid', message: 'Fabric ist nicht installiert', key: 'errors.notInstalled', params: { what: 'Fabric' } };
const offline = { code: 'http', message: 'Keine Verbindung …', key: 'errors.http.offline', details: 'error sending request' };
const nested = { code: 'download', message: 'Ein Download …', key: 'errors.download', details: { key: 'errors.instance.stillRunning' } };

setCurrentLanguage('en');
assert.equal(toBackendError(running).message, 'The instance is still running');
assert.equal(toBackendError(missing).message, 'Fabric is not installed');
assert.equal(toBackendError(offline).message, 'No internet connection. Check your connection and try again. – Details: error sending request');
assert.equal(toBackendError(nested).message, 'A download failed – Details: The instance is still running');
assert.equal(toBackendError(running).code, 'invalid', 'die Fehlerart bleibt neben der Übersetzung');
assert.equal(toBackendError(running).key, 'errors.instance.stillRunning', 'der Fehlercode bleibt, damit die Oberfläche einen Fall erkennt');
assert.equal(toBackendError('roh').key, null);
assert.equal(toBackendError({ code: 'invalid', message: 'Neu', key: 'errors.gibtEsNicht' }).key, null, 'ein unbekannter Code zählt nicht');
assert.equal(cancelledError().message, 'Operation cancelled');

// Rohe Texte noch nicht umgestellter Stellen und unbekannte Codes fallen unverändert durch.
assert.equal(toBackendError({ code: 'invalid', message: 'Ungültige Suche' }).message, 'Ungültige Suche');
assert.equal(toBackendError({ code: 'invalid', message: 'Neu im Backend', key: 'errors.gibtEsNicht' }).message, 'Neu im Backend');
assert.equal(toBackendError({ ...nested, details: { key: 'errors.gibtEsNicht' } }).message, 'Ein Download …');
assert.equal(toBackendError({ ...missing, params: 'kaputt' }).message, 'Fabric ist nicht installiert');

setCurrentLanguage('de');
assert.equal(toBackendError(missing).message, 'Fabric ist nicht installiert', 'Deutsch wie bisher');
assert.equal(toBackendError(offline).message, 'Keine Verbindung zum Internet. Prüfe deine Verbindung und versuch es erneut. – Details: error sending request');

console.log('errors.check: ok');
