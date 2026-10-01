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

/** Spielzeit als „12:04“ oder „1:02:09“. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(s % 60).padStart(2, "0")}`;
}

/** Gesamte Spielzeit kompakt: „unter 1 Min.“, „45 Min.“, „3,5 Std.“, ab 10 Stunden ganze Stunden („37 Std.“). */
export function formatPlaytime(secs: number): string {
  if (secs < 60) return "unter 1 Min.";
  if (secs < 3600) return `${Math.floor(secs / 60)} Min.`;
  const hours = secs / 3600;
  return `${hours.toLocaleString("de", { maximumFractionDigits: hours < 10 ? 1 : 0 })} Std.`;
}

/** Tausender mit schmalem Leerzeichen („3 480“), wie im Mockup. */
export const formatCount = (n: number) => n.toLocaleString("de").replace(/\./g, " ");

/** Dateigröße: „840 KB“, „2,4 MB“. */
export function formatSize(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb < 1 ? `${Math.ceil(bytes / 1024)} KB` : `${mb.toLocaleString("de", { maximumFractionDigits: 1 })} MB`;
}

export function formatMemory(mb: number | null): string {
  if (mb == null) return "Standard";
  return `${(mb / 1024).toLocaleString("de", { maximumFractionDigits: 1 })} GB`;
}

const floor512 = (mb: number) => Math.floor(mb / 512) * 512;

/** Standard-Arbeitsspeicher: Hälfte des PCs, auf 512 MB gerundet, zwischen 2 und 8 GB. */
export const autoMemoryMb = (totalMb: number) => Math.min(8192, Math.max(2048, Math.round(totalMb / 1024) * 512));

/** Obergrenze für den Regler: 2 GB bleiben für Windows und andere Programme. */
export const maxMemoryMb = (totalMb: number) => Math.max(2048, floor512(totalMb - 2048));

/** Mehr als drei Viertel des PCs: Windows wird knapp. */
export const memoryTooHigh = (mb: number, totalMb: number) => mb > totalMb * 0.75;
