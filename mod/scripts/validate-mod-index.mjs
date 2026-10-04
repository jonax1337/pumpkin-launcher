// Prüft mod-index.json gegen den Vertrag zwischen Gradle-Build und Launcher (docs/friends/INGAME.md 3.2) und gegen die
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
	forge: ['fmlMavenRoot'],
};
const MOD_VERSION = /^\d+\.\d+\.\d+$/;
const RELEASE_ID = /^\d+\.\d+(\.\d+)?$/;
const LOADER_VERSION = /^\d+(\.\d+)*$/;
const JAR_LEAF_NAME = /^[A-Za-z0-9._+-]+\.jar$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isPlainObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);

function verifiedProblems(verified) {
	if (verified === null || verified === undefined) {
		return [];
	}
	if (!isPlainObject(verified)) {
		return ['verified must be null or an object'];
	}
	const problems = [];
	if (!ISO_DATE.test(verified.smoke ?? '')) {
		problems.push('verified.smoke must be a YYYY-MM-DD date');
	}
	if (verified.owner !== null && !ISO_DATE.test(verified.owner ?? '')) {
		problems.push('verified.owner must be null or a YYYY-MM-DD date');
	}
	return problems;
}

// mod/verified.json (INGAME A17): {"<node id>": {"smoke": "YYYY-MM-DD", "owner": null | "YYYY-MM-DD"}}. Only a passed smoke
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
		const unknownKeys = Object.keys(verified).filter(key => key !== 'smoke' && key !== 'owner');
		const unknown = unknownKeys.length > 0 ? [`unknown field(s) ${unknownKeys.join(', ')}`] : [];
		return [...unknown, ...verifiedProblems(verified)].map(problem => `${label}: ${problem}`);
	});
}

// The index must carry exactly what verified.json says: an entry for a proven cell, null for every other node.
export function verifiedAgreementProblems(index, verifiedFile) {
	return index.nodes
		.filter(node => !isDeepStrictEqual(node.verified ?? null, verifiedFile[node.id] ?? null))
		.map(node => `node ${node.id}: verified in the index differs from verified.json`);
}

export function nodeProblems(node, modVersion) {
	const problems = [];
	const strategies = LOADER_STRATEGIES[node.loader];
	if (!strategies) {
		problems.push(`loader must be one of ${Object.keys(LOADER_STRATEGIES).join(', ')}`);
	} else if (!strategies.includes(node.strategy)) {
		problems.push(`strategy for ${node.loader} must be one of ${strategies.join(', ')}`);
	}
	if (typeof node.id !== 'string' || !node.id.endsWith(`-${node.loader}`)) {
		problems.push('id must be <minecraft>-<loader>');
	}
	if (!LOADER_VERSION.test(node.loaderMin ?? '')) {
		problems.push('loaderMin must be a dotted version');
	}
	if (!Array.isArray(node.minecraft) || node.minecraft.length === 0 || !node.minecraft.every(id => RELEASE_ID.test(id))) {
		problems.push('minecraft must be a non-empty list of explicit release ids');
	}
	if (!Number.isInteger(node.javaMin) || node.javaMin < 8) {
		problems.push('javaMin must be an integer of at least 8');
	}
	if (!JAR_LEAF_NAME.test(node.file ?? '')) {
		problems.push('file must be a plain jar leaf name');
	} else if (node.file !== `pumpkin_friends-${modVersion}+${node.id}.jar`) {
		problems.push(`file must be pumpkin_friends-${modVersion}+${node.id}.jar`);
	}
	if (!SHA256.test(node.sha256 ?? '')) {
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
	const problems = [];
	if (!MOD_VERSION.test(index.modVersion ?? '')) {
		problems.push('modVersion must be MAJOR.MINOR.PATCH');
	}
	if (!Array.isArray(index.nodes) || index.nodes.length === 0) {
		return [...problems, 'nodes must be a non-empty list'];
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
		problems.push(...nodeProblems(node, index.modVersion).map(problem => `${label}: ${problem}`));
	}
	return [...problems, ...crossNodeProblems(index.nodes)];
}

async function readBudget(gradlePropertiesPath) {
	const text = await readFile(gradlePropertiesPath, 'utf8');
	const read = key => Number(text.match(new RegExp(`^${key.replaceAll('.', '\\.')}=(\\d+)$`, 'm'))?.[1]);
	return { jarMaxBytes: read('mod.jarMaxBytes'), totalMaxBytes: read('mod.totalMaxBytes') };
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
