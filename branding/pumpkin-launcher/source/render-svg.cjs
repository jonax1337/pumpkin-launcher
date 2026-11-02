// Render complete logical grid cells and scale only with nearest-neighbor.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
let sharp;
try { sharp = require('sharp'); }
catch { sharp = require(process.env.PUMPKIN_SHARP_PATH || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp')); }
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/mark.svg'));
(async () => {
  const output = { frames: {}, wordmarks: {} };
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
    output.frames[size] = (await sharp(source).resize(size, size, { kernel: 'nearest' }).png().toBuffer()).toString('base64');
  }
  for (const name of ['light', 'dark']) {
    output.wordmarks[name] = (await sharp(fs.readFileSync(path.join(root, 'wordmark', name + '.svg'))).png().toBuffer()).toString('base64');
  }
  process.stdout.write(JSON.stringify(output));
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
