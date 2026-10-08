// Reuse the branding pipeline's SVG renderer and approved outlined wordmark.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
let sharp;
try { sharp = require('sharp'); }
catch { sharp = require(process.env.PUMPKIN_SHARP_PATH || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp')); }

const source = fs.readFileSync(path.join(__dirname, '../wordmark/light.svg'));
sharp(source).png().toBuffer()
  .then(png => process.stdout.write(png.toString('base64')))
  .catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
