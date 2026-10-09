import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isIconName } from "../src/pixel/icon-data.ts";
import { detectDesktopOs } from "./download.js";

// Resources stay local; external navigation is limited to the repository and official installation help.
const REPO_URL = "https://github.com/jonax1337/pumpkin-launcher";
const LEGAL_ROUTES = ["privacy/", "legal-notice/"];
const LEGAL_PAGES = LEGAL_ROUTES.map((route) => `${route}index.html`);
const RELEASES_URL = `${REPO_URL}/releases`;
const INSTALL_GUIDE_URL = `${REPO_URL}/blob/main/README.md#download-and-install`;
const SUPPORT_URLS = new Set([
  "https://developer.microsoft.com/en-us/microsoft-edge/webview2/#download-section",
  "https://support.apple.com/en-us/102445",
  "https://v2.tauri.app/start/prerequisites/#linux",
]);
// Fixed asset names, created by the stable-names job of .github/workflows/release.yml (CONTRIBUTING.md#release-packaging).
const DOWNLOAD_BASE = `${RELEASES_URL}/latest/download/`;
const STABLE_ASSETS = ["Pumpkin.Launcher_x64-setup.exe", "Pumpkin.Launcher_universal.dmg", "Pumpkin.Launcher_amd64.AppImage", "Pumpkin.Launcher_amd64.deb"];
// The links only work if the release workflow really creates these names: compare both sides, so they cannot drift apart.
const releaseWorkflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const copiedNames = [...releaseWorkflow.matchAll(/copy_as '[^']+' ([A-Za-z0-9._-]+)/g)].map((match) => match[1]);
assert.deepEqual([...STABLE_ASSETS].sort(), copiedNames.sort(), "Website download names must equal the stable-names job in release.yml");
const isRepoLink = (url) => url === REPO_URL || url.startsWith(`${REPO_URL}/`);
const root = new URL("./", import.meta.url);
const source = readFileSync(new URL("index.html", root), "utf8");
const output = new URL("dist/", root);
const pageUrls = new Set(["./", ...LEGAL_ROUTES].map((route) => new URL(route, output).href));
const assetRoot = new URL("assets/", output).href;
assert.ok(existsSync(new URL("index.html", output)), "Run pnpm build:website first");
const html = readFileSync(new URL("index.html", output), "utf8");
const legalHtml = Object.fromEntries(LEGAL_PAGES.map((page) => {
  assert.ok(existsSync(new URL(page, output)), `Missing built page: ${page}`);
  return [page, readFileSync(new URL(page, output), "utf8")];
}));
const files = readdirSync(new URL("assets/", output));

// Catch broken build paths, invented icons and missing original branding assets.
for (const [, name] of source.matchAll(/data-icon="([^"]+)"/g)) assert.ok(isIconName(name), `Unknown launcher icon: ${name}`);
for (const [name, page] of Object.entries({ "index.html": html, ...legalHtml })) {
  const pageUrl = new URL(name, output);
  assert.match(page, /<html\b[^>]*\blang="en"/, "Pages must declare English as their language");
  assert.ok(!/(?:src|srcset|poster)="(?:https?:)?\/\//.test(page), "No external images, scripts or media");
  for (const [, tag, attributes] of page.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/g)) {
    for (const [, attribute, url] of attributes.matchAll(/\b(src|href|data|poster)="([^"]+)"/g)) {
      if (tag === "a" && attribute === "href" && (isRepoLink(url) || SUPPORT_URLS.has(url))) continue;
      if (url.startsWith("#")) {
        if (url.length > 1) assert.ok(page.includes(`id="${url.slice(1)}"`), `Missing anchor: ${url}`);
      } else if (url.startsWith("mailto:")) {
        assert.match(url, /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/, `Malformed mail link: ${url}`);
      } else {
        assert.match(url, /^(?:\.\/|\.\.\/)/, `Non-portable or external URL: ${url}`);
        const target = new URL(url, pageUrl);
        assert.ok(pageUrls.has(target.href) || target.href.startsWith(assetRoot), `Unexpected local URL: ${url}`);
        const targetFile = target.pathname.endsWith("/") ? new URL("index.html", target) : target;
        assert.ok(existsSync(targetFile), `Missing bundled page or asset in ${name}: ${url}`);
      }
    }
  }
}
for (const season of ["standard", "spring", "summer", "halloween", "winter"]) {
  const original = readFileSync(new URL(`../branding/pumpkin-launcher/assets/${season}/mark.svg`, root));
  const staged = readFileSync(new URL(`assets/brand/${season}/mark.svg`, root));
  assert.deepEqual(staged, original, `${season} must preserve the approved asset`);
}
assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
assert.equal(files.filter((name) => name.startsWith("world-")).length, 4);
assert.ok(!/url\(["']?(?:https?:)?\/\//.test(readBuiltStyles()), "No external fonts or images in CSS");
checkDownloadSection(html);
checkOsDetection();
for (const route of LEGAL_ROUTES) {
  const page = `${route}index.html`;
  assert.ok(html.includes(`href="./${route}"`), `Footer must link to ${route}`);
  assert.equal((legalHtml[page].match(/<h1\b/g) ?? []).length, 1, `${page} needs exactly one h1`);
  for (const target of LEGAL_ROUTES) {
    assert.ok(legalHtml[page].includes(`href="../${target}"`), `${page} must link to ${target}`);
  }
}
const openPlaceholders = [...new Set(Object.values(legalHtml).flatMap((page) => page.match(/\[(?:NAME|ANSCHRIFT|E-MAIL)\]/g) ?? []))];
if (openPlaceholders.length) console.warn(`Legal pages still contain placeholders ${openPlaceholders.join(" ")}; fill them before publishing.`);
console.log(`Website OK: English page language, local links, 5 original marks, 4 app landscapes, icons, download links and legal pages verified in ${fileURLToPath(output)}`);

function checkDownloadSection(page) {
  const section = page.match(/<section\b[^>]*\bid="download"[^>]*>[\s\S]*?<\/section>/)?.[0];
  assert.ok(section, "Missing download section");
  const links = [...section.matchAll(/href="(https?:[^"]+)"/g)].map(([, url]) => url);
  const downloads = links.filter((url) => url.startsWith(DOWNLOAD_BASE));
  assert.deepEqual([...new Set(downloads)].sort(), STABLE_ASSETS.map((name) => DOWNLOAD_BASE + name).sort(), "Download links must be exactly the stable release asset names");
  for (const url of links.filter((link) => !downloads.includes(link))) assert.ok(url === RELEASES_URL || url === REPO_URL || url === INSTALL_GUIDE_URL, `Unexpected link in download section: ${url}`);
  assert.ok(links.includes(RELEASES_URL), "Download section must link the releases page as fallback");
  const platforms = [...section.matchAll(/data-platform="([^"]+)"/g)].map(([, platform]) => platform);
  assert.deepEqual(platforms.sort(), ["linux", "macos", "windows"], "Downloads must support all three desktop platforms");
  assert.ok(!/<script|<iframe|<link|<form/.test(section), "Download section must not load or submit anything");
  assert.ok(/<nav\b[^>]*>(?:(?!<\/nav>)[\s\S])*href="#download"/.test(page), "Navigation must link to the download section");
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
