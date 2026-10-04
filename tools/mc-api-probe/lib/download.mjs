// Laedt Dateien einmalig in den Cache und prueft optional die SHA-1-Summe (Mojang liefert SHA-1).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function sha1Of(buffer) {
  return createHash("sha1").update(buffer).digest("hex");
}

function assertSha1(buffer, expected, label) {
  if (expected && sha1Of(buffer) !== expected) throw new Error(`SHA-1 von ${label} stimmt nicht`);
}

/** Holt `url` nach `destination`, falls dort noch nichts liegt. Liefert den Zielpfad. */
export async function ensureDownloaded(url, destination, expectedSha1 = null) {
  if (existsSync(destination)) {
    assertSha1(readFileSync(destination), expectedSha1, destination);
    return destination;
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download fehlgeschlagen (${response.status}): ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  assertSha1(buffer, expectedSha1, url);
  mkdirSync(dirname(destination), { recursive: true });
  const partial = `${destination}.part`;
  writeFileSync(partial, buffer);
  renameSync(partial, destination);
  return destination;
}

export async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Abruf fehlgeschlagen (${response.status}): ${url}`);
  return response.json();
}
