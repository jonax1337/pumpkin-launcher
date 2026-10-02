/** `base`, sonst `base 2`, `base 3` …: der erste Name, den `taken` noch nicht hat (Groß- und Kleinschreibung egal). */
export function uniqueName(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map((name) => name.trim().toLowerCase()));
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} ${n}`;
  return name;
}
