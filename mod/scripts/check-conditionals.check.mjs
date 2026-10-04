// Spezifikation von check-conditionals.mjs an kleinen Beispielbäumen: node mod/scripts/check-conditionals.check.mjs
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { findViolations } from './check-conditionals.mjs';

const JAVA_WITH_CONDITIONAL = '//? if >=1.21 {\nclass A {}\n//?}\n';
const JAVA_WITH_SWAP = 'class A { String v = "x"; //$ minecraft\n}\n';

async function violationsOf(files) {
	const root = await mkdtemp(join(tmpdir(), 'check-conditionals-'));
	try {
		for (const [path, content] of Object.entries(files)) {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), content);
		}
		return await findViolations(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

const cases = [
	['allows conditionals in compat/', async () => {
		assert.deepEqual(await violationsOf({ 'src/main/java/x/compat/A.java': JAVA_WITH_CONDITIONAL }), []);
	}],
	['allows conditionals in platform/', async () => {
		assert.deepEqual(await violationsOf({ 'src/main/java/x/platform/fabric/A.java': JAVA_WITH_CONDITIONAL }), []);
	}],
	['rejects a conditional in ui/', async () => {
		const violations = await violationsOf({ 'src/main/java/x/ui/Screen.java': JAVA_WITH_CONDITIONAL });
		assert.equal(violations.length, 2);
		assert.match(violations[0].file, /ui[\\/]Screen\.java$/);
		assert.equal(violations[0].line, 1);
	}],
	['rejects a swap in core/', async () => {
		const violations = await violationsOf({ 'core/src/main/java/x/A.java': JAVA_WITH_SWAP });
		assert.equal(violations.length, 1);
		assert.match(violations[0].rule, /conditional/);
	}],
	['ignores a URL that looks like a conditional', async () => {
		assert.deepEqual(await violationsOf({ 'src/main/java/x/ui/A.java': 'String u = "https://?x";\n' }), []);
	}],
	['rejects a Minecraft import in core/', async () => {
		const violations = await violationsOf({ 'core/src/main/java/x/A.java': 'import net.minecraft.client.Minecraft;\n' });
		assert.equal(violations.length, 1);
		assert.match(violations[0].rule, /core\//);
	}],
	['rejects a loader import in core/ tests', async () => {
		const violations = await violationsOf({ 'core/src/test/java/x/ATest.java': 'import static net.neoforged.fml.A.b;\n' });
		assert.equal(violations.length, 1);
	}],
	['allows Minecraft imports outside core/', async () => {
		assert.deepEqual(await violationsOf({ 'src/main/java/x/ui/A.java': 'import net.minecraft.client.Minecraft;\n' }), []);
	}],
	['accepts a tree without sources', async () => {
		assert.deepEqual(await violationsOf({}), []);
	}],
];

for (const [name, run] of cases) {
	await run();
	console.log(`ok - ${name}`);
}
