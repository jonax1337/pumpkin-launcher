// Keeps the Worker's pinned Mojang player-certificate keys (src/mojang-keys.js) equal to Mojang's live list.
// Runs from a normal network, never from the Worker (Mojang blocks Cloudflare). Node 24, built-ins only.
//   node scripts/mojang-keys.mjs check    exit 0 "ok: N keys match", 1 with a diff, 2 when the fetch fails
//   node scripts/mojang-keys.mjs update   rewrites src/mojang-keys.js and test/mojang-publickeys.json
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PLAYER_CERTIFICATE_KEYS } from "../src/mojang-keys.js";

const PUBLIC_KEYS_URL = "https://api.minecraftservices.com/publickeys";
const MODULE = new URL("../src/mojang-keys.js", import.meta.url);
const SNAPSHOT = new URL("../test/mojang-publickeys.json", import.meta.url);
const FETCH_TIMEOUT_MS = 15_000;
const EXIT_OK = 0;
const EXIT_DIFFERENT = 1;
const EXIT_UNAVAILABLE = 2;
const EXIT_USAGE = 64;

export const fingerprint = (base64) => createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex");

/** The `playerCertificateKeys` of a `/publickeys` response, in Mojang's order. */
export const certificateKeysOf = (publicKeys) => publicKeys.playerCertificateKeys.map((key) => key.publicKey);

/** Source of src/mojang-keys.js for `keys` fetched on `date` (YYYY-MM-DD). */
export function renderModule(keys, date) {
  const entries = keys.map((key) => `  "${key}", // sha256 ${fingerprint(key)}\n`).join("");
  return (
    `// Mojang's playerCertificateKeys (GET ${PUBLIC_KEYS_URL}, fetched ${date}), base64 DER SubjectPublicKeyInfo.\n` +
    "// The Worker cannot fetch them (Mojang blocks Cloudflare). Update: node scripts/mojang-keys.mjs update\n" +
    `export const PLAYER_CERTIFICATE_KEYS = Object.freeze([\n${entries}]);\n`
  );
}

class Unavailable extends Error {}

/** The raw response text and its parsed key list; throws Unavailable when Mojang does not answer with a key list. */
async function fetchPublicKeys() {
  let response;
  try {
    response = await fetch(PUBLIC_KEYS_URL, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (error) {
    throw new Unavailable(`fetch failed: ${error.message}`);
  }
  if (response.status !== 200) throw new Unavailable(`HTTP ${response.status}`);
  const text = await response.text();
  return { text, keys: parseKeyList(text) };
}

function parseKeyList(text) {
  try {
    const keys = certificateKeysOf(JSON.parse(text));
    if (keys.length > 0 && keys.every((key) => typeof key === "string" && key.length > 0)) return keys;
  } catch {
    // reported below
  }
  throw new Unavailable("response has no playerCertificateKeys");
}

const sameKeys = (left, right) => left.length === right.length && left.every((key, index) => key === right[index]);
const listing = (label, keys) => [`${label}:`, ...keys.map((key, index) => `  #${index} sha256 ${fingerprint(key)}`)].join("\n");

function check(live) {
  if (sameKeys(PLAYER_CERTIFICATE_KEYS, live.keys)) {
    console.log(`ok: ${live.keys.length} keys match`);
    return EXIT_OK;
  }
  console.log(`${listing("pinned", PLAYER_CERTIFICATE_KEYS)}\n${listing("live", live.keys)}`);
  console.log("Mojang's key list changed: run `node scripts/mojang-keys.mjs update`, then `node test.mjs`, a PR and `npx wrangler deploy`.");
  return EXIT_DIFFERENT;
}

function update(live) {
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(MODULE, renderModule(live.keys, today));
  writeFileSync(SNAPSHOT, live.text);
  console.log(`updated: ${live.keys.length} keys pinned (${today})`);
  return EXIT_OK;
}

const COMMANDS = { check, update };

async function main(command) {
  if (!Object.hasOwn(COMMANDS, command)) {
    console.error("usage: node scripts/mojang-keys.mjs check|update");
    return EXIT_USAGE;
  }
  try {
    return COMMANDS[command](await fetchPublicKeys());
  } catch (error) {
    if (!(error instanceof Unavailable)) throw error;
    console.error(`Mojang's key list is unavailable: ${error.message}`);
    return EXIT_UNAVAILABLE;
  }
}

// The test suite imports this file for renderModule; only a direct run talks to Mojang.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv[2]);
}
