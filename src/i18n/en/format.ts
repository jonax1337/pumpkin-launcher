import { format as deFormat } from "../de/format.ts";

/** Englische Wörter der Formatierung; der Typ erzwingt dieselben Schlüssel wie im deutschen Wörterbuch. */
export const format: typeof deFormat = {
  "format.today": "Today",
  "format.yesterday": "Yesterday",
  "format.neverPlayed": "Never played",
  "format.underAMinute": "under 1 min",
  "format.minutes": "{n} min",
  "format.hours": "{n} h",
  "format.memoryDefault": "Default",
  "format.size.bytes": "bytes",
  "format.size.kb": "KB",
  "format.size.mb": "MB",
  "format.size.gb": "GB",
  "format.size.tb": "TB",
};
