// Spezifikation von kit-demo.mjs: node mod/scripts/kit-demo.check.mjs
import assert from 'node:assert/strict';
import { parseProofLine } from './kit-demo.mjs';

const cases = [
	['reads the numbers of the proof line from a log line', () => {
		const line = '[12:00:01] [Render thread/INFO] (pumpkin_friends) pumpkin_friends kit demo rendered 3 frames at 427x240';
		assert.deepEqual(parseProofLine(line), { frames: 3, width: 427, height: 240 });
	}],
	['ignores every other line', () => assert.equal(parseProofLine('[Render thread/INFO] Setting user: Dev'), null)],
	['ignores a line that only mentions the kit demo', () => assert.equal(parseProofLine('pumpkin_friends kit demo failed to open'), null)],
];

let failed = 0;
for (const [name, body] of cases) {
	try {
		await body();
		console.log(`ok   ${name}`);
	} catch (failure) {
		failed++;
		console.error(`FAIL ${name}\n${failure.message}`);
	}
}
process.exit(failed === 0 ? 0 : 1);
