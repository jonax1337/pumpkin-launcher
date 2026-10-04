// Spezifikation von compile-matrix.mjs: node mod/scripts/compile-matrix.check.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNodes, planFor, versionsToCompile } from './compile-matrix.mjs';

const NODES = `
# id loader minecraft loaderMin java strategy gradleJdk matrix
1.21.1-fabric   fabric   1.21.1 0.15.11 21 fabricAddMods 25 1.20.5,1.20.6,1.21,1.21.1
26.3-fabric     fabric   26.3   0.19.5  25 fabricAddMods 25 26.3
1.21.1-neoforge neoforge 1.21.1 21.1.0  21 fmlMavenRoot  21 1.21,1.21.1
`;

const cases = [
	['reads the columns of nodes.txt', () => {
		const [fabric] = parseNodes(NODES);
		assert.deepEqual(fabric, {
			id: '1.21.1-fabric', loader: 'fabric', minecraft: ['1.21.1'], loaderMin: '0.15.11', java: 21,
			strategy: 'fabricAddMods', gradleJdk: 25, matrix: ['1.20.5', '1.20.6', '1.21', '1.21.1'],
		});
	}],
	['compiles both ends and one middle version', () =>
		assert.deepEqual(versionsToCompile(['1.20.5', '1.20.6', '1.21', '1.21.1']), ['1.20.5', '1.21', '1.21.1'])],
	['compiles both versions of a two-version list', () =>
		assert.deepEqual(versionsToCompile(['1.21', '1.21.1']), ['1.21', '1.21.1'])],
	['compiles the only version of a one-version list once', () => assert.deepEqual(versionsToCompile(['26.3']), ['26.3'])],
	['plans every node when none is named', () =>
		assert.deepEqual(planFor(parseNodes(NODES)).map(step => step.id), ['1.21.1-fabric', '26.3-fabric', '1.21.1-neoforge'])],
	['plans only the named nodes', () => {
		const [step] = planFor(parseNodes(NODES), { nodeIds: ['1.21.1-neoforge'] });
		assert.deepEqual(step, { id: '1.21.1-neoforge', loader: 'neoforge', java: 21, gradleJdk: 21, versions: ['1.21', '1.21.1'] });
	}],
	['takes the versions of --only instead of ends and middle', () =>
		assert.deepEqual(planFor(parseNodes(NODES), { nodeIds: ['1.21.1-fabric'], only: ['1.19.4'] })[0].versions, ['1.19.4'])],
	['rejects an unknown node', () => assert.throws(() => planFor(parseNodes(NODES), { nodeIds: ['1.7.10-forge'] }), /1\.7\.10-forge/)],
	['reads the real nodes.txt, and every claim lies inside its matrix', async () => {
		const nodesPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'nodes.txt');
		for (const node of parseNodes(await readFile(nodesPath, 'utf8'))) {
			assert.ok(node.minecraft.every(version => node.matrix.includes(version)), `${node.id}: claim outside matrix`);
			assert.ok(node.gradleJdk >= Math.max(node.java, 21), `${node.id}: Gradle JDK too old`);
		}
	}],
];

let failures = 0;
for (const [name, run] of cases) {
	try {
		await run();
		console.log(`ok   ${name}`);
	} catch (failure) {
		failures++;
		console.error(`FAIL ${name}\n${failure.message}`);
	}
}
process.exit(failures === 0 ? 0 : 1);
