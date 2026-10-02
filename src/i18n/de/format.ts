import type { Dict } from "../types.ts";

/** Wörter der Zahlen- und Datumsformatierung (`lib/format.ts`). */
export const format = {
  "format.today": "Heute",
  "format.yesterday": "Gestern",
  "format.neverPlayed": "Noch nie gespielt",
  "format.underAMinute": "unter 1 Min.",
  "format.minutes": "{n} Min.",
  "format.hours": "{n} Std.",
  "format.memoryDefault": "Standard",
  "format.size.bytes": "Bytes",
  "format.size.kb": "KB",
  "format.size.mb": "MB",
  "format.size.gb": "GB",
  "format.size.tb": "TB",
} satisfies Dict;
