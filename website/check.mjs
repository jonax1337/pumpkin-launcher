import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ICON_DATA } from "../src/pixel/icon-data.ts";

// Einziger externer Verweis: das öffentliche Repository (Quellcode, Releases). Es werden keine Ressourcen von außen geladen.
const REPO_URL = "https://github.com/jonax1337/pumpkin-launcher";
const LEGAL_PAGES = ["datenschutz.html", "impressum.html"];
const isRepoLink = (url) => url === REPO_URL || url.startsWith(`${REPO_URL}/`);
const isPageLink = (url) => url === "./" || LEGAL_PAGES.some((page) => url === `./${page}`);
const root = new URL("./", import.meta.url);
const source = readFileSync(new URL("index.html", root), "utf8");
const output = new URL("dist/", root);
assert.ok(existsSync(new URL("index.html", output)), "Run pnpm build:website first");
const html = readFileSync(new URL("index.html", output), "utf8");
const legalHtml = Object.fromEntries(LEGAL_PAGES.map((page) => {
  assert.ok(existsSync(new URL(page, output)), `Missing built page: ${page}`);
  return [page, readFileSync(new URL(page, output), "utf8")];
}));
const files = readdirSync(new URL("assets/", output));

// Catch broken build paths, invented icons and missing original branding assets.
for (const [, name] of source.matchAll(/data-icon="([^"]+)"/g)) assert.ok(ICON_DATA[name], `Unknown launcher icon: ${name}`);
for (const page of [html, ...Object.values(legalHtml)]) {
  for (const [, url] of page.matchAll(/(?:src|href|data|poster)="([^"]+)"/g)) {
    if (url.startsWith("#")) {
      if (url.length > 1) assert.ok(page.includes(`id="${url.slice(1)}"`), `Missing anchor: ${url}`);
    } else if (url.startsWith("mailto:")) {
      assert.match(url, /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/, `Malformed mail link: ${url}`);
    } else if (!isRepoLink(url)) {
      assert.ok(isPageLink(url) || url.startsWith("./assets/"), `Non-portable or external URL: ${url}`);
      assert.ok(existsSync(new URL(url, output)), `Missing bundled asset: ${url}`);
    }
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
for (const page of LEGAL_PAGES) {
  assert.ok(html.includes(`href="./${page}"`), `Footer must link to ${page}`);
  assert.equal((legalHtml[page].match(/<h1\b/g) ?? []).length, 1, `${page} needs exactly one h1`);
  assert.match(legalHtml[page], /<html lang="de">/);
  assert.ok(legalHtml[page].includes('href="./datenschutz.html"') && legalHtml[page].includes('href="./impressum.html"'), `${page} must link both legal pages`);
}
const openPlaceholders = [...new Set(Object.values(legalHtml).flatMap((page) => page.match(/\[(?:NAME|ANSCHRIFT|E-MAIL)\]/g) ?? []))];
if (openPlaceholders.length) console.warn(`Hinweis: Impressum und Datenschutz enthalten noch Platzhalter ${openPlaceholders.join(" ")}; vor der Veröffentlichung ausfüllen.`);
assert.ok(!source.includes("data-mood"), "The marketing site must not include the removed Buddy playground");
console.log(`Website OK: local links, 5 original marks, 4 app landscapes, icons, 4 screenshots and trailer and legal pages verified in ${fileURLToPath(output)}`);
