// Liest mit `javap -c -p` die Aufrufe und Feldzugriffe im Rumpf einer Methode (zeigt, was Vanilla in einer Version tut).
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const REFERENCE_COMMENT = /\/\/ (Method|InterfaceMethod|Field|class|String) (.+)$/;
const INSTRUCTION = /^\s+\d+: (\w+)(?:\s+(.*))?$/;
const METHOD_DECLARATION = /^ {2}\S.*\(.*\)(?: throws .+)?;$|^ {2}static \{\};$/;

/** Zerlegt `javap -c -p`-Ausgabe einer Klasse in { "name(descriptor)": [{ opcode, kind, target }] }. */
export function parseMethodBodies(output) {
  const bodies = new Map();
  let current = null;
  for (const line of output.split(/\r?\n/)) {
    if (METHOD_DECLARATION.test(line)) {
      current = { declaration: line.trim(), descriptor: null, instructions: [] };
    } else if (current && /^ {4}descriptor: /.test(line)) {
      current.descriptor = line.replace(/^ {4}descriptor: /, "").trim();
      bodies.set(`${declaredName(current.declaration)}${current.descriptor}`, current.instructions);
    } else if (current) {
      const instruction = INSTRUCTION.exec(line);
      const reference = instruction && REFERENCE_COMMENT.exec(line);
      if (instruction) current.instructions.push({ opcode: instruction[1], kind: reference?.[1] ?? null, target: reference?.[2] ?? null });
    }
  }
  return bodies;
}

function declaredName(declaration) {
  if (declaration.startsWith("static {}")) return "<clinit>";
  return declaration.slice(0, declaration.indexOf("(")).split(/\s+/).at(-1);
}

/** Fuehrt `javap -c -p` fuer eine Klasse der Jar aus. */
export function readMethodBodies(javaHome, jarPath, obfClassName) {
  const executable = javaHome ? join(javaHome, "bin", process.platform === "win32" ? "javap.exe" : "javap") : "javap";
  const output = execFileSync(executable, ["-c", "-p", "-s", "-cp", jarPath, obfClassName.replaceAll("/", ".")], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return parseMethodBodies(output);
}
