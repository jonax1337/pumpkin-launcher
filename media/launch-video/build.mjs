// Assembles the two HyperFrames projects (yt = 16:9, tiktok = 9:16) from the
// shared film source, the launcher's branding and its font packages, so no
// asset is duplicated in git.
//
//   node build.mjs        (run `python audio/music.py` first for the soundtrack)
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const repo = (p) => here(`../../${p}`);

// Buddy's pose ladders, pulled out of the brand's SMIL SVGs so the film can
// switch poses from timeline time instead of wall-clock SMIL.
const motionDir = repo("branding/pumpkin-launcher/motion/standard/");
const poses = {};
for (const name of ["hello", "success", "idle", "sleep", "loading", "oops"]) {
  const svg = readFileSync(motionDir + name + ".svg", "utf8");
  const dur = Number(svg.match(/data-duration-ms="(\d+)"/)[1]) / 1000;
  const shapes = {};
  for (const m of svg.matchAll(/<g id="standard-[a-z]+-pose-(\d+)">(.*?)<\/g>/g)) shapes[m[1]] = m[2];
  const frames = [];
  for (const m of svg.matchAll(/<g data-frame="\d+" visibility="hidden"><use href="#standard-[a-z]+-pose-(\d+)"\/><animate [^>]*values="([^"]+)" keyTimes="([^"]+)"/g)) {
    const vals = m[2].split(";"), kt = m[3].split(";").map(Number);
    const i = vals.indexOf("visible");
    frames.push({ pose: m[1], a: kt[i] * dur, b: kt[i + 1] * dur });
  }
  poses[name] = { dur, poses: shapes, frames };
}

const ASSETS = {
  "fonts/jersey10.woff2": "node_modules/@fontsource/jersey-10/files/jersey-10-latin-400-normal.woff2",
  "fonts/bigshoulders800.woff2": "node_modules/@fontsource/big-shoulders-display/files/big-shoulders-display-latin-800-normal.woff2",
  "fonts/bigshoulders900.woff2": "node_modules/@fontsource/big-shoulders-display/files/big-shoulders-display-latin-900-normal.woff2",
  "fonts/hanken.woff2": "node_modules/@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2",
  "img/mark.svg": "branding/pumpkin-launcher/assets/standard/mark.svg",
  "img/wordmark-light.svg": "branding/pumpkin-launcher/wordmark/light.svg",
};
const soundtrack = here("./audio/soundtrack.wav");
if (!existsSync(soundtrack)) {
  console.error("audio/soundtrack.wav is missing — run `python audio/music.py` first.");
  process.exit(1);
}

for (const target of ["yt", "tiktok"]) {
  for (const dir of ["src", "assets"]) rmSync(here(`./${target}/${dir}`), { recursive: true, force: true });
  cpSync(here("./src"), here(`./${target}/src`), { recursive: true });
  writeFileSync(here(`./${target}/src/buddy-poses.js`), "window.BUDDY = " + JSON.stringify(poses) + ";\n");
  for (const [dest, src] of Object.entries(ASSETS)) {
    const out = here(`./${target}/assets/${dest}`);
    mkdirSync(dirname(out), { recursive: true });
    cpSync(repo(src), out);
  }
  cpSync(soundtrack, here(`./${target}/assets/soundtrack.wav`));
}
console.log("built yt/ and tiktok/ from src/, branding/ and node_modules/");
