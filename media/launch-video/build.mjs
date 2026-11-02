// Assembles the two HyperFrames projects (yt = 16:9, tiktok = 9:16) from the
// shared film source, the launcher's branding and its font packages, so no
// asset is duplicated in git.
//
//   node build.mjs        (run `python audio/music.py` first for the soundtrack)
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const repo = (p) => here(`../../${p}`);

const brandMark = readFileSync(repo("branding/pumpkin-launcher/assets/mark.svg"), "utf8");

const ASSETS = {
  "fonts/jersey10.woff2": "node_modules/@fontsource/jersey-10/files/jersey-10-latin-400-normal.woff2",
  "fonts/bigshoulders800.woff2": "node_modules/@fontsource/big-shoulders-display/files/big-shoulders-display-latin-800-normal.woff2",
  "fonts/bigshoulders900.woff2": "node_modules/@fontsource/big-shoulders-display/files/big-shoulders-display-latin-900-normal.woff2",
  "fonts/hanken.woff2": "node_modules/@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2",
  "img/mark.svg": "branding/pumpkin-launcher/assets/mark.svg",
  "img/wordmark-light.svg": "branding/pumpkin-launcher/wordmark/light.svg",
};
const soundtrack = here("./audio/soundtrack.wav");
if (!existsSync(soundtrack)) {
  console.error("audio/soundtrack.wav is missing — run `python audio/music.py` first.");
  process.exit(1);
}

for (const target of ["yt", "tiktok"]) {
  const projectRoot = resolve(here(`./${target}/`));
  for (const dir of ["src", "assets"]) {
    const stagedPath = resolve(projectRoot, dir);
    if (!stagedPath.startsWith(projectRoot + sep)) throw new Error("Stage path outside the composition");
    rmSync(stagedPath, { recursive: true, force: true });
  }
  cpSync(here("./src"), here(`./${target}/src`), { recursive: true });
  writeFileSync(here(`./${target}/src/brand-mark.js`), "window.BRAND_MARK = " + JSON.stringify(brandMark) + ";\n");
  for (const [dest, src] of Object.entries(ASSETS)) {
    const out = here(`./${target}/assets/${dest}`);
    mkdirSync(dirname(out), { recursive: true });
    cpSync(repo(src), out);
  }
  cpSync(soundtrack, here(`./${target}/assets/soundtrack.wav`));
}
console.log("built yt/ and tiktok/ from src/, branding/ and node_modules/");
