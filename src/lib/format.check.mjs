// Run: node src/lib/format.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import {
  autoMemoryMb, dayLabel, dayStart, formatCount, formatDate, formatPlaytime, formatSize, maxMemoryMb, memoryAdvice, memoryTooHigh,
} from './format.ts';
import { setCurrentLanguage } from '../i18n/core.ts';

assert.equal(autoMemoryMb(16384), 8192);
assert.equal(autoMemoryMb(32768), 8192, 'höchstens 8 GB');
assert.equal(autoMemoryMb(3000), 2048, 'mindestens 2 GB');
assert.equal(autoMemoryMb(12000), 6144, 'Hälfte, auf 512 gerundet');
assert.equal(maxMemoryMb(16384), 14336);
assert.equal(maxMemoryMb(16000), 13824, 'abgerundet auf 512');
assert.equal(maxMemoryMb(3000), 2048);
assert.ok(memoryTooHigh(12800, 16384) && !memoryTooHigh(12288, 16384));
assert.equal(memoryAdvice(12, 300), 'manyMods', 'große Packs: Empfehlung, kein „bringt nichts“');
assert.equal(memoryAdvice(4, 151), 'manyMods');
assert.equal(memoryAdvice(12, 10), 'fewMods', 'wenige Mods und viel RAM');
assert.equal(memoryAdvice(8, 10), null, 'bis 8 GB ist es in Ordnung');
assert.equal(memoryAdvice(12, 80), null, 'mittlere Packs: kein Urteil');
assert.equal(memoryAdvice(12, undefined), null, 'Standard für alle: kein Urteil');
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
assert.equal(formatCount(3480), '3 480', 'schmales Leerzeichen statt Punkt');
// Tage laut lokaler Zeitzone; 29.03.2026 ist in Europa der Tag der Zeitumstellung (23 Stunden).
const noon = new Date(2026, 2, 30, 12).getTime();
assert.equal(dayStart(noon), new Date(2026, 2, 30).getTime());
assert.equal(dayStart(new Date(2026, 2, 30, 23, 59, 59).getTime()), new Date(2026, 2, 30).getTime(), 'bis Mitternacht derselbe Tag');
assert.equal(dayLabel(new Date(2026, 2, 30).getTime(), noon), 'Heute');
assert.equal(dayLabel(new Date(2026, 2, 29).getTime(), noon), 'Gestern', 'auch über die Zeitumstellung');
assert.equal(dayLabel(new Date(2026, 2, 28).getTime(), noon), '28. März 2026');

// Englisch: dieselben Zahlen, andere Wörter und Intl-Formate.
setCurrentLanguage('en');
assert.equal(formatPlaytime(59), 'under 1 min');
assert.equal(formatPlaytime(45 * 60 + 59), '45 min', 'Minuten abgerundet');
assert.equal(formatPlaytime(3.5 * 3600), '3.5 h');
assert.equal(formatPlaytime(1200 * 3600), '1,200 h');
assert.equal(formatSize(512), '512 bytes');
assert.equal(formatSize(12.4 * 1024 * 1024), '12.4 MB');
assert.equal(formatCount(3480), '3,480', 'Komma bleibt');
assert.equal(formatDate(noon), 'Mar 30, 2026');
assert.equal(dayLabel(new Date(2026, 2, 30).getTime(), noon), 'Today');
assert.equal(dayLabel(new Date(2026, 2, 29).getTime(), noon), 'Yesterday');
assert.equal(dayLabel(new Date(2026, 2, 28).getTime(), noon), 'Mar 28, 2026');
console.log('format ok');
