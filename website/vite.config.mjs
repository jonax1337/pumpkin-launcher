import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { copyFileSync, mkdirSync } from "node:fs";

// Stage only the approved web SVGs. Keep ZIPs, generators and native icons out of the site.
const branding = new URL("../branding/pumpkin-launcher/", import.meta.url);
const assets = new URL("./assets/brand/", import.meta.url);
for (const season of ["standard", "spring", "summer", "halloween", "winter"]) {
  const target = new URL(`${season}/`, assets);
  mkdirSync(target, { recursive: true });
  copyFileSync(new URL(`assets/${season}/mark.svg`, branding), new URL("mark.svg", target));
}
copyFileSync(new URL("web/favicon.svg", branding), new URL("favicon.svg", assets));

const page = (name) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  publicDir: false,
  server: { host: "127.0.0.1", port: 1430, strictPort: true },
  preview: { host: "127.0.0.1", port: 1431, strictPort: true },
  build: {
    outDir: "dist",
    assetsInlineLimit: 0,
    rollupOptions: { input: { index: page("index.html"), datenschutz: page("datenschutz.html"), impressum: page("impressum.html") } },
  },
});
