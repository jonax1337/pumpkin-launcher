// Spezifikation von validate-mod-index.mjs: node mod/scripts/validate-mod-index.check.mjs
import assert from 'node:assert/strict';
import { indexProblems, verifiedFileProblems, verifiedAgreementProblems } from './validate-mod-index.mjs';

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
	['rejects a duplicate id', () =>
		assert.ok(indexProblems(index(node(), node())).some(problem => problem.includes('duplicate id')))],
	['rejects an id that does not end in the loader', () =>
		assert.ok(indexProblems(index(node({ id: '1.21.1-forge' }))).some(problem => problem.includes('id must be')))],
	['rejects an empty node list', () => assert.equal(indexProblems(index()).length, 1)],
	['rejects a malformed verified entry', () =>
		assert.equal(indexProblems(index(node({ verified: { smoke: 'yesterday', owner: null } }))).length, 1)],
	['accepts the same Minecraft id on different loaders', () =>
		assert.deepEqual(indexProblems(index(node(), node({
			id: '1.21.1-fabric', loader: 'fabric', strategy: 'fabricAddMods', file: 'pumpkin_friends-2.1.0+1.21.1-fabric.jar',
		}))), [])],
	['rejects a Minecraft id that two nodes of one loader both serve', () => {
		const second = node({ id: '1.21-neoforge', minecraft: ['1.21'], file: 'pumpkin_friends-2.1.0+1.21-neoforge.jar' });
		const problems = indexProblems(index(node(), second));
		assert.equal(problems.length, 1);
		assert.match(problems[0], /Minecraft 1\.21 on neoforge is also served by 1\.21\.1-neoforge/);
	}],
	['rejects two nodes with the same file name', () => {
		const problems = indexProblems(index(node(), node({ id: '1.21.5-neoforge', minecraft: ['1.21.5'] })));
		assert.ok(problems.some(problem => problem.includes('file name is used by')));
	}],
	['accepts a verified.json entry for a known node', () =>
		assert.deepEqual(verifiedFileProblems({ '1.21.1-neoforge': { smoke: '2026-10-04', owner: null } }, ['1.21.1-neoforge']), [])],
	['rejects a verified.json key that is not a node of nodes.txt', () =>
		assert.deepEqual(verifiedFileProblems({ '9.9.9-fabric': { smoke: '2026-10-04', owner: null } }, ['1.21.1-neoforge']),
			['verified.json 9.9.9-fabric: not a node of nodes.txt'])],
	['rejects a verified.json that is not an object', () =>
		assert.deepEqual(verifiedFileProblems([], ['1.21.1-neoforge']), ['verified.json must be a JSON object'])],
	['rejects unknown fields in a verified.json entry', () =>
		assert.ok(verifiedFileProblems({ '1.21.1-neoforge': { smoke: '2026-10-04', owner: null, extra: 1 } }, ['1.21.1-neoforge'])
			.some(problem => problem.includes('unknown field')))],
	['rejects a malformed smoke date in verified.json', () =>
		assert.ok(verifiedFileProblems({ '1.21.1-neoforge': { smoke: 'yesterday', owner: null } }, ['1.21.1-neoforge'])
			.some(problem => problem.includes('smoke must be')))],
	['agreement: flags a node whose index verified differs from verified.json', () => {
		const problems = verifiedAgreementProblems(index(node({ verified: { smoke: '2026-10-04', owner: null } })), {});
		assert.deepEqual(problems, ['node 1.21.1-neoforge: verified in the index differs from verified.json']);
	}],
	['agreement: accepts an index that matches verified.json', () => {
		const verifiedFile = { '1.21.1-neoforge': { smoke: '2026-10-04', owner: null } };
		assert.deepEqual(verifiedAgreementProblems(index(node({ verified: verifiedFile['1.21.1-neoforge'] })), verifiedFile), []);
		assert.deepEqual(verifiedAgreementProblems(index(node()), {}), []);
	}],
];

for (const [name, run] of cases) {
	run();
	console.log(`ok - ${name}`);
}
