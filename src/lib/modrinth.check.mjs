// Run: node src/lib/modrinth.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { isAbsoluteMrpack, modCompatibility } from './modrinth.ts';
for (const path of ['C:\\packs\\test.mrpack', 'C:/packs/test.MRPACK', '/tmp/a.mrpack', '\\\\server\\share\\a.mrpack']) assert.equal(isAbsoluteMrpack(path), true, path);
for (const path of ['test.mrpack', 'C:test.mrpack', '/tmp/test.zip', '', 'https://example.com/a.mrpack']) assert.equal(isAbsoluteMrpack(path), false, path);
const instance = { loader: 'fabric', minecraftVersion: '1.21.1' };
const version = { loaders: ['fabric'], game_versions: ['1.21.1'] };
assert.equal(modCompatibility(instance, version), null);
assert.ok(modCompatibility(undefined, version));
assert.ok(modCompatibility(instance, undefined));
for (const loader of ['vanilla', 'forge', 'quilt', 'neoforge']) assert.ok(modCompatibility({ ...instance, loader }, version));
assert.ok(modCompatibility(instance, { ...version, game_versions: ['1.21'] }));
assert.ok(modCompatibility(instance, { ...version, loaders: ['forge'] }));
console.log('Modrinth path and compatibility checks passed');
