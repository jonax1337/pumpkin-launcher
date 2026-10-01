/** Waagerechter Lauf gleicher Zeichen in einem Pixelraster. */
export type Run = { x: number; y: number; length: number; cell: string };

/** Läufe gleicher Zeichen je Zeile eines Pixelrasters; Zeichen `empty` (Standard ".") bleiben leer. */
export function rowRuns(rows: readonly string[], empty = "."): Run[] {
  const runs: Run[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const cell = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === cell) end++;
      if (cell !== empty) runs.push({ x, y, length: end - x, cell });
      x = end;
    }
  });
  return runs;
}
