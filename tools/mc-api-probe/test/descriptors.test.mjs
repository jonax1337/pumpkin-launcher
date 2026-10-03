import test from "node:test";
import assert from "node:assert/strict";
import {
  descriptorToJavaType,
  javaTypeToDescriptor,
  methodToJava,
  renameDescriptor,
  splitMethodDescriptor,
} from "../lib/descriptors.mjs";

test("a Proguard type becomes a JVM type descriptor", () => {
  assert.equal(javaTypeToDescriptor("int"), "I");
  assert.equal(javaTypeToDescriptor("java.lang.String"), "Ljava/lang/String;");
  assert.equal(javaTypeToDescriptor("net.minecraft.Foo[][]"), "[[Lnet/minecraft/Foo;");
});

test("a method descriptor splits into parameters and return type", () => {
  assert.deepEqual(splitMethodDescriptor("(ILnet/minecraft/Foo;[J)V"), {
    parameters: ["I", "Lnet/minecraft/Foo;", "[J"],
    returnType: "V",
  });
  assert.deepEqual(splitMethodDescriptor("()Z"), { parameters: [], returnType: "Z" });
});

test("class names inside a descriptor are renamed, primitives are untouched", () => {
  const renamed = renameDescriptor("(La;IB)Lb;", (name) => `net/minecraft/${name.toUpperCase()}`);
  assert.equal(renamed, "(Lnet/minecraft/A;IB)Lnet/minecraft/B;");
});

test("nested classes read as Outer.Inner, optionally with the simple name only", () => {
  assert.equal(descriptorToJavaType("[Lnet/minecraft/Button$OnPress;"), "net.minecraft.Button.OnPress[]");
  assert.equal(descriptorToJavaType("Lnet/minecraft/Button$OnPress;", { simple: true }), "Button.OnPress");
});

test("a method renders as return type, name and parameter list", () => {
  assert.equal(methodToJava("render", "(Lnet/minecraft/GuiGraphics;IIF)V", { simple: true }), "void render(GuiGraphics, int, int, float)");
});
