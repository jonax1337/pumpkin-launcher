// Render the same approved SVG at each native system size. No alternate drawing.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
let sharp;
try { sharp = require('sharp'); }
catch { sharp = require(process.env.PUMPKIN_SHARP_PATH || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp')); }
const root = path.resolve(__dirname, '..');
const { variants } = JSON.parse(fs.readFileSync(path.join(__dirname, 'seasons.json'), 'utf8'));
(async () => {
  const output = {};
  for (const variant of variants) {
    const svg = fs.readFileSync(path.join(root, 'assets', variant.id, 'mark.svg'));
    output[variant.id] = {};
    for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
      const png = await sharp(svg, { density: 72 * size / 32 }).png().toBuffer();
      output[variant.id][size] = png.toString('base64');
    }
  }
  process.stdout.write(JSON.stringify(output));
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
