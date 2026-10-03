import test from "node:test";
import assert from "node:assert/strict";
import { checkNodes, renderNodes } from "../lib/nodes.mjs";
import { parseTinyV2 } from "../lib/intermediary.mjs";
import { openZip } from "../lib/zip.mjs";
import { deflateRawSync } from "node:zlib";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MANIFEST = {
  releaseIds: ["26.1", "1.21.11", "1.21.10", "1.21.9", "1.21.8"],
  requiredJavaMajor: async (id) => (id.startsWith("26") ? 25 : 21),
};

function node(overrides) {
  return { id: "1.21.10-fabric", loader: "fabric", loaderMin: "0.17.0", minecraft: ["1.21.9", "1.21.10"], javaMin: 21, strategy: "fabricAddMods", ...overrides };
}

const check = (...nodes) => checkNodes({ modVersion: "2.1.0", nodes }, MANIFEST);

test("a node whose ids are all manifest releases and whose Java fits passes", async () => {
  assert.deepEqual(await check(node({})), []);
});

test("a snapshot or unknown id is rejected", async () => {
  const problems = await check(node({ minecraft: ["1.21.10", "1.21.10-pre1"] }));
  assert.match(problems[0], /1\.21\.10-pre1/);
});

test("a gap in the release order is rejected", async () => {
  const problems = await check(node({ minecraft: ["1.21.11", "1.21.9"] }));
  assert.match(problems[0], /lueckenlos/);
});

test("javaMin above what Mojang requires for the oldest listed release is rejected", async () => {
  const problems = await check(node({ minecraft: ["1.21.11", "26.1"], javaMin: 25 }));
  assert.match(problems[0], /javaMin 25/);
});

test("the same loader and release in two nodes is rejected", async () => {
  const problems = await check(node({}), node({ id: "1.21.9-fabric" }));
  assert.ok(problems.some((p) => p.includes("fabric 1.21.9")));
});

test("an id that does not end in its loader is rejected", async () => {
  const problems = await check(node({ id: "1.21.10-forge" }));
  assert.match(problems[0], /id passt nicht/);
});

test("the rendered node list contains the machine-readable JSON and a table row per node", () => {
  const markdown = renderNodes({ modVersion: "2.1.0", nodes: [node({})] });
  assert.match(markdown, /^```json\n/);
  assert.match(markdown, /\| `1\.21\.10-fabric` \| 1\.21\.9 – 1\.21\.10 \| 0\.17\.0 \| 21 \| `fabricAddMods` \|/);
});

test("Tiny v2 lines map official names to intermediary names per class and member", () => {
  const tiny = parseTinyV2(["tiny\t2\t0\tofficial\tintermediary", "c\teul\tnet/minecraft/class_433", "\tm\t()V\tb\tmethod_25426", "\tf\tI\ta\tfield_1"].join("\n"));
  assert.equal(tiny.get("eul").intermediary, "net/minecraft/class_433");
  assert.equal(tiny.get("eul").members.get("b()V"), "method_25426");
  assert.equal(tiny.get("eul").members.get("aI"), "field_1");
});

function storedZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content, method] of entries) {
    const data = method === 8 ? deflateRawSync(content) : content;
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test("the zip reader lists entries and reads stored and deflated content", () => {
  const path = join(mkdtempSync(join(tmpdir(), "probe-zip-")), "a.zip");
  writeFileSync(path, storedZip([["a/B.class", Buffer.from("stored bytes"), 0], ["c.txt", Buffer.from("deflated deflated deflated"), 8]]));
  const zip = openZip(path);
  assert.deepEqual(zip.names, ["a/B.class", "c.txt"]);
  assert.equal(zip.read("a/B.class").toString(), "stored bytes");
  assert.equal(zip.read("c.txt").toString(), "deflated deflated deflated");
  zip.close();
});
