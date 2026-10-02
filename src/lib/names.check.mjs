// Run: node src/lib/names.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { uniqueName } from './names.ts';

assert.equal(uniqueName('Meine Welt', []), 'Meine Welt');
assert.equal(uniqueName('Meine Welt', ['Meine Mods']), 'Meine Welt');
assert.equal(uniqueName('Meine Welt', ['Meine Welt']), 'Meine Welt 2');
assert.equal(uniqueName('Meine Welt', ['meine welt ', 'Meine Welt 2']), 'Meine Welt 3');
console.log('names ok');
