// Ruft `javap -p -s` auf und zerlegt die Ausgabe in Klassenmodelle (noch mit den Namen der Jar).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const BATCH_SIZE = 150;
const MODIFIERS = new Set([
  "public", "protected", "private", "static", "final", "abstract", "synchronized", "native",
  "strictfp", "default", "transient", "volatile",
]);
const HEADER_PATTERN =
  /^(?<modifiers>.*?)\b(?<kind>class|interface|enum|record|@interface)\s+(?<name>\S+?)(?:\s+extends\s+(?<extends>.+?))?(?:\s+implements\s+(?<implements>.+))?$/;

function removeGenerics(text) {
  let previous;
  let current = text;
  do {
    previous = current;
    current = current.replace(/<[^<>]*>/g, "");
  } while (current !== previous);
  return current;
}

function toInternalName(javaName) {
  return javaName.replaceAll(".", "/");
}

function splitTypeList(list) {
  return list ? list.split(",").map((type) => toInternalName(type.trim())) : [];
}

function parseHeader(line) {
  const match = HEADER_PATTERN.exec(removeGenerics(line.replace(/\s*\{$/, "")));
  if (!match) throw new Error(`javap-Kopfzeile nicht lesbar: ${line}`);
  const { kind, name, extends: extendsClause, implements: implementsClause } = match.groups;
  const isInterface = kind.includes("interface");
  return {
    name: toInternalName(name),
    isInterface,
    superName: !isInterface && extendsClause ? toInternalName(extendsClause.trim()) : null,
    interfaces: splitTypeList(isInterface ? extendsClause : implementsClause),
    members: [],
  };
}

function leadingModifiers(tokens) {
  return tokens.filter((token, index) => MODIFIERS.has(token) && tokens.slice(0, index).every((t) => MODIFIERS.has(t)));
}

function parseMemberLine(line, classDottedName) {
  const declaration = line.trim().replace(/;$/, "").replace(/\s+throws\s+.+$/, "");
  if (declaration === "static {}") return { kind: "method", name: "<clinit>", modifiers: ["static"] };
  const parenthesis = declaration.indexOf("(");
  const head = parenthesis < 0 ? declaration : declaration.slice(0, parenthesis);
  const tokens = head.split(/\s+/);
  const name = tokens.at(-1);
  const isConstructor = parenthesis >= 0 && (name === classDottedName || name === classDottedName.replaceAll("$", "."));
  return {
    kind: parenthesis < 0 ? "field" : "method",
    name: isConstructor ? "<init>" : name,
    modifiers: leadingModifiers(tokens),
  };
}

/** Zerlegt die Ausgabe von `javap -p -s` (mehrere Klassen moeglich) in Klassenmodelle. */
export function parseJavap(output) {
  const classes = [];
  let current = null;
  let pending = null;
  for (const line of output.split(/\r?\n/)) {
    if (/^\S/.test(line) && line.endsWith("{")) {
      current = parseHeader(line);
      current.dottedName = current.name.replaceAll("/", ".");
      classes.push(current);
    } else if (current && /^ {2}\S/.test(line)) {
      pending = parseMemberLine(line, current.dottedName);
    } else if (pending && /^ {4}descriptor: /.test(line)) {
      current.members.push({ ...pending, descriptor: line.replace(/^ {4}descriptor: /, "").trim() });
      pending = null;
    }
  }
  return classes.map(({ dottedName, ...model }) => model);
}

function javapExecutable(javaHome) {
  const name = process.platform === "win32" ? "javap.exe" : "javap";
  const path = javaHome ? join(javaHome, "bin", name) : name;
  if (javaHome && !existsSync(path)) throw new Error(`javap nicht gefunden: ${path}`);
  return path;
}

/** Laedt die Modelle der genannten Klassen (interne Namen mit `/`) aus einer Jar. */
export function readClassModels(javaHome, jarPath, internalNames) {
  const models = new Map();
  for (let start = 0; start < internalNames.length; start += BATCH_SIZE) {
    const batch = internalNames.slice(start, start + BATCH_SIZE).map((name) => name.replaceAll("/", "."));
    const output = execFileSync(javapExecutable(javaHome), ["-p", "-s", "-cp", jarPath, ...batch], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    for (const model of parseJavap(output)) models.set(model.name, model);
  }
  return models;
}
