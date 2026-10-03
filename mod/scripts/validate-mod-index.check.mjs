// Spezifikation von validate-mod-index.mjs: node mod/scripts/validate-mod-index.check.mjs
import assert from 'node:assert/strict';
import { indexProblems } from './validate-mod-index.mjs';

const SHA256 = 'a'.repeat(64);

function node(overrides = {}) {
	return {
		id: '1.21.1-neoforge',
		loader: 'neoforge',
		loaderMin: '21.1.0',
		minecraft: ['1.21', '1.21.1'],
		javaMin: 21,
		strategy: 'fmlMavenRoot',
		file: 'pumpkin_friends-2.1.0+1.21.1-neoforge.jar',
		sha256: SHA256,
		verified: null,
		...overrides,
	};
}

const index = (...nodes) => ({ modVersion: '2.1.0', nodes });

const cases = [
	['accepts the contract example', () => assert.deepEqual(indexProblems(index(node())), [])],
	['accepts a verified cell', () =>
		assert.deepEqual(indexProblems(index(node({ verified: { smoke: '2026-10-03', owner: null } }))), [])],
	['accepts a missing verified entry', () => {
		const { verified, ...withoutVerified } = node();
		assert.deepEqual(indexProblems(index(withoutVerified)), []);
	}],
	['rejects a version range instead of release ids', () =>
		assert.equal(indexProblems(index(node({ minecraft: ['>=1.21'] }))).length, 1)],
	['rejects a snapshot id', () =>
		assert.equal(indexProblems(index(node({ minecraft: ['24w14a'] }))).length, 1)],
	['rejects a file name with a path', () =>
		assert.ok(indexProblems(index(node({ file: '../pumpkin_friends-2.1.0+1.21.1-neoforge.jar' }))).length >= 1)],
	['rejects a file name that does not carry mod version and node id', () =>
		assert.equal(indexProblems(index(node({ file: 'other.jar' }))).length, 1)],
	['rejects an upper-case or short sha256', () => {
		assert.equal(indexProblems(index(node({ sha256: 'A'.repeat(64) }))).length, 1);
		assert.equal(indexProblems(index(node({ sha256: 'a'.repeat(63) }))).length, 1);
	}],
	['rejects a strategy that does not belong to the loader', () =>
		assert.equal(indexProblems(index(node({ strategy: 'fabricAddMods' }))).length, 1)],
	['rejects a duplicate id', () => assert.equal(indexProblems(index(node(), node())).length, 1)],
	['rejects an id that does not end in the loader', () =>
		assert.ok(indexProblems(index(node({ id: '1.21.1-forge' }))).some(problem => problem.includes('id must be')))],
	['rejects an empty node list', () => assert.equal(indexProblems(index()).length, 1)],
	['rejects a malformed verified entry', () =>
		assert.equal(indexProblems(index(node({ verified: { smoke: 'yesterday', owner: null } }))).length, 1)],
];

for (const [name, run] of cases) {
	run();
	console.log(`ok - ${name}`);
}
