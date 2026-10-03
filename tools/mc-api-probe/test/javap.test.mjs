import test from "node:test";
import assert from "node:assert/strict";
import { parseJavap } from "../lib/javap.mjs";
import { parseMethodBodies } from "../lib/code.mjs";

const SCREEN_OUTPUT = `Compiled from "SourceFile"
public abstract class eul extends eut implements java.util.function.Supplier<eul>, java.lang.Runnable {
  public int a;
    descriptor: I
  protected final java.util.List<eum<java.lang.String, java.util.List<eul>>> b;
    descriptor: Ljava/util/List;
  protected eul(zw);
    descriptor: (Lzw;)V
  protected void b();
    descriptor: ()V
  public boolean a(int, int, int) throws java.io.IOException;
    descriptor: (III)Z
  public static <T extends java.lang.Object> T c(T);
    descriptor: (Ljava/lang/Object;)Ljava/lang/Object;
  static {};
    descriptor: ()V
}
`;

test("a class header yields name, superclass and interfaces without generics", () => {
  const [screen] = parseJavap(SCREEN_OUTPUT);
  assert.equal(screen.name, "eul");
  assert.equal(screen.superName, "eut");
  assert.deepEqual(screen.interfaces, ["java/util/function/Supplier", "java/lang/Runnable"]);
  assert.equal(screen.isInterface, false);
});

test("fields and methods carry kind, modifiers and the JVM descriptor", () => {
  const [screen] = parseJavap(SCREEN_OUTPUT);
  const byName = (name) => screen.members.filter((member) => member.name === name);
  assert.deepEqual(byName("a").map((m) => [m.kind, m.descriptor]), [["field", "I"], ["method", "(III)Z"]]);
  assert.deepEqual(byName("b")[1].modifiers, ["protected"]);
  assert.deepEqual(byName("b")[0].modifiers, ["protected", "final"]);
});

test("a constructor is recognised by the class name and called <init>", () => {
  const [screen] = parseJavap(SCREEN_OUTPUT);
  const constructors = screen.members.filter((member) => member.name === "<init>");
  assert.deepEqual(constructors.map((c) => c.descriptor), ["(Lzw;)V"]);
});

test("generic methods and throws clauses do not disturb name or descriptor", () => {
  const [screen] = parseJavap(SCREEN_OUTPUT);
  assert.ok(screen.members.some((m) => m.name === "c" && m.descriptor === "(Ljava/lang/Object;)Ljava/lang/Object;"));
});

test("an interface lists its super-interfaces and has no superclass", () => {
  const [model] = parseJavap(`public interface net.minecraft.Renderable extends java.lang.Runnable, java.lang.AutoCloseable {
  public abstract void run();
    descriptor: ()V
}
`);
  assert.equal(model.isInterface, true);
  assert.equal(model.superName, null);
  assert.deepEqual(model.interfaces, ["java/lang/Runnable", "java/lang/AutoCloseable"]);
});

test("several classes in one output are split into separate models", () => {
  const models = parseJavap(`${SCREEN_OUTPUT}public class eut {
}
`);
  assert.deepEqual(models.map((m) => m.name), ["eul", "eut"]);
});

const CODE_OUTPUT = `public class fgo extends eul {
  private void a();
    descriptor: ()V
    Code:
       0: aload_0
       1: getfield      #7                  // Field l:Lfgo;
       4: invokevirtual #9                  // Method enn.T:()Z
       7: ldc           #11                 // String hello
      10: new           #13                 // class fgp
      13: return

  public void b();
    descriptor: ()V
    Code:
       0: invokestatic  #20                 // Method fgo.a:(I)V
       3: return
}
`;

test("a method body lists its references in order, keyed by name and descriptor", () => {
  const bodies = parseMethodBodies(CODE_OUTPUT);
  const references = bodies.get("a()V").filter(({ kind }) => kind !== null);
  assert.deepEqual(references.map(({ opcode, kind, target }) => [opcode, kind, target]), [
    ["getfield", "Field", "l:Lfgo;"],
    ["invokevirtual", "Method", "enn.T:()Z"],
    ["ldc", "String", "hello"],
    ["new", "class", "fgp"],
  ]);
  assert.equal(bodies.get("b()V").length, 2);
});

test("an instruction without a reference is kept with an empty kind", () => {
  const [first] = parseMethodBodies(CODE_OUTPUT).get("a()V");
  assert.deepEqual(first, { opcode: "aload_0", kind: null, target: null });
});
