// Run: node src/lib/format.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { autoMemoryMb, formatPlaytime, formatSize, maxMemoryMb, memoryTooHigh } from './format.ts';

assert.equal(autoMemoryMb(16384), 8192);
assert.equal(autoMemoryMb(32768), 8192, 'höchstens 8 GB');
assert.equal(autoMemoryMb(3000), 2048, 'mindestens 2 GB');
assert.equal(autoMemoryMb(12000), 6144, 'Hälfte, auf 512 gerundet');
assert.equal(maxMemoryMb(16384), 14336);
assert.equal(maxMemoryMb(16000), 13824, 'abgerundet auf 512');
assert.equal(maxMemoryMb(3000), 2048);
assert.ok(memoryTooHigh(12800, 16384) && !memoryTooHigh(12288, 16384));
assert.equal(formatPlaytime(59), 'unter 1 Min.');
assert.equal(formatPlaytime(45 * 60 + 59), '45 Min.', 'Minuten abgerundet');
assert.equal(formatPlaytime(3.5 * 3600), '3,5 Std.');
assert.equal(formatPlaytime(37 * 3600 + 25 * 60), '37 Std.', 'ab 10 Stunden ganze Stunden');
assert.equal(formatPlaytime(1200 * 3600), '1.200 Std.');
assert.equal(formatSize(512), '512 Bytes');
assert.equal(formatSize(850 * 1024), '850 KB');
assert.equal(formatSize(12.4 * 1024 * 1024), '12,4 MB', 'unter 100 eine Nachkommastelle');
assert.equal(formatSize(182.6 * 1024 * 1024), '183 MB');
assert.equal(formatSize(3 * 1024 ** 3), '3 GB');
console.log('format ok');
