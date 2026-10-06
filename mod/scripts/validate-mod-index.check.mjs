// Spezifikation von validate-mod-index.mjs: node mod/scripts/validate-mod-index.check.mjs
import assert from 'node:assert/strict';
import { indexProblems, verifiedFileProblems, verifiedAgreementProblems, parseBudget } from './validate-mod-index.mjs';

const SHA256 = 'a'.repeat(64);

function node(overrides = {}) {
	return {
		id: '1.21.1-neoforge',
		loader: 'neoforge',
		loaderMin: '21.1.0',
		minecraft: ['1.21', '1.21.1'],
		javaMin: 21,
		strategy: 'fmlMavenRoot',
		file: 'pumpkin_bridge-2.1.0+1.21.1-neoforge.jar',
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
		assert.ok(indexProblems(index(node({ file: '../pumpkin_bridge-2.1.0+1.21.1-neoforge.jar' }))).length >= 1)],
	['accepts a plain explicit artifact name and node id', () =>
		assert.deepEqual(indexProblems(index(node({ id: 'bridge+release_1', file: 'other.jar' }))), [])],
	['rejects an upper-case or short sha256', () => {
		assert.equal(indexProblems(index(node({ sha256: 'A'.repeat(64) }))).length, 1);
		assert.equal(indexProblems(index(node({ sha256: 'a'.repeat(63) }))).length, 1);
	}],
	['rejects a strategy that does not belong to the loader', () =>
		assert.equal(indexProblems(index(node({ strategy: 'fabricAddMods' }))).length, 1)],
	['rejects a duplicate id', () =>
		assert.ok(indexProblems(index(node(), node())).some(problem => problem.includes('duplicate id')))],
	['accepts an id independent of the loader suffix', () =>
		assert.deepEqual(indexProblems(index(node({ id: '1.21.1-forge' }))), [])],
	['accepts an empty development index', () => assert.deepEqual(indexProblems(index()), [])],
	['rejects a malformed verified entry', () =>
		assert.equal(indexProblems(index(node({ verified: { smoke: 'yesterday', owner: null } }))).length, 1)],
	['accepts the same Minecraft id on different loaders', () =>
		assert.deepEqual(indexProblems(index(node(), node({
			id: '1.21.1-fabric', loader: 'fabric', strategy: 'fabricAddMods', file: 'pumpkin_bridge-2.1.0+1.21.1-fabric.jar',
		}))), [])],
	['rejects a Minecraft id that two nodes of one loader both serve', () => {
		const second = node({ id: '1.21-neoforge', minecraft: ['1.21'], file: 'pumpkin_bridge-2.1.0+1.21-neoforge.jar' });
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
	['accepts explicit Quilt and modern Forge artifacts', () => {
		assert.deepEqual(indexProblems(index(
			node({ id: 'quilt', loader: 'quilt', strategy: 'quiltAddMods', minecraft: ['1.16.5'], file: 'quilt.jar' }),
			node({ id: 'forge', loader: 'forge', strategy: 'forgeClasspath', minecraft: ['1.21.11'], file: 'forge.jar' }),
		)), []);
	}],
	['accepts exactly the loader strategy matrix', () => {
		const strategies = ['fabricAddMods', 'fmlMavenRoot', 'fmlModFolders', 'quiltAddMods', 'forgeClasspath'];
		const mappings = {
			fabric: ['fabricAddMods'],
			neoforge: ['fmlMavenRoot', 'fmlModFolders'],
			forge: ['fmlMavenRoot', 'forgeClasspath'],
			quilt: ['quiltAddMods'],
		};
		for (const [loader, allowed] of Object.entries(mappings)) {
			for (const strategy of strategies) {
				assert.equal(indexProblems(index(node({ loader, strategy }))).length, allowed.includes(strategy) ? 0 : 1,
					`${loader}/${strategy}`);
			}
		}
	}],
	['rejects unknown loaders without prototype lookups', () => {
		for (const loader of ['unknown', 'constructor', '__proto__', null, 1]) {
			assert.ok(indexProblems(index(node({ loader }))).some(problem => problem.includes('loader must be')));
		}
	}],
	['enforces plain bounded path segments without generator naming', () => {
		for (const id of ['', '.hidden', '../escape', 'a/b', 'a\\b', 'with space', 'a'.repeat(129), 123, null]) {
			assert.ok(indexProblems(index(node({ id }))).some(problem => problem.includes('id must be')));
			assert.ok(indexProblems({ ...index(node()), modVersion: id }).some(problem => problem.includes('modVersion must be')));
		}
		assert.deepEqual(indexProblems({ ...index(node({ id: 'a'.repeat(128) })), modVersion: 'release+dev' }), []);
	}],
	['enforces plain bounded jar stems', () => {
		for (const file of ['.hidden.jar', '.jar', 'a\\b.jar', 'a/b.jar', 'a.jar\n', 'a'.repeat(129) + '.jar', 123, null]) {
			assert.ok(indexProblems(index(node({ file }))).some(problem => problem.includes('file must be')));
		}
		assert.deepEqual(indexProblems(index(node({ file: 'a'.repeat(128) + '.jar' }))), []);
	}],
	['enforces canonical release ids and unique releases', () => {
		for (const release of ['01.21', '1.021', '1.21.01', '10000.1', '1.2.3.4', '1.21\n', 1.21, null]) {
			assert.ok(indexProblems(index(node({ minecraft: [release] }))).some(problem => problem.includes('release ids')));
		}
		assert.ok(indexProblems(index(node({ minecraft: ['1.21', '1.21'] }))).length > 0);
	}],
	['enforces Java bounds', () => {
		for (const javaMin of [7, 65, 8.5, '21', null]) {
			assert.ok(indexProblems(index(node({ javaMin }))).some(problem => problem.includes('javaMin')));
		}
		for (const javaMin of [8, 64]) assert.deepEqual(indexProblems(index(node({ javaMin }))), []);
	}],
	['accepts numeric loader suffixes but rejects malformed versions', () => {
		for (const loaderMin of ['0.16.0-beta', '21.1.0+build.3']) {
			assert.deepEqual(indexProblems(index(node({ loaderMin }))), []);
		}
		for (const loaderMin of ['', 'beta', '1..2', 21, null, '1.0\n', '18446744073709551616']) {
			assert.ok(indexProblems(index(node({ loaderMin }))).some(problem => problem.includes('loaderMin')));
		}
	}],
	['rejects unknown fields at every index level', () => {
		assert.ok(indexProblems({ ...index(node()), extra: true }).some(problem => problem.includes('unknown field')));
		assert.ok(indexProblems(index(node({ extra: true }))).some(problem => problem.includes('unknown field')));
		assert.ok(indexProblems(index(node({ verified: { smoke: '2026-10-04', extra: true } })))
			.some(problem => problem.includes('unknown field')));
	}],
	['accepts optional verified owner and the bounded date contract', () => {
		for (const smoke of ['2024-02-29', '0000-01-01', '2026-02-31']) {
			assert.deepEqual(indexProblems(index(node({ verified: { smoke } }))), []);
			assert.deepEqual(verifiedFileProblems({ known: { smoke } }, ['known']), []);
		}
	}],
	['rejects out-of-bounds dates in both evidence consumers', () => {
		for (const date of ['2026-13-01', '2026-01-32', '2026-00-01', '2026-01-00', '2026-10-04\n']) {
			for (const verified of [{ smoke: date }, { smoke: '2026-10-04', owner: date }]) {
				assert.ok(indexProblems(index(node({ verified }))).some(problem => problem.includes('YYYY-MM-DD')));
				assert.ok(verifiedFileProblems({ known: verified }, ['known']).some(problem => problem.includes('YYYY-MM-DD')));
			}
		}
	}],
	['rejects wrong JSON field types and missing smoke evidence', () => {
		assert.ok(indexProblems({ nodes: [] }).length > 0);
		assert.ok(indexProblems({ modVersion: '2.1.0', nodes: null }).length > 0);
		assert.ok(indexProblems(index(null)).length > 0);
		assert.ok(indexProblems(index(node({ sha256: 1 }))).length > 0);
		assert.ok(indexProblems(index(node({ verified: { owner: null } }))).length > 0);
		assert.ok(verifiedFileProblems({ known: null }, ['known']).length > 0);
	}],
	['retains declared byte budgets without silently disabling malformed limits', () => {
		assert.deepEqual(parseBudget('mod.jarMaxBytes=307200\r\nmod.totalMaxBytes=67108864\r\n'),
			{ jarMaxBytes: 307200, totalMaxBytes: 67108864 });
		for (const text of [
			'', 'mod.jarMaxBytes=0\nmod.totalMaxBytes=8388608', 'mod.jarMaxBytes=NaN\nmod.totalMaxBytes=8388608',
			'mod.jarMaxBytes=307200\nmod.totalMaxBytes=9007199254740992',
		]) assert.throws(() => parseBudget(text), /positive safe integer/);
	}],
];

for (const [name, run] of cases) {
	run();
	console.log(`ok - ${name}`);
}
