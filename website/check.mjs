import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ICON_DATA } from "../src/pixel/icon-data.ts";
import { detectDesktopOs } from "./download.js";

// Einziger externer Verweis: das öffentliche Repository (Quellcode, Releases). Es werden keine Ressourcen von außen geladen.
const REPO_URL = "https://github.com/jonax1337/pumpkin-launcher";
const LEGAL_PAGES = ["datenschutz.html", "impressum.html"];
const RELEASES_URL = `${REPO_URL}/releases`;
// Fixed asset names, created by the stable-names job of .github/workflows/release.yml (CONTRIBUTING.md#release-packaging).
const DOWNLOAD_BASE = `${RELEASES_URL}/latest/download/`;
const STABLE_ASSETS = ["Pumpkin.Launcher_x64-setup.exe", "Pumpkin.Launcher_universal.dmg", "Pumpkin.Launcher_amd64.AppImage", "Pumpkin.Launcher_amd64.deb", "SHA256SUMS"];
// The links only work if the release workflow really creates these names: compare both sides, so they cannot drift apart.
const releaseWorkflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const copiedNames = [...releaseWorkflow.matchAll(/copy_as '[^']+' ([A-Za-z0-9._-]+)/g)].map((match) => match[1]);
assert.deepEqual(STABLE_ASSETS.filter((name) => name !== "SHA256SUMS").sort(), copiedNames.sort(), "Website download names must equal the stable-names job in release.yml");
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
assert.equal((source.match(/<img\b[^>]*\bdata-seasonal\b/g) ?? []).length, 6, "All six primary mascots must follow the season");
assert.match(source, /<link data-seasonal rel="icon"/, "Favicon must follow the season");
assert.equal(files.filter((name) => name.startsWith("launcher-")).length, 4);
assert.equal(files.filter((name) => name.startsWith("world-")).length, 4);
assert.equal(files.filter((name) => name.startsWith("trailer")).length, 2, "Trailer video and poster must be bundled");
checkDownloadSection(html);
checkOsDetection();
for (const page of LEGAL_PAGES) {
  assert.ok(html.includes(`href="./${page}"`), `Footer must link to ${page}`);
  assert.equal((legalHtml[page].match(/<h1\b/g) ?? []).length, 1, `${page} needs exactly one h1`);
  assert.match(legalHtml[page], /<html lang="de">/);
  assert.ok(legalHtml[page].includes('href="./datenschutz.html"') && legalHtml[page].includes('href="./impressum.html"'), `${page} must link both legal pages`);
}
const openPlaceholders = [...new Set(Object.values(legalHtml).flatMap((page) => page.match(/\[(?:NAME|ANSCHRIFT|E-MAIL)\]/g) ?? []))];
if (openPlaceholders.length) console.warn(`Hinweis: Impressum und Datenschutz enthalten noch Platzhalter ${openPlaceholders.join(" ")}; vor der Veröffentlichung ausfüllen.`);
assert.ok(!source.includes("data-mood"), "The marketing site must not include the removed Buddy playground");
console.log(`Website OK: local links, 5 original marks, 4 app landscapes, icons, 4 screenshots, trailer, download links and legal pages verified in ${fileURLToPath(output)}`);

function checkDownloadSection(page) {
  const section = page.match(/<section class="download[^>]*id="download"[\s\S]*?<\/section>/)?.[0];
  assert.ok(section, "Missing download section");
  const links = [...section.matchAll(/href="(https?:[^"]+)"/g)].map(([, url]) => url);
  const downloads = links.filter((url) => url.startsWith(DOWNLOAD_BASE));
  assert.deepEqual([...new Set(downloads)].sort(), STABLE_ASSETS.map((name) => DOWNLOAD_BASE + name).sort(), "Download links must be exactly the stable release asset names");
  for (const url of links.filter((link) => !downloads.includes(link))) assert.ok(url === RELEASES_URL || url === REPO_URL, `Unexpected link in download section: ${url}`);
  assert.ok(links.includes(RELEASES_URL), "Download section must link the releases page as fallback");
  assert.equal((section.match(/data-platform="/g) ?? []).length, 3, "Windows, macOS and Linux cards");
  assert.equal((section.match(/<details class="platform-notes"/g) ?? []).length, 3, "One collapsible note per OS");
  assert.ok(section.includes("gh attestation verify &lt;datei&gt; --repo jonax1337/pumpkin-launcher"), "Verification command");
  assert.ok(!/<script|<iframe|<link|<form/.test(section), "Download section must not load or submit anything");
  assert.ok(!/(?:src|srcset|poster)="https?:/.test(page), "No external images, scripts or media");
  assert.ok(!/url\(["']?https?:/.test(readBuiltStyles()), "No external fonts or images in CSS");
  assert.ok(/<nav aria-label="Hauptnavigation">[^]*?href="#download"/.test(page), "Header navigation links to the download section");
  assert.ok(!page.includes("Der Download liegt auf GitHub"), "Outro must point to the download section");
}

function readBuiltStyles() {
  return files.filter((name) => name.endsWith(".css")).map((name) => readFileSync(new URL(`assets/${name}`, output), "utf8")).join("\n");
}

function checkOsDetection() {
  const desktop = (platform, userAgent = "") => detectDesktopOs({ platform, userAgent });
  assert.equal(desktop("Windows"), "windows");
  assert.equal(desktop("macOS"), "macos");
  assert.equal(desktop("Linux"), "linux");
  assert.equal(desktop("", "Mozilla/5.0 (X11; Linux x86_64) Firefox/150.0"), "linux");
  assert.equal(desktop("", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15"), "macos");
  assert.equal(desktop("", "Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari/537.36"), null, "Android is not a Linux desktop");
  assert.equal(desktop("", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148"), null);
  assert.equal(detectDesktopOs({ platform: "macOS", maxTouchPoints: 5 }), null, "iPadOS reports a Mac with a touch screen");
  assert.equal(detectDesktopOs({ platform: "Windows", mobile: true }), null);
  assert.equal(desktop("", "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) Chrome/150"), null);
  assert.equal(desktop(""), null);
}
