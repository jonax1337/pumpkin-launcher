// Kit-Demo-Lauf (docs/friends/INGAME.md 11.2, Paket U1): startet den Entwicklungs-Client eines Fabric-Knotens mit -Pkitdemo,
// wartet auf die Beweiszeile des Widget-Kit-Demo-Bildschirms und beendet den Client wieder.
//
// Aufruf aus beliebigem Ordner:
//   node mod/scripts/kit-demo.mjs --node <id> [--timeout <Sekunden>]
//     --timeout   harte Grenze für den ganzen Lauf, Standard 180
// Gradle läuft auf dem JDK aus PUMPKIN_JDK_<gradleJdk> des Knotens, falls gesetzt (siehe README, scripts/dev-env.*).
// Beendet nur den eigenen Prozessbaum. Exit-Code 0 mit der Beweiszeile, 1 ohne (Zeitgrenze, Absturz), 2 bei falschem Aufruf.
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseNodes } from './compile-matrix.mjs';

const PROOF_LINE = /pumpkin_bridge kit demo rendered (\d+) frames at (\d+)x(\d+)/;
const DEFAULT_TIMEOUT_SECONDS = 180;

/** The numbers of the proof line, or null for any other line. */
export function parseProofLine(line) {
	const match = PROOF_LINE.exec(line);
	return match ? { frames: Number(match[1]), width: Number(match[2]), height: Number(match[3]) } : null;
}

function parseArguments(argv) {
	const options = { nodeId: null, timeoutSeconds: DEFAULT_TIMEOUT_SECONDS };
	for (let index = 0; index < argv.length; index++) {
		if (argv[index] === '--node') {
			options.nodeId = argv[++index];
		} else if (argv[index] === '--timeout') {
			options.timeoutSeconds = Number(argv[++index]);
		} else {
			throw new Error(`Unbekannte Option: ${argv[index]}`);
		}
	}
	if (!options.nodeId || !(options.timeoutSeconds > 0)) {
		throw new Error('Aufruf: node mod/scripts/kit-demo.mjs --node <id> [--timeout <Sekunden>]');
	}
	return options;
}

function killTree(child) {
	if (process.platform === 'win32') {
		spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
	} else {
		process.kill(-child.pid, 'SIGTERM');
	}
}

function startClient(modDirectory, node) {
	const gradlew = process.platform === 'win32' ? `"${join(modDirectory, 'gradlew.bat')}"` : './gradlew';
	const jdkHome = process.env[`PUMPKIN_JDK_${node.gradleJdk}`];
	const env = jdkHome ? { ...process.env, JAVA_HOME: jdkHome } : process.env;
	// --no-daemon: the game then lives below this process, and killing the tree ends it. A shared Gradle daemon would keep it.
	return spawn(gradlew, ['--no-daemon', `-Pnode=${node.id}`, '-Pkitdemo', 'runClient'], {
		cwd: modDirectory,
		env,
		shell: process.platform === 'win32',
		detached: process.platform !== 'win32',
	});
}

/** Resolves with the proof line's numbers, or with null when the client ends or the time runs out first. */
function waitForProof(child, timeoutSeconds) {
	return new Promise(resolve => {
		const timer = setTimeout(() => resolve(null), timeoutSeconds * 1000);
		child.on('exit', () => resolve(null));
		const lines = createInterface({ input: child.stdout });
		lines.on('line', line => {
			console.log(line);
			const proof = parseProofLine(line);
			if (proof) {
				clearTimeout(timer);
				resolve(proof);
			}
		});
		child.stderr.pipe(process.stderr);
	});
}

async function main() {
	const modDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');
	const options = parseArguments(process.argv.slice(2));
	const node = parseNodes(await readFile(join(modDirectory, 'nodes.txt'), 'utf8')).find(candidate => candidate.id === options.nodeId);
	if (!node || node.loader !== 'fabric') {
		throw new Error(`Der Kit-Demo-Lauf gibt es nur für Fabric-Knoten aus nodes.txt, nicht für: ${options.nodeId}`);
	}
	const child = startClient(modDirectory, node);
	const proof = await waitForProof(child, options.timeoutSeconds);
	killTree(child);
	if (proof) {
		console.log(`\nkit-demo: ${node.id}: ${proof.frames} frames at ${proof.width}x${proof.height}`);
		process.exit(0);
	}
	console.error(`\nkit-demo: ${node.id}: keine Beweiszeile innerhalb von ${options.timeoutSeconds} s`);
	process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		await main();
	} catch (failure) {
		console.error(failure.message);
		process.exit(2);
	}
}
