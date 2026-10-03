import test from "node:test";
import assert from "node:assert/strict";
import { Mappings } from "../lib/mappings.mjs";

const PROGUARD = `# comment line
net.minecraft.client.gui.screens.Screen -> eul:
# {"fileName":"Screen.java","id":"sourceFile"}
    int width -> a
    36:36:void init() -> b
    40:41:boolean keyPressed(int,int,int) -> a
    55:55:net.minecraft.network.chat.Component getTitle() -> c
net.minecraft.client.gui.screens.PauseScreen -> eum:
    22:22:void <init>(boolean) -> <init>
    30:31:void init(net.minecraft.client.Minecraft,int,int):7:8 -> a
`;

test("classes translate in both directions and unknown classes keep their name", () => {
  const mappings = Mappings.fromProguard(PROGUARD);
  assert.equal(mappings.obfClass("net/minecraft/client/gui/screens/Screen"), "eul");
  assert.equal(mappings.mojangClass("eul"), "net/minecraft/client/gui/screens/Screen");
  assert.equal(mappings.mojangClass("java/lang/Object"), "java/lang/Object");
});

test("a descriptor in obfuscated names translates to Mojang names", () => {
  const mappings = Mappings.fromProguard(PROGUARD);
  assert.equal(mappings.mojangDescriptor("(Leul;I)Ljava/lang/String;"), "(Lnet/minecraft/client/gui/screens/Screen;I)Ljava/lang/String;");
});

test("members are looked up by class, obfuscated name and Mojang descriptor", () => {
  const mappings = Mappings.fromProguard(PROGUARD);
  assert.equal(mappings.mojangMemberName("eul", "b", "()V"), "init");
  assert.equal(mappings.mojangMemberName("eul", "a", "(III)Z"), "keyPressed");
  assert.equal(mappings.mojangMemberName("eul", "a", "I"), "width");
});

test("two members sharing an obfuscated name stay apart through their descriptors", () => {
  const mappings = Mappings.fromProguard(PROGUARD);
  assert.notEqual(mappings.mojangMemberName("eul", "a", "(III)Z"), mappings.mojangMemberName("eul", "a", "I"));
});

test("trailing original line numbers on a method line are ignored", () => {
  const mappings = Mappings.fromProguard(PROGUARD);
  assert.equal(mappings.mojangMemberName("eum", "a", "(Lnet/minecraft/client/Minecraft;II)V"), "init");
});

test("an unmapped member keeps its name", () => {
  const mappings = Mappings.fromProguard(PROGUARD);
  assert.equal(mappings.mojangMemberName("eul", "toString", "()Ljava/lang/String;"), "toString");
});

test("identity mappings leave every name alone and list the jar's classes", () => {
  const mappings = Mappings.identity(["net/minecraft/Foo", "net/minecraft/Foo$Bar"]);
  assert.equal(mappings.isIdentity, true);
  assert.equal(mappings.obfClass("net/minecraft/Foo"), "net/minecraft/Foo");
  assert.equal(mappings.mojangMemberName("net/minecraft/Foo", "init", "()V"), "init");
  assert.deepEqual(mappings.mojangClassNames().sort(), ["net/minecraft/Foo", "net/minecraft/Foo$Bar"]);
});
