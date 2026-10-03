// Prüft die Schichtenregeln der Mod (docs/friends/INGAME.md 4.1) und bricht mit Exit-Code 1 ab, wenn eine verletzt ist:
//   1. Stonecutter-Bedingungen (//? if ..., /*? ... */) und Swaps (//$ name) stehen nur in compat/ und platform/.
//   2. core/ importiert keine Minecraft- oder Loader-Klasse.
// Aufruf aus beliebigem Ordner: node mod/scripts/check-conditionals.mjs [mod-Ordner]
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_ROOTS = ['src', 'core/src'];
const CONDITIONAL_ALLOWED_DIRECTORIES = new Set(['compat', 'platform']);
const CONDITIONAL = /(^|[\s;{})])(\/\/[?$]|\/\*[?$])/;
const MINECRAFT_IMPORT =
	/^\s*import\s+(static\s+)?(net\.minecraft|net\.minecraftforge|net\.neoforged|net\.fabricmc|com\.mojang|cpw\.mods|org\.spongepowered)\./;

async function* filesBelow(directory) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			yield* filesBelow(path);
		} else {
			yield path;
		}
	}
}

async function existingFilesBelow(directory) {
	const files = [];
	try {
		for await (const file of filesBelow(directory)) {
			files.push(file);
		}
	} catch (failure) {
		if (failure.code !== 'ENOENT') {
			throw failure;
		}
	}
	return files;
}

function linesMatching(text, pattern) {
	return text.split(/\r?\n/).flatMap((line, index) => (pattern.test(line) ? [{ line: index + 1, text: line.trim() }] : []));
}

function isInAllowedDirectory(relativePath) {
	return relativePath.split(sep).some(segment => CONDITIONAL_ALLOWED_DIRECTORIES.has(segment));
}

function isBinary(text) {
	return text.includes('\u0000');
}

async function conditionalsOutsideAllowedDirectories(modDirectory) {
	const violations = [];
	for (const sourceRoot of SOURCE_ROOTS) {
		for (const file of await existingFilesBelow(join(modDirectory, sourceRoot))) {
			const relativePath = relative(modDirectory, file);
			if (isInAllowedDirectory(relativePath)) {
				continue;
			}
			const text = await readFile(file, 'utf8');
			if (isBinary(text)) {
				continue;
			}
			for (const hit of linesMatching(text, CONDITIONAL)) {
				violations.push({ rule: 'conditional outside compat/ and platform/', file: relativePath, ...hit });
			}
		}
	}
	return violations;
}

async function minecraftImportsInCore(modDirectory) {
	const violations = [];
	for (const file of await existingFilesBelow(join(modDirectory, 'core'))) {
		if (!file.endsWith('.java') || file.includes(`${sep}build${sep}`)) {
			continue;
		}
		const text = await readFile(file, 'utf8');
		for (const hit of linesMatching(text, MINECRAFT_IMPORT)) {
			violations.push({ rule: 'core/ imports a Minecraft or loader class', file: relative(modDirectory, file), ...hit });
		}
	}
	return violations;
}

export async function findViolations(modDirectory) {
	return [...(await conditionalsOutsideAllowedDirectories(modDirectory)), ...(await minecraftImportsInCore(modDirectory))];
}

function formatViolation({ rule, file, line, text }) {
	return `${file}:${line}: ${rule}\n    ${text}`;
}

async function main() {
	const modDirectory = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..');
	const violations = await findViolations(modDirectory);
	if (violations.length > 0) {
		console.error(violations.map(formatViolation).join('\n'));
		console.error(`\ncheck-conditionals: ${violations.length} violation(s)`);
		process.exit(1);
	}
	console.log('check-conditionals: ok');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}
