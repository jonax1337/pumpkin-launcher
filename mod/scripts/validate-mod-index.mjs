// Prüft mod-index.json gegen den Vertrag zwischen Gradle-Build und Launcher (docs/bridge/README.md, "Embedded index and files") und gegen die
// Jars daneben: Aufruf node mod/scripts/validate-mod-index.mjs <mod-index.json> [Ordner mit den Jars]
// Ohne Jar-Ordner liegen die Jars neben der Indexdatei. Exit-Code 1 bei jeder verletzten Regel.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOADER_STRATEGIES = {
	fabric: ['fabricAddMods'],
	neoforge: ['fmlMavenRoot', 'fmlModFolders'],
	forge: ['fmlMavenRoot', 'forgeClasspath'],
	quilt: ['quiltAddMods'],
};
const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;
const RELEASE_ID = /^(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})(\.(0|[1-9][0-9]{0,3}))?$/;
const LOADER_VERSION = /^[0-9]+(\.[0-9]+)*([-+].*)?$/;
const JAR_LEAF_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}\.jar$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ISO_DATE = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const NODE_FIELDS = ['id', 'loader', 'loaderMin', 'minecraft', 'javaMin', 'strategy', 'file', 'sha256', 'verified'];

const isPlainObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);

const matches = (pattern, value) => typeof value === 'string' && pattern.exec(value)?.[0] === value;

function unknownFieldProblems(value, allowed) {
	const unknown = Object.keys(value).filter(key => !allowed.includes(key));
	return unknown.length > 0 ? [`unknown field(s) ${unknown.join(', ')}`] : [];
}

function isLoaderVersion(value) {
	return matches(LOADER_VERSION, value)
		&& value.split(/[-+]/, 1)[0].split('.').every(part => BigInt(part) <= 18446744073709551615n);
}

function verifiedProblems(verified) {
	if (verified === null || verified === undefined) {
		return [];
	}
	if (!isPlainObject(verified)) {
		return ['verified must be null or an object'];
	}
	const problems = unknownFieldProblems(verified, ['smoke', 'owner']);
	if (!matches(ISO_DATE, verified.smoke)) {
		problems.push('verified.smoke must be a YYYY-MM-DD date');
	}
	if (verified.owner !== undefined && verified.owner !== null && !matches(ISO_DATE, verified.owner)) {
		problems.push('verified.owner must be null or a YYYY-MM-DD date');
	}
	return problems;
}

// mod/verified.json (docs/bridge/README.md): {"<node id>": {"smoke": "YYYY-MM-DD", "owner": null | "YYYY-MM-DD"}}. Only a passed smoke
// test adds an entry, so every key must be a node of nodes.txt and every entry must be a complete verified object.
export function verifiedFileProblems(verifiedFile, knownNodeIds) {
	if (!isPlainObject(verifiedFile)) {
		return ['verified.json must be a JSON object'];
	}
	return Object.entries(verifiedFile).flatMap(([nodeId, verified]) => {
		const label = `verified.json ${nodeId}`;
		if (!knownNodeIds.includes(nodeId)) {
			return [`${label}: not a node of nodes.txt`];
		}
		if (!isPlainObject(verified)) {
			return [`${label}: must be an object`];
		}
		return verifiedProblems(verified).map(problem => `${label}: ${problem}`);
	});
}

// The index must carry exactly what verified.json says: an entry for a proven cell, null for every other node.
export function verifiedAgreementProblems(index, verifiedFile) {
	return index.nodes
		.filter(node => !isDeepStrictEqual(node.verified ?? null, verifiedFile[node.id] ?? null))
		.map(node => `node ${node.id}: verified in the index differs from verified.json`);
}

export function nodeProblems(node) {
	const problems = unknownFieldProblems(node, NODE_FIELDS);
	const strategies = typeof node.loader === 'string' && Object.hasOwn(LOADER_STRATEGIES, node.loader)
		? LOADER_STRATEGIES[node.loader] : undefined;
	if (!strategies) {
		problems.push(`loader must be one of ${Object.keys(LOADER_STRATEGIES).join(', ')}`);
	} else if (!strategies.includes(node.strategy)) {
		problems.push(`strategy for ${node.loader} must be one of ${strategies.join(', ')}`);
	}
	if (!matches(PLAIN_NAME, node.id)) {
		problems.push('id must be a plain name of at most 128 characters');
	}
	if (!isLoaderVersion(node.loaderMin)) {
		problems.push('loaderMin must be a numeric loader version');
	}
	if (!Array.isArray(node.minecraft) || node.minecraft.length === 0
		|| !node.minecraft.every(id => matches(RELEASE_ID, id))) {
		problems.push('minecraft must be a non-empty list of explicit release ids');
	}
	if (!Number.isInteger(node.javaMin) || node.javaMin < 8 || node.javaMin > 64) {
		problems.push('javaMin must be an integer between 8 and 64');
	}
	if (!matches(JAR_LEAF_NAME, node.file)) {
		problems.push('file must be a plain jar leaf name');
	}
	if (!matches(SHA256, node.sha256)) {
		problems.push('sha256 must be 64 lowercase hex characters');
	}
	return [...problems, ...verifiedProblems(node.verified)];
}

