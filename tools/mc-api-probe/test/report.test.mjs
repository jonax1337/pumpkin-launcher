import test from "node:test";
import assert from "node:assert/strict";
import { buildGroupTables, cellsBySpec, entriesBySpec, renderGroupTables } from "../lib/report.mjs";
import { compatibleRuns, findBreakpoints, renderBreakpoints } from "../lib/breakpoints.mjs";
import { parseMemberSpec } from "../lib/probe.mjs";
import { formatCompactJson, unpackStored } from "../lib/format.mjs";
import { replaceRegion } from "../lib/doc-region.mjs";

const SCREEN = "net/minecraft/client/gui/screens/Screen";

function method(name, descriptor, modifiers = ["public"], declaredIn = SCREEN) {
  return { kind: "method", name, modifiers, descriptor, declaredIn };
}

function entry(spec, members, { used = false, classFound = true } = {}) {
  return { group: "Screen", spec, used, className: classFound ? SCREEN : null, classFound, members };
}

function version(id, entries) {
  return [id, { version: id, entries }];
}

const RENDER_OLD = "(Lnet/minecraft/client/gui/GuiGraphics;IIF)V";
const RENDER_NEW = "(Lnet/minecraft/client/gui/GuiGraphicsExtractor;IIF)V";

function history() {
  return new Map([
    version("1.21.1", [entry("Screen#render", [method("render", RENDER_OLD)], { used: true }), entry("Screen#tick", [method("tick", "()V")], { used: true })]),
    version("1.21.2", [entry("Screen#render", [method("render", RENDER_OLD)], { used: true }), entry("Screen#tick", [method("tick", "()V")], { used: true })]),
    version("26.1", [entry("Screen#render", [], { used: true }), entry("Screen#tick", [method("tick", "()V")], { used: true })]),
  ]);
}

test("entry indexes retain source objects, spec order and requested version order", () => {
  const results = history();
  const versions = ["26.1", "1.21.1"];
  const indexed = entriesBySpec(results, versions);
  assert.deepEqual([...indexed.keys()], ["Screen#render", "Screen#tick"]);
  assert.deepEqual([...indexed.get("Screen#render").keys()], versions);
  assert.equal(indexed.get("Screen#render").get("26.1"), results.get("26.1").entries[0]);
});

test("entry and cell indexes keep the last entry for a repeated spec in a version", () => {
  const first = entry("Screen#tick", [method("tick", "()V")]);
  const last = entry("Screen#tick", [], { classFound: false });
  const results = new Map([version("26.1", [first, last])]);
  assert.equal(entriesBySpec(results, ["26.1"]).get("Screen#tick").get("26.1"), last);
  assert.equal(cellsBySpec(results, ["26.1"]).get("Screen#tick").get("26.1"), "class absent");
});

test("entry and cell indexes are empty when no versions are requested", () => {
  assert.deepEqual(entriesBySpec(new Map(), []), new Map());
  assert.deepEqual(cellsBySpec(new Map(), []), new Map());
});

test("versions with identical signatures in a group share one era column", () => {
  const [table] = buildGroupTables(["1.21.1", "1.21.2", "26.1"], history());
  assert.deepEqual(table.eras, ["1.21.1 – 1.21.2", "26.1"]);
});

test("a cell equal to the previous era is shown as a ditto mark", () => {
  const [table] = buildGroupTables(["1.21.1", "1.21.2", "26.1"], history());
  const tick = table.rows.find((row) => row.spec === "Screen#tick");
  assert.deepEqual(tick.cells, ["() → void", "="]);
});

test("a member that no probed version has is listed separately instead of as an empty row", () => {
  const results = new Map([version("1.21.1", [entry("Screen#ghost", [])]), version("26.1", [entry("Screen#ghost", [])])]);
  const [table] = buildGroupTables(["1.21.1", "26.1"], results);
  assert.deepEqual(table.rows, []);
  assert.deepEqual(table.neverPresent, ["Screen#ghost"]);
});

test("an inherited member names its declaring class and a missing class says so", () => {
  const inherited = method("keyPressed", "(III)Z", ["public"], "net/minecraft/client/gui/components/events/ContainerEventHandler");
  const results = new Map([version("1.21.1", [entry("Screen#keyPressed", [inherited])]), version("1.20.1", [entry("Screen#keyPressed", [], { classFound: false })])]);
  const markdown = renderGroupTables(buildGroupTables(["1.20.1", "1.21.1"], results));
  assert.match(markdown, /class absent/);
  assert.match(markdown, /\(int, int, int\) → boolean ← ContainerEventHandler/);
});

