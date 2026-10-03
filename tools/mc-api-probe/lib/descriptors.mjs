// JVM-Deskriptoren: umbenennen, zerlegen und als lesbaren Java-Typ ausgeben.

const PRIMITIVE_NAMES = {
  B: "byte", C: "char", D: "double", F: "float", I: "int", J: "long", S: "short", V: "void", Z: "boolean",
};
const PRIMITIVE_DESCRIPTORS = Object.fromEntries(Object.entries(PRIMITIVE_NAMES).map(([d, n]) => [n, d]));

/** `java.lang.String[]` (Proguard-Schreibweise) -> `[Ljava/lang/String;` */
export function javaTypeToDescriptor(javaType) {
  const arrayDepth = (javaType.match(/\[\]/g) ?? []).length;
  const base = javaType.replace(/(\[\])+$/, "");
  const element = PRIMITIVE_DESCRIPTORS[base] ?? `L${base.replaceAll(".", "/")};`;
  return "[".repeat(arrayDepth) + element;
}

/** Ersetzt jeden Klassennamen eines Deskriptors durch `rename(internalName)`. */
export function renameDescriptor(descriptor, rename) {
  return descriptor.replace(/L([^;]+);/g, (_, internalName) => `L${rename(internalName)};`);
}

/** `(ILfoo/Bar;[J)V` -> { parameters: ["I", "Lfoo/Bar;", "[J"], returnType: "V" } */
export function splitMethodDescriptor(descriptor) {
  const closing = descriptor.indexOf(")");
  const parameters = descriptor.slice(1, closing).match(/\[*(?:L[^;]+;|[BCDFIJSZ])/g) ?? [];
  return { parameters, returnType: descriptor.slice(closing + 1) };
}

/** `[Lnet/minecraft/Foo$Bar;` -> `net.minecraft.Foo.Bar[]` (oder mit `simple` nur `Foo.Bar[]`). */
export function descriptorToJavaType(typeDescriptor, { simple = false } = {}) {
  const arrayDepth = typeDescriptor.search(/[^[]/);
  const element = typeDescriptor.slice(arrayDepth);
  const name = element.startsWith("L") ? displayClassName(element.slice(1, -1), simple) : PRIMITIVE_NAMES[element];
  return name + "[]".repeat(arrayDepth);
}

function displayClassName(internalName, simple) {
  const dotted = internalName.replaceAll("/", ".").replaceAll("$", ".");
  if (!simple) return dotted;
  const packageEnd = internalName.lastIndexOf("/");
  return internalName.slice(packageEnd + 1).replaceAll("$", ".");
}

/** Einzeiler `ret name(P1, P2)` fuer Menschen. */
export function methodToJava(name, descriptor, options) {
  const { parameters, returnType } = splitMethodDescriptor(descriptor);
  const rendered = parameters.map((p) => descriptorToJavaType(p, options)).join(", ");
  return `${descriptorToJavaType(returnType, options)} ${name}(${rendered})`;
}
