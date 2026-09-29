// Run: node src/lib/format.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { autoMemoryMb, maxMemoryMb, memoryTooHigh } from './format.ts';

assert.equal(autoMemoryMb(16384), 8192);
assert.equal(autoMemoryMb(32768), 8192, 'höchstens 8 GB');
assert.equal(autoMemoryMb(3000), 2048, 'mindestens 2 GB');
assert.equal(autoMemoryMb(12000), 6144, 'Hälfte, auf 512 gerundet');
assert.equal(maxMemoryMb(16384), 14336);
assert.equal(maxMemoryMb(16000), 13824, 'abgerundet auf 512');
assert.equal(maxMemoryMb(3000), 2048);
assert.ok(memoryTooHigh(12800, 16384) && !memoryTooHigh(12288, 16384));
console.log('format ok');
