import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ICON_DATA } from "../src/pixel/icon-data.ts";

// Einziger externer Verweis: der öffentliche Quellcode. Es werden keine Ressourcen von außen geladen.
const REPO_URL = "https://github.com/jonax1337/pumpkin-launcher";
const root = new URL("./", import.meta.url);
const source = readFileSync(new URL("index.html", root), "utf8");
const output = new URL("dist/", root);
assert.ok(existsSync(new URL("index.html", output)), "Run pnpm build:website first");
const html = readFileSync(new URL("index.html", output), "utf8");
const files = readdirSync(new URL("assets/", output));

// Catch broken build paths, invented icons and missing original branding assets.
for (const [, name] of source.matchAll(/data-icon="([^"]+)"/g)) assert.ok(ICON_DATA[name], `Unknown launcher icon: ${name}`);
for (const [, url] of html.matchAll(/(?:src|href|data|poster)="([^"]+)"/g)) {
  if (url.startsWith("#")) {
    if (url.length > 1) assert.ok(html.includes(`id="${url.slice(1)}"`), `Missing anchor: ${url}`);
  } else {
    if (url === REPO_URL) continue;
    assert.ok(url.startsWith("./assets/"), `Non-portable or external URL: ${url}`);
    assert.ok(existsSync(new URL(url, output)), `Missing bundled asset: ${url}`);
  }
}
for (const season of ["standard", "spring", "summer", "halloween", "winter"]) {
  const original = readFileSync(new URL(`../branding/pumpkin-launcher/assets/${season}/mark.svg`, root));
  const staged = readFileSync(new URL(`assets/brand/${season}/mark.svg`, root));
  assert.deepEqual(staged, original, `${season} must preserve the approved asset`);
  assert.ok(source.includes(`./assets/brand/${season}/mark.svg`));
}
assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
assert.match(html, /<html lang="de">/);
assert.match(html, /Pumpkin Launcher/);
assert.equal((source.match(/<img\b[^>]*\bdata-seasonal\b/g) ?? []).length, 5, "All five primary mascots must follow the season");
assert.match(source, /<link data-seasonal rel="icon"/, "Favicon must follow the season");
assert.equal(files.filter((name) => name.startsWith("launcher-")).length, 4);
assert.equal(files.filter((name) => name.startsWith("world-")).length, 4);
assert.equal(files.filter((name) => name.startsWith("trailer")).length, 2, "Trailer video and poster must be bundled");
assert.ok(!source.includes("data-mood"), "The marketing site must not include the removed Buddy playground");
console.log(`Website OK: local links, 5 original marks, 4 app landscapes, icons, 4 screenshots and trailer verified in ${fileURLToPath(output)}`);
