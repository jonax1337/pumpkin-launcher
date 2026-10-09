// Baut launcher.html: Gerüst (shell.html) + Symbol-Sprite (icons/set-*.mjs) + Bildschirme (screens/*.html, *.css).
// Aufruf: node build.mjs   (aus docs/design/concepts/launcher/)
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const here = (p) => resolve(import.meta.dirname, p);
const ORDER = ["home", "library", "discover", "instance", "skins", "friends", "news", "settings", "overlays"];

const icons = {};
for (const f of readdirSync(here("icons")).filter((n) => /^set-.*\.mjs$/.test(n))) Object.assign(icons, (await import(pathToFileURL(here(`icons/${f}`)).href)).ICONS);
const path = (rows, ch) => rows.flatMap((r, y) => [...r].flatMap((c, x) => (c === ch ? [`M${x} ${y}h1v1h-1z`] : []))).join("");
const sprite = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">${Object.entries(icons)
  .map(([n, rows]) => `<symbol id="i-${n}" viewBox="0 0 8 8"><path d="${path(rows, "X")}"/>${path(rows, "o") ? `<path d="${path(rows, "o")}" opacity=".5"/>` : ""}</symbol>`).join("")}</svg>`;

// Platzhalter für noch fehlende Symbole (Kästchen), damit das Layout trotzdem prüfbar ist
const PLACEHOLDER = ["XXXXXXXX","X......X","X.XXXX.X","X.X..X.X","X.X..X.X","X.XXXX.X","X......X","XXXXXXXX"];
const outName = (process.argv.find((a) => a.startsWith("--out=")) || "--out=launcher.html").slice(6);
const screens = ORDER.filter((n) => existsSync(here(`screens/${n}.html`)));
const css = ORDER.filter((n) => existsSync(here(`screens/${n}.css`))).map((n) => `<link rel="stylesheet" href="screens/${n}.css">`).join("\n");
const body = screens.filter((n) => n !== "overlays").map((n) => readFileSync(here(`screens/${n}.html`), "utf8")).join("\n");
const overlays = existsSync(here("screens/overlays.html")) ? readFileSync(here("screens/overlays.html"), "utf8") : "";

let out = readFileSync(here("shell.html"), "utf8")
  .replace("<!--SPRITE-->", sprite).replace("<!--SCREEN_CSS-->", css).replace("<!--SCREENS-->", body).replace("<!--OVERLAYS-->", overlays);

// Verwendete, aber fehlende Symbole melden
const used = new Set([...out.matchAll(/href="#i-([\w-]+)"/g)].map((m) => m[1]));
const missing = [...used].filter((n) => !icons[n]);
if (missing.length) out = out.replace("</svg>", missing.map((n) => `<symbol id="i-${n}" viewBox="0 0 8 8"><path d="${path(PLACEHOLDER, "X")}" opacity=".5"/></symbol>`).join("") + "</svg>");
writeFileSync(here(outName), out);
console.log(`${outName}: ${screens.length} Bildschirme, ${Object.keys(icons).length} Symbole${missing.length ? `, FEHLENDE SYMBOLE: ${missing.join(", ")}` : ""}`);
