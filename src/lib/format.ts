const rtf = new Intl.RelativeTimeFormat("de", { numeric: "auto" });
const dtf = new Intl.DateTimeFormat("de", { day: "2-digit", month: "short", year: "numeric" });

export function relativeTime(ms: number | null): string {
  if (ms == null) return "Noch nie gespielt";
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  if (abs < 30 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), "day");
  return dtf.format(ms);
}

export function formatDate(ms: number): string {
  return dtf.format(ms);
}

export function formatMemory(mb: number | null): string {
  if (mb == null) return "Standard";
  return `${(mb / 1024).toLocaleString("de", { maximumFractionDigits: 1 })} GB`;
}
