// Mojang-Mappings (Proguard-Format) einlesen. Alle Namen intern mit `/` (JVM-Schreibweise).
import { javaTypeToDescriptor, renameDescriptor } from "./descriptors.mjs";

const CLASS_LINE = /^(\S+) -> (\S+):$/;
const METHOD_LINE = /^\s+(?:\d+:\d+:)?(\S+) (\S+?)\((.*?)\)(?::\d+:\d+)? -> (\S+)$/;
const FIELD_LINE = /^\s+(\S+) (\S+) -> (\S+)$/;

function toInternal(javaName) {
  return javaName.replaceAll(".", "/");
}

function methodDescriptor(returnType, parameterList) {
  const parameters = parameterList === "" ? [] : parameterList.split(",");
  return `(${parameters.map(javaTypeToDescriptor).join("")})${javaTypeToDescriptor(returnType)}`;
}

function parseClasses(text) {
  const classes = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("#") || line.trim() === "") continue;
    const classMatch = CLASS_LINE.exec(line);
    if (classMatch) {
      classes.push({ mojang: toInternal(classMatch[1]), obf: toInternal(classMatch[2]), members: [] });
      continue;
    }
    const method = METHOD_LINE.exec(line);
    if (method) {
      classes.at(-1).members.push({ kind: "method", mojangName: method[2], obfName: method[4], mojangDescriptor: methodDescriptor(method[1], method[3]) });
      continue;
    }
    const field = FIELD_LINE.exec(line);
    if (field) {
      classes.at(-1).members.push({ kind: "field", mojangName: field[2], obfName: field[3], mojangDescriptor: javaTypeToDescriptor(field[1]) });
    }
  }
  return classes;
}

/** Uebersetzt zwischen den (verschleierten) Namen der Jar und den Mojang-Namen. */
export class Mappings {
  #obfByMojang = new Map();
  #mojangByObf = new Map();
  #memberNames = new Map();
  #identity;

  constructor(classes, identity) {
    this.#identity = identity;
    for (const cls of classes) {
      this.#obfByMojang.set(cls.mojang, cls.obf);
      this.#mojangByObf.set(cls.obf, cls.mojang);
      for (const member of cls.members) {
        this.#memberNames.set(memberKey(cls.obf, member.obfName, member.mojangDescriptor), member.mojangName);
      }
    }
  }

  static fromProguard(text) {
    return new Mappings(parseClasses(text), false);
  }

  /** Fuer unobfuskierte Versionen: Namen der Jar sind schon die Mojang-Namen. */
  static identity(internalClassNames) {
    return new Mappings(internalClassNames.map((name) => ({ mojang: name, obf: name, members: [] })), true);
  }

  get isIdentity() {
    return this.#identity;
  }

  mojangClassNames() {
    return [...this.#obfByMojang.keys()];
  }

  hasMojangClass(mojangName) {
    return this.#obfByMojang.has(mojangName);
  }

  obfClass(mojangName) {
    return this.#obfByMojang.get(mojangName);
  }

  /** Klassen ausserhalb der Mappings (JDK, Bibliotheken) behalten ihren Namen. */
  mojangClass(obfName) {
    return this.#mojangByObf.get(obfName) ?? obfName;
  }

  mojangDescriptor(obfDescriptor) {
    return renameDescriptor(obfDescriptor, (name) => this.mojangClass(name));
  }

  /** Mojang-Name eines in genau dieser Klasse deklarierten Mitglieds; undefined, wenn die Klasse es nicht deklariert. */
  declaredMojangMemberName(obfClassName, obfName, mojangDescriptor) {
    return this.#memberNames.get(memberKey(obfClassName, obfName, mojangDescriptor));
  }

  /** Nicht gemappte Mitglieder (Ueberschreibungen von JDK-Methoden, Lambdas) behalten ihren Namen. */
  mojangMemberName(obfClassName, obfName, mojangDescriptor) {
    return this.declaredMojangMemberName(obfClassName, obfName, mojangDescriptor) ?? obfName;
  }
}

function memberKey(obfClassName, obfName, mojangDescriptor) {
  return `${obfClassName}\u0000${obfName}\u0000${mojangDescriptor}`;
}
