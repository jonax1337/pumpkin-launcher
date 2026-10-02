// Run: node src/pixel/sceneConfig.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { BIOME_KEYS, isBiome } from './sceneConfig.ts';

for (const biome of BIOME_KEYS) assert.ok(isBiome(biome));
// Modpacks bringen beliebige Namen mit; auch Namen aus der Prototypkette sind keine Biome.
for (const name of ['', 'lava', 'Forest', 'constructor', 'toString', '__proto__']) assert.ok(!isBiome(name), name);
console.log('sceneConfig ok');
