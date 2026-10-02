// Run: node src/lib/image-hosts.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { isTrustedImageUrl, parseHttpsUrl } from './image-hosts.ts';

assert.ok(isTrustedImageUrl('https://cdn.modrinth.com/data/abc/images/1.png'));
assert.ok(isTrustedImageUrl('https://raw.githubusercontent.com/o/r/main/a.png'));
assert.ok(isTrustedImageUrl('https://i.imgur.com/x.png'));

assert.ok(!isTrustedImageUrl('http://cdn.modrinth.com/a.png'), 'nur https');
assert.ok(!isTrustedImageUrl('https://tracker.example/pixel.gif'), 'fremder Host');
assert.ok(!isTrustedImageUrl('https://cdn.modrinth.com.evil.example/a.png'), 'Host muss exakt passen');
assert.ok(!isTrustedImageUrl('https://evil.example/@cdn.modrinth.com/a.png'), 'Host steht nicht im Pfad');
assert.ok(!isTrustedImageUrl('https://cdn.modrinth.com@evil.example/a.png'), 'Zugangsdaten-Trick');
assert.ok(!isTrustedImageUrl('data:image/png;base64,AAAA'));
assert.ok(!isTrustedImageUrl('javascript:alert(1)'));
assert.ok(!isTrustedImageUrl(''));

assert.equal(parseHttpsUrl('https://example.org/a')?.hostname, 'example.org');
assert.equal(parseHttpsUrl('ftp://example.org/a'), null);
assert.equal(parseHttpsUrl('kein url'), null);
