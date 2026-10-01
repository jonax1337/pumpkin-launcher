// Import mit Endung: Dieses Modul lädt auch das plain-node-Prüf-Skript (kein Bundler, der Auflösung macht).
import { t } from "../i18n/core.ts";

/** Abschnitte eines Vorgangs, genau die Namen von `services::progress::Phase` im Backend (kleingeschrieben). */
export type ContentPhase = "resolve" | "validate" | "download" | "extract" | "copy" | "pack" | "hash" | "backup" | "complete";

export interface ContentProgress { operationId: string; phase: ContentPhase; done: number; total: number }

interface PhaseInfo {
  /** Fortschritt in Alltagssprache statt „resolve: 0 / 1“. */
  label: (done: number, total: number) => string;
  /** Ein Wort für schmale Fortschrittsanzeigen in einer Zeile. */
  short: () => string;
  /** Hat eine bekannte Menge (Downloads, kopierte, erkannte und gesicherte Dateien): ein Balken zeigt den Anteil. */
  hasShare: boolean;
}

/** Phase mit festem Text, ohne Menge. */
const plain = (key: string, shortKey: string): PhaseInfo => ({ label: () => t(key), short: () => t(shortKey), hasShare: false });

/** Phase mit „n von m“, solange die Menge bekannt ist. */
const counted = (key: string, indeterminateKey: string, shortKey: string): PhaseInfo => ({
  label: (done, total) => (total ? t(key, { done, total }) : t(indeterminateKey)),
  short: () => t(shortKey),
  hasShare: true,
});

const checking = plain("components.job.checking", "components.common.checking");
const complete = plain("common.done", "common.done");

const PHASES: Record<ContentPhase, PhaseInfo> = {
  resolve: checking,
  validate: checking,
  download: {
    label: (done, total) =>
      total ? t("components.job.downloading", { done: Math.min(done + 1, total), total }) : t("components.job.downloadingIndeterminate"),
    short: () => t("components.job.downloadingShort"),
    hasShare: true,
  },
  extract: plain("components.job.extracting", "components.job.extractingShort"),
  copy: counted("components.job.copying", "components.job.copyingIndeterminate", "components.job.copyingShort"),
  // Das Packen hat kein eigenes Kurzwort: schmale Anzeigen zeigen wie beim Abschluss „Fertig“.
  pack: plain("components.job.packing", "common.done"),
  hash: counted("components.job.detecting", "components.job.detectingIndeterminate", "components.job.detectingShort"),
  backup: counted("components.job.backingUp", "components.job.backingUpIndeterminate", "components.job.backingUpShort"),
  complete,
};

/** Ohne Fortschritt (Vorgang gerade gestartet) gilt „wird geprüft“. */
const phaseInfo = (p: ContentProgress | null): PhaseInfo => PHASES[p?.phase ?? "resolve"];

export const progressLabel = (p: ContentProgress | null): string => phaseInfo(p).label(p?.done ?? 0, p?.total ?? 0);

/** Ein Wort für schmale Fortschrittsanzeigen in einer Zeile (statt `progressLabel`). */
export const progressShortLabel = (p: ContentProgress | null): string => phaseInfo(p).short();

/** Anteil für Fortschrittsbalken; nur Phasen mit bekannter Menge (Downloads, kopierte, erkannte und gesicherte Dateien). */
export const progressShare = (p: ContentProgress | null): number | null =>
  p && PHASES[p.phase].hasShare && p.total ? Math.min(1, p.done / p.total) : null;
