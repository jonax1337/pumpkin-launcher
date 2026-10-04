import test from "node:test";
import assert from "node:assert/strict";
import { ApiModel } from "../lib/api-model.mjs";
import { Mappings } from "../lib/mappings.mjs";

const PROGUARD = `net.minecraft.client.gui.screens.Screen -> a:
    void init() -> b
    void render(int) -> c
    boolean mouseScrolled(double) -> d
net.minecraft.client.gui.screens.PauseScreen -> e:
    void init() -> b
    void render(int) -> c
net.minecraft.client.gui.components.Renderable -> f:
    void render(int) -> c
net.minecraft.client.gui.screens.Other.Screen -> g:
`;

function classModel(name, superName, interfaces, members) {
  return { name, isInterface: false, superName, interfaces, members };
}

function member(name, descriptor, kind = "method", modifiers = ["public"]) {
  return { kind, name, descriptor, modifiers };
}

const MODELS = new Map([
  ["a", classModel("a", "java/lang/Object", ["f"], [member("b", "()V", "method", ["protected"]), member("c", "(I)V"), member("d", "(D)Z"), member("lambda$x$0", "()V")])],
  ["e", classModel("e", "a", [], [member("b", "()V", "method", ["protected"]), member("<init>", "(Z)V")])],
  ["f", classModel("f", null, [], [member("c", "(I)V", "method", ["public", "abstract"])])],
]);

function modelOver() {
  const readModels = (names) => new Map(names.filter((n) => MODELS.has(n)).map((n) => [n, MODELS.get(n)]));
  return new ApiModel(Mappings.fromProguard(PROGUARD), new Set(["a", "e", "f", "g"]), readModels, () => new Map());
}

test("a class is found by its fully qualified name or by the end of its name", () => {
  const model = modelOver();
  assert.equal(model.resolveClass("net.minecraft.client.gui.screens.PauseScreen"), "net/minecraft/client/gui/screens/PauseScreen");
  assert.equal(model.resolveClass("PauseScreen"), "net/minecraft/client/gui/screens/PauseScreen");
  assert.equal(model.resolveClass("Missing"), null);
});

test("an ambiguous class name is an error that lists the candidates", () => {
  assert.throws(() => modelOver().resolveClass("Screen"), /mehrdeutig.*Other\.Screen|mehrdeutig.*Other/s);
});

test("a fully qualified name wins over longer names that merely end the same way", () => {
  assert.equal(modelOver().resolveClass("net.minecraft.client.gui.screens.Screen"), "net/minecraft/client/gui/screens/Screen");
});

test("hierarchy lists the class, its superclasses and then interfaces, each once", () => {
  const model = modelOver();
  model.loadWithAncestors(["net/minecraft/client/gui/screens/PauseScreen"]);
  assert.deepEqual(model.hierarchy("net/minecraft/client/gui/screens/PauseScreen"), [
    "net/minecraft/client/gui/screens/PauseScreen",
    "net/minecraft/client/gui/screens/Screen",
    "net/minecraft/client/gui/components/Renderable",
  ]);
});

test("an override hides the inherited declaration with the same descriptor", () => {
  const model = modelOver();
  const pause = "net/minecraft/client/gui/screens/PauseScreen";
  model.loadWithAncestors([pause]);
  const init = model.findMembers(pause, "init");
  assert.deepEqual(init.map((m) => m.declaredIn), [pause]);
});

test("a member only the superclass declares is found and names its declaring class", () => {
  const model = modelOver();
  const pause = "net/minecraft/client/gui/screens/PauseScreen";
  model.loadWithAncestors([pause]);
  const [scrolled] = model.findMembers(pause, "mouseScrolled");
  assert.equal(scrolled.declaredIn, "net/minecraft/client/gui/screens/Screen");
  assert.equal(scrolled.descriptor, "(D)Z");
});

test("a member declared in a class and in its interface appears once, from the class", () => {
  const model = modelOver();
  const screen = "net/minecraft/client/gui/screens/Screen";
  model.loadWithAncestors([screen]);
  assert.deepEqual(model.findMembers(screen, "render").map((m) => m.declaredIn), [screen]);
});

test("constructors are never inherited", () => {
  const model = modelOver();
  const pause = "net/minecraft/client/gui/screens/PauseScreen";
  model.loadWithAncestors([pause]);
  assert.deepEqual(model.findMembers(pause, "<init>").map((m) => m.descriptor), ["(Z)V"]);
});

test("synthetic lambdas are not reported as members", () => {
  const model = modelOver();
  const screen = "net/minecraft/client/gui/screens/Screen";
  model.loadWithAncestors([screen]);
  assert.deepEqual(model.findMembers(screen, "lambda$x$0"), []);
});
