// Run: node src/lib/serverAddress.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { isValidServerAddress, serverNameFromAddress } from './serverAddress.ts';

// Dieselben Fälle prüft das Backend in servers.rs.
for (const address of [
  'play.example.net', ' play.example.net:25570 ', 'localhost', '127.0.0.1:1', 'mc_1.bär.de:65535', '[::1]', '[2001:db8::1]:25570',
  '[::]', '[1:2:3:4:5:6:7:8]', '[1:2:3:4:5:6:7::]', '[::ffff:192.168.0.1]', '[1:2:3:4:5:6:1.2.3.4]',
]) {
  assert.ok(isValidServerAddress(address), address);
}
for (const address of [
  '', 'mit leerzeichen', '--demo', '-a.net', 'a-.net', 'a\nb', 'not a valid address!!', 'a..net', '.net', 'net.',
  'host:', 'host:0', 'host:65536', 'host:-1', 'host:12a', 'host:1:2', '::1', '[::1', '[::1]x', '[::1]:', 'ho/st', 'ho@st',
  '[:::]:25565', '[1:2:3:4:5:6:7:8:9]', '[1:2:3:4:5:6:7]', '[1::2::3]', '[12345::1]', '[g::1]', '[:1:2:3:4:5:6:7]', '[1::2:]', '[::1.2.3]', '[::256.1.1.1]', '[1:2:3:4:5:6:7:1.2.3.4]', '[]',
  'a'.repeat(64), 'a.'.repeat(130) + 'a',
]) {
  assert.ok(!isValidServerAddress(address), JSON.stringify(address));
}

// Der Name folgt der Adresse, auch halb getippt.
assert.equal(serverNameFromAddress(' play.example.net:25565 '), 'play.example.net');
assert.equal(serverNameFromAddress('play.exa'), 'play.exa');
assert.equal(serverNameFromAddress('play.example.net:'), 'play.example.net');
assert.equal(serverNameFromAddress(''), '');

console.log('serverAddress.check ok');