test("private members are invisible to callers and do not count as present", () => {
  const results = new Map([
    version("1.21.1", [entry("Screen#hidden", [method("hidden", "()V", ["private"])])]),
    version("26.1", [entry("Screen#hidden", [method("hidden", "()V", ["public"])])]),
  ]);
  const [table] = buildGroupTables(["1.21.1", "26.1"], results);
  assert.deepEqual(table.rows[0].cells, ["–", "() → void"]);
});

test("a used member whose signature disappears is a breaking change", () => {
  const [, secondStep] = findBreakpoints(["1.21.1", "1.21.2", "26.1"], history());
  assert.equal(secondStep.from, "1.21.2");
  assert.deepEqual(secondStep.hard.map((change) => change.spec), ["Screen#render"]);
});

test("a changed return type breaks, because the binary descriptor differs", () => {
  const results = new Map([
    version("1.21.5", [entry("GuiGraphics#drawString", [method("drawString", "(Lfont;I)I")], { used: true })]),
    version("1.21.6", [entry("GuiGraphics#drawString", [method("drawString", "(Lfont;I)V")], { used: true })]),
  ]);
  const [step] = findBreakpoints(["1.21.5", "1.21.6"], results);
  assert.equal(step.hard.length, 1);
});

test("a new overload next to the old signature is not a break", () => {
  const results = new Map([
    version("1.21.1", [entry("EditBox#<init>", [method("<init>", "(IZ)V")], { used: true })]),
    version("1.21.2", [entry("EditBox#<init>", [method("<init>", "(IZ)V"), method("<init>", "(I)V")], { used: true })]),
  ]);
  const [step] = findBreakpoints(["1.21.1", "1.21.2"], results);
  assert.equal(step.hard.length, 0);
  assert.equal(step.soft.length, 1);
});

test("members the mod does not use never cause a break", () => {
  const results = new Map([
    version("1.21.1", [entry("Screen#render", [method("render", RENDER_OLD)])]),
    version("26.1", [entry("Screen#render", [method("render", RENDER_NEW)])]),
  ]);
  const [step] = findBreakpoints(["1.21.1", "26.1"], results);
  assert.deepEqual([step.hard, step.soft], [[], []]);
});

test("compatible runs are cut exactly at breaking transitions", () => {
  const versions = ["1.21.1", "1.21.2", "26.1"];
  assert.deepEqual(compatibleRuns(versions, findBreakpoints(versions, history())), [["1.21.1", "1.21.2"], ["26.1"]]);
});

test("the breakpoint report names the runs and the changed member", () => {
  const markdown = renderBreakpoints(["1.21.1", "1.21.2", "26.1"], history());
  assert.match(markdown, /1\.21\.1 – 1\.21\.2 · 26\.1/);
  assert.match(markdown, /1\.21\.2 → 26\.1 \| `Screen#render`/);
});

test("a member spec line carries group, @used flag and splits class from member", () => {
  const entries = parseMemberSpec("# note\n@group Input\nScreen#keyPressed @used\nnet.minecraft.Foo#<init>\n");
  assert.deepEqual(entries.map(({ group, spec, used, classRef, memberName }) => [group, spec, used, classRef, memberName]), [
    ["Input", "Screen#keyPressed", true, "Screen", "keyPressed"],
    ["Input", "net.minecraft.Foo#<init>", false, "net.minecraft.Foo", "<init>"],
  ]);
});

test("a spec line without class and member is rejected", () => {
  assert.throws(() => parseMemberSpec("justAWord"), /Klasse#Mitglied/);
});

test("stored results read back exactly as they were written", () => {
  const original = [entry("Screen#render", [method("render", RENDER_OLD)], { used: true }), entry("Screen#ghost", [])];
  const stored = JSON.parse(formatCompactJson({ id: "1.21.1", javaMajor: 21, mappingPath: "m", jarSha1: "x" }, original));
  const restored = unpackStored(stored).entries;
  assert.deepEqual(restored[0].members, original[0].members);
  assert.equal(restored[0].used, true);
  assert.equal(restored[1].members.length, 0);
});

test("a document region is replaced and the text around it stays", () => {
  const document = "before\n<!-- tables:begin -->\nold\n<!-- tables:end -->\nafter\n";
  const updated = replaceRegion(document, "tables", "new");
  assert.equal(updated, "before\n<!-- tables:begin -->\n\nnew\n\n<!-- tables:end -->\nafter\n");
});

test("a document without the markers is an error", () => {
  assert.throws(() => replaceRegion("plain", "tables", "x"), /Marker/);
});
