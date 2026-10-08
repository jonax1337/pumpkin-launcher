// Run: node src/lib/launchSettings.check.mjs (Node with TypeScript stripping).
import assert from 'node:assert/strict';
import { envNameProblem, isPresetOn, presetsFor, sameLaunch, settleLaunch, togglePreset } from './launchSettings.ts';

const empty = { env: [], wrapper: '', preLaunch: '', postExit: '' };

// Nur Linux bekommt Vorgaben: GameMode, MangoHud, PRIME-Auslagerung gibt es nur dort.
assert.deepEqual(presetsFor('linux'), ['gamemode', 'mangohud', 'nvidia', 'amd']);
assert.deepEqual(presetsFor('windows'), []);
assert.deepEqual(presetsFor('macos'), []);

// Wrapper-Vorgaben lassen sich kombinieren und einzeln wieder ausschalten.
const both = togglePreset(togglePreset(empty, 'gamemode'), 'mangohud');
assert.equal(both.wrapper, 'gamemoderun mangohud');
assert.ok(isPresetOn(both, 'gamemode') && isPresetOn(both, 'mangohud'));
assert.equal(togglePreset(both, 'gamemode').wrapper, 'mangohud');
assert.equal(togglePreset(togglePreset(both, 'gamemode'), 'mangohud').wrapper, '');

// Variablen-Vorgaben setzen alle ihre Variablen, ersetzen gleichnamige und lassen fremde in Ruhe.
const own = { ...empty, env: [{ name: 'FOO', value: 'bar' }, { name: '__GLX_VENDOR_LIBRARY_NAME', value: 'mesa' }] };
const nvidia = togglePreset(own, 'nvidia');
assert.deepEqual(nvidia.env.map((row) => row.name), ['FOO', '__NV_PRIME_RENDER_OFFLOAD', '__GLX_VENDOR_LIBRARY_NAME', '__VK_LAYER_NV_optimus']);
assert.equal(nvidia.env.find((row) => row.name === '__GLX_VENDOR_LIBRARY_NAME').value, 'nvidia');
assert.ok(isPresetOn(nvidia, 'nvidia'));
assert.deepEqual(togglePreset(nvidia, 'nvidia').env, [{ name: 'FOO', value: 'bar' }]);
assert.ok(!isPresetOn(own, 'nvidia'));
assert.deepEqual(togglePreset(empty, 'amd').env, [{ name: 'DRI_PRIME', value: '1' }]);

// Namen wie im Backend.
assert.equal(envNameProblem('FOO_1'), null);
assert.equal(envNameProblem(''), null);
for (const name of ['1A', 'A-B', 'A B', 'A=B', 'Ä']) assert.equal(envNameProblem(name), 'invalid', name);
for (const name of ['PUMPKIN_IPC_TOKEN', 'pumpkin_x']) assert.equal(envNameProblem(name), 'reserved', name);
assert.equal(envNameProblem('PUMPKINS'), null);

// Gespeichert wird getrimmt; Zeilen ohne Namen sind noch nicht fertig und bleiben draußen.
const settled = settleLaunch({ env: [{ name: ' A ', value: 'x ' }, { name: '', value: 'y' }], wrapper: ' mangohud ', preLaunch: ' ', postExit: 'a b' });
assert.deepEqual(settled, { env: [{ name: 'A', value: 'x ' }], wrapper: 'mangohud', preLaunch: '', postExit: 'a b' });
assert.ok(sameLaunch(settled, structuredClone(settled)));
assert.ok(!sameLaunch(settled, { ...settled, env: [{ name: 'A', value: 'x' }] }));
assert.ok(!sameLaunch(settled, { ...settled, postExit: '' }));

console.log('launchSettings ok');
