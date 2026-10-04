// Compile-Matrix (docs/friends/INGAME.md 4.3): übersetzt jeden Knoten gegen beide Enden und eine mittlere Version seiner
// matrix aus nodes.txt (Spalte matrix = docs/friends/INGAME-API.md Abschnitt 5). So bricht der Build, sobald ein Knoten
// eine Minecraft-Version beansprucht, gegen die seine Quellen nicht mehr übersetzen.
//
// Aufruf aus mod/ oder von überall:
//   node mod/scripts/compile-matrix.mjs [--node <id>[,<id>]] [--only <version>[,<version>]] [--plan]
//     --node   nur diese Knoten (Standard: alle in nodes.txt)
//     --only   statt Enden und Mitte genau diese Versionen (Gradle lehnt Versionen außerhalb der matrix ab)
//     --plan   gibt den Plan als JSON aus und übersetzt nichts (die Job-Matrix des Workflows)
// Gradle läuft auf dem JDK aus PUMPKIN_JDK_<gradleJdk> des Knotens, falls gesetzt (siehe README, scripts/dev-env.*).
// Exit-Code 1, sobald eine Übersetzung scheitert.
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseNodes(nodesText) {
	return nodesText
		.split(/\r?\n/)
		.map(line => line.replace(/#.*/, '').trim())
		.filter(line => line.length > 0)
		.map(line => {
			const [id, loader, minecraft, loaderMin, java, strategy, gradleJdk, matrix] = line.split(/\s+/);
			return { id, loader, minecraft: minecraft.split(','), loaderMin, java: Number(java), strategy, gradleJdk: Number(gradleJdk), matrix: matrix.split(',') };
		});
}

/** Beide Enden und die mittlere Version der Liste, ohne Doppelte, in der Reihenfolge der Liste. */
export function versionsToCompile(matrix) {
	const picks = [matrix[0], matrix[Math.floor(matrix.length / 2)], matrix[matrix.length - 1]];
	return matrix.filter(version => picks.includes(version));
}

export function planFor(nodes, { nodeIds = [], only = [] } = {}) {
	const unknown = nodeIds.filter(id => !nodes.some(node => node.id === id));
	if (unknown.length > 0) {
		throw new Error(`Unbekannte Knoten: ${unknown.join(', ')}. Bekannt: ${nodes.map(node => node.id).join(', ')}`);
	}
	return nodes
		.filter(node => nodeIds.length === 0 || nodeIds.includes(node.id))
		.map(node => ({ id: node.id, loader: node.loader, java: node.java, gradleJdk: node.gradleJdk, versions: only.length > 0 ? only : versionsToCompile(node.matrix) }));
}

function parseArguments(argv) {
	const options = { nodeIds: [], only: [], plan: false };
	for (let index = 0; index < argv.length; index++) {
		const list = () => argv[++index].split(',').filter(Boolean);
		if (argv[index] === '--node') {
			options.nodeIds = list();
		} else if (argv[index] === '--only') {
			options.only = list();
		} else if (argv[index] === '--plan') {
			options.plan = true;
		} else {
			throw new Error(`Unbekannte Option: ${argv[index]}`);
		}
	}
	return options;
}

function compileOnce(modDirectory, step, version) {
	const gradlew = process.platform === 'win32' ? `"${join(modDirectory, 'gradlew.bat')}"` : './gradlew';
	const jdkHome = process.env[`PUMPKIN_JDK_${step.gradleJdk}`];
	const env = jdkHome ? { ...process.env, JAVA_HOME: jdkHome } : process.env;
	const result = spawnSync(gradlew, [`-Pnode=${step.id}`, `-Pcompile.minecraft=${version}`, 'compileJava'], {
		cwd: modDirectory,
		env,
		stdio: 'inherit',
		shell: process.platform === 'win32',
	});
	return result.status === 0;
}

function compileAll(modDirectory, plan) {
	const results = [];
	for (const step of plan) {
		for (const version of step.versions) {
			console.log(`\n=== compile-matrix: ${step.id} gegen Minecraft ${version} ===`);
			results.push({ node: step.id, version, ok: compileOnce(modDirectory, step, version) });
		}
	}
	return results;
}

function report(results) {
	console.log('\ncompile-matrix:');
	for (const { node, version, ok } of results) {
		console.log(`  ${ok ? 'ok    ' : 'FAILED'} ${node} @ ${version}`);
	}
}

async function main() {
	const modDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');
	const options = parseArguments(process.argv.slice(2));
	const nodes = parseNodes(await readFile(join(modDirectory, 'nodes.txt'), 'utf8'));
	const plan = planFor(nodes, options);
	if (options.plan) {
		console.log(JSON.stringify(plan));
		return;
	}
	const results = compileAll(modDirectory, plan);
	report(results);
	process.exit(results.every(result => result.ok) ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		await main();
	} catch (failure) {
		console.error(failure.message);
		process.exit(2);
	}
}