// Der Launcher wählt den Knoten über (Loader, Minecraft-Version) und den Dateinamen; beides darf nicht doppelt vorkommen.
function crossNodeProblems(nodes) {
	const problems = [];
	const fileOwners = new Map();
	const releaseOwners = new Map();
	for (const node of nodes.filter(isPlainObject)) {
		const previousFileOwner = fileOwners.get(node.file);
		if (previousFileOwner !== undefined) {
			problems.push(`node ${node.id}: file name is used by ${previousFileOwner} as well`);
		}
		fileOwners.set(node.file, node.id);
		for (const release of Array.isArray(node.minecraft) ? node.minecraft : []) {
			const key = `${node.loader}/${release}`;
			if (releaseOwners.has(key)) {
				problems.push(`node ${node.id}: Minecraft ${release} on ${node.loader} is also served by ${releaseOwners.get(key)}`);
			}
			releaseOwners.set(key, node.id);
		}
	}
	return problems;
}

export function indexProblems(index) {
	if (!isPlainObject(index)) {
		return ['index must be a JSON object'];
	}
	const problems = unknownFieldProblems(index, ['modVersion', 'nodes']);
	if (!matches(PLAIN_NAME, index.modVersion)) {
		problems.push('modVersion must be a plain name of at most 128 characters');
	}
	if (!Array.isArray(index.nodes)) {
		return [...problems, 'nodes must be a list'];
	}
	const seenIds = new Set();
	for (const node of index.nodes) {
		const label = `node ${node?.id}`;
		if (!isPlainObject(node)) {
			problems.push('every node must be an object');
			continue;
		}
		if (seenIds.has(node.id)) {
			problems.push(`${label}: duplicate id`);
		}
		seenIds.add(node.id);
		problems.push(...nodeProblems(node).map(problem => `${label}: ${problem}`));
	}
	return [...problems, ...crossNodeProblems(index.nodes)];
}

export function parseBudget(text) {
	const read = key => {
		const value = Number(text.match(new RegExp(`^${key.replaceAll('.', '\\.')}=(\\d+)\\r?$`, 'm'))?.[1]);
		if (!Number.isSafeInteger(value) || value <= 0) {
			throw new Error(`${key} must be a positive safe integer byte limit`);
		}
		return value;
	};
	return { jarMaxBytes: read('mod.jarMaxBytes'), totalMaxBytes: read('mod.totalMaxBytes') };
}

async function readBudget(gradlePropertiesPath) {
	return parseBudget(await readFile(gradlePropertiesPath, 'utf8'));
}

async function jarProblems(index, jarDirectory, budget) {
	const problems = [];
	let total = 0;
	for (const node of index.nodes) {
		try {
			const bytes = await readFile(join(jarDirectory, node.file));
			total += bytes.length;
			if (createHash('sha256').update(bytes).digest('hex') !== node.sha256) {
				problems.push(`node ${node.id}: sha256 does not match ${node.file}`);
			}
			if (bytes.length > budget.jarMaxBytes) {
				problems.push(`node ${node.id}: ${node.file} is ${bytes.length} bytes, limit ${budget.jarMaxBytes}`);
			}
		} catch (failure) {
			problems.push(`node ${node.id}: cannot read ${node.file} (${failure.code ?? failure.message})`);
		}
	}
	if (total > budget.totalMaxBytes) {
		problems.push(`all jars together are ${total} bytes, limit ${budget.totalMaxBytes}`);
	}
	return problems;
}

async function readNodeIds(nodesPath) {
	const text = await readFile(nodesPath, 'utf8');
	return text.split(/\r?\n/).map(line => line.replace(/#.*/, '').trim()).filter(Boolean).map(line => line.split(/\s+/)[0]);
}

async function readVerifiedFile(path) {
	try {
		return JSON.parse(await readFile(path, 'utf8'));
	} catch (failure) {
		if (failure.code === 'ENOENT') {
			return {};
		}
		throw failure;
	}
}

async function main() {
	const [indexPath, jarDirectory = dirname(indexPath ?? '.')] = process.argv.slice(2);
	if (!indexPath) {
		console.error('usage: validate-mod-index.mjs <mod-index.json> [jar directory]');
		process.exit(2);
	}
	const modDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');
	const index = JSON.parse(await readFile(indexPath, 'utf8'));
	const verifiedFile = await readVerifiedFile(join(modDirectory, 'verified.json'));
	const problems = [...indexProblems(index), ...verifiedFileProblems(verifiedFile, await readNodeIds(join(modDirectory, 'nodes.txt')))];
	if (problems.length === 0) {
		problems.push(...verifiedAgreementProblems(index, verifiedFile));
	}
	if (problems.length === 0) {
		problems.push(...(await jarProblems(index, jarDirectory, await readBudget(join(modDirectory, 'gradle.properties')))));
	}
	if (problems.length > 0) {
		console.error(problems.join('\n'));
		process.exit(1);
	}
	console.log(`validate-mod-index: ok (${index.nodes.length} node(s), modVersion ${index.modVersion})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}
