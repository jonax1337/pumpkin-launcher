// Sprache kommt aus dem i18n-Modul; Intl-Formatierer und Wörter wie „Heute“ hängen an sie.
// Import mit Endung: Dieses Modul lädt auch das plain-node-Prüf-Skript (kein Bundler, der Auflösung macht).
import { currentLanguage, t } from "../i18n/core.ts";
import type { Language } from "../i18n/types.ts";

/** Letzter Teil eines Windows- oder Unix-Pfads. */
export const fileName = (path: string) => path.split(/[\\/]/).pop()!;

const DATE_OPTIONS: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" };

/** Intl-Formatierer sind teuer und hängen an der Sprache: je Sprache einmal bauen und behalten. */
const cache = new Map<Language, { date: Intl.DateTimeFormat; dateTime: Intl.DateTimeFormat; relative: Intl.RelativeTimeFormat }>();

function formatters() {
  const lang = currentLanguage();
  let f = cache.get(lang);
  if (!f) {
    f = {
      date: new Intl.DateTimeFormat(lang, DATE_OPTIONS),
      dateTime: new Intl.DateTimeFormat(lang, { ...DATE_OPTIONS, hour: "2-digit", minute: "2-digit" }),
      relative: new Intl.RelativeTimeFormat(lang, { numeric: "auto" }),
    };
    cache.set(lang, f);
  }
  return f;
}

export function relativeTime(ms: number | null): string {
  if (ms == null) return t("format.neverPlayed");
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  if (abs < 3_600_000) return formatters().relative.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return formatters().relative.format(Math.round(diff / 3_600_000), "hour");
  if (abs < 30 * 86_400_000) return formatters().relative.format(Math.round(diff / 86_400_000), "day");
  return formatDate(ms);
}

export function formatDate(ms: number): string {
  return formatters().date.format(ms);
}

/** Datum mit Uhrzeit, z. B. für mehrere Sicherungen am selben Tag. */
export function formatDateTime(ms: number): string {
  return formatters().dateTime.format(ms);
}

const DAY = 86_400_000;

/** Beginn des (lokalen) Kalendertags, in dem `ms` liegt. */
export const dayStart = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);

/** „Heute“, „Gestern“, sonst das Datum von `day` (ein Tagesbeginn). Gerundet, weil Tage mit Zeitumstellung 23 oder 25 Stunden haben. */
export function dayLabel(day: number, now = Date.now()): string {
  const ago = Math.round((dayStart(now) - day) / DAY);
  return ago === 0 ? t("format.today") : ago === 1 ? t("format.yesterday") : formatDate(day);
}

/** Spielzeit als „12:04“ oder „1:02:09“. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(s % 60).padStart(2, "0")}`;
}

/** Gesamte Spielzeit kompakt: „unter 1 Min.“, „45 Min.“, „3,5 Std.“, ab 10 Stunden ganze Stunden („37 Std.“). */
export function formatPlaytime(secs: number): string {
  if (secs < 60) return t("format.underAMinute");
  if (secs < 3600) return t("format.minutes", { n: Math.floor(secs / 60) });
  const hours = secs / 3600;
  return t("format.hours", { n: hours.toLocaleString(currentLanguage(), { maximumFractionDigits: hours < 10 ? 1 : 0 }) });
}

const SIZE_UNITS = ["bytes", "kb", "mb", "gb", "tb"] as const;

/** Dateigröße mit Basis 1024: „850 KB“, „12,4 MB“, „1,2 GB“. */
export function formatSize(bytes: number): string {
  let n = bytes, unit = 0;
  for (; n >= 1024 && unit < SIZE_UNITS.length - 1; unit++) n /= 1024;
  return `${n.toLocaleString(currentLanguage(), { maximumFractionDigits: unit && n < 100 ? 1 : 0 })} ${t(`format.size.${SIZE_UNITS[unit]}`)}`;
}

/** Tausender mit schmalem Leerzeichen („3 480“), wie im Mockup; das englische Komma bleibt. */
export const formatCount = (n: number) => {
  const lang = currentLanguage();
  const s = n.toLocaleString(lang);
  return lang === "de" ? s.replace(/\./g, " ") : s;
};

export function formatMemory(mb: number | null): string {
  if (mb == null) return t("format.memoryDefault");
  return `${(mb / 1024).toLocaleString(currentLanguage(), { maximumFractionDigits: 1 })} GB`;
}

const floor512 = (mb: number) => Math.floor(mb / 512) * 512;

/** Standard-Arbeitsspeicher: Hälfte des PCs, auf 512 MB gerundet, zwischen 2 und 8 GB. */
export const autoMemoryMb = (totalMb: number) => Math.min(8192, Math.max(2048, Math.round(totalMb / 1024) * 512));

/** Obergrenze für den Regler: 2 GB bleiben für das System und andere Programme. */
export const maxMemoryMb = (totalMb: number) => Math.max(2048, floor512(totalMb - 2048));

/** Mehr als drei Viertel des PCs: Das System wird knapp. */
export const memoryTooHigh = (mb: number, totalMb: number) => mb > totalMb * 0.75;
