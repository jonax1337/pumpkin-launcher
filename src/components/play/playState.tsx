import type { ReactNode } from "react";
import { t } from "@/i18n";
import type { IconName } from "@/ui";
import { formatClock } from "@/lib/format";
import type { Phase } from "./phase";

/** Was der große Spielen-Knopf in einer Phase zeigt; `state` ist der Schalter für `data-st` in play.css. */
export type PlayState = {
  state: "idle" | "prep" | "start" | "run" | "error";
  icon: IconName;
  /** Große Zeile; `compactLabel` steht im mittleren Knopf (`m`), wo die Phase ohne Zusatz auskommt. */
  label: string;
  compactLabel: string;
  /** Kleine Zeile darunter. */
  detail: ReactNode;
  /** Fortschritt 0–1; `null` = unbestimmt. */
  progress: number | null;
  percentText?: string;
  disabled?: boolean;
  ariaLabel: string;
};

/** Womit die Phase beschrieben wird; nicht jede Phase braucht alles. */
export type PlayContext = {
  instanceName: string;
  percent: number | null;
  exitCode: number | null;
  /** Name des Kontos, mit dem gespielt wird; `null` = noch kein nutzbares Konto. */
  playerName: string | null;
  /** Laufzeit in ms; `null` = unbekannt. */
  runMs: number | null;
};

/** Laufzeit zum Vorlesen, minutengenau (das Label ändert sich nicht jede Sekunde). Reine Funktion, deshalb Modul-`t`. */
function spokenSince(ms: number) {
  const m = Math.floor(ms / 60_000), h = Math.floor(m / 60);
  if (m < 1) return t("components.game.sinceUnderMinute");
  if (h < 1) return t(m === 1 ? "components.game.sinceMinutes.one" : "components.game.sinceMinutes.other", { n: m });
  const hours = t(h === 1 ? "components.game.sinceHours.one" : "components.game.sinceHours.other", { n: h });
  const restMinutes = m % 60 ? ` ${t("components.game.sinceMinutes.other", { n: m % 60 })}` : "";
  return hours + restMinutes;
}

// Kein Knopf, sondern Vorgang: Abbrechen steht in der Statuszeile.
const preparingState = ({ instanceName, percent }: PlayContext): PlayState => ({
  state: "prep",
  icon: "download",
  label: t("components.game.installing"),
  compactLabel: t("components.content.installed"),
  detail: "",
  progress: (percent ?? 0) / 100,
  percentText: `${percent ?? 0}%`,
  disabled: true,
  ariaLabel: t("components.game.ariaInstalling", { name: instanceName, percent: percent ?? 0 }),
});

const startingState = ({ instanceName }: PlayContext): PlayState => ({
  state: "start",
  icon: "hourglass",
  label: t("components.game.starting"),
  compactLabel: t("components.game.starting"),
  detail: "",
  progress: null,
  disabled: true,
  ariaLabel: t("components.game.ariaStarting", { name: instanceName }),
});

// Groß die Aktion (Klick fragt nach), klein seit wann es läuft.
const runningState = ({ instanceName, runMs }: PlayContext): PlayState => ({
  state: "run",
  icon: "stop",
  label: t("components.game.quit"),
  compactLabel: t("components.game.quit"),
  detail: runMs != null
    ? <>{t("components.game.runningSince")} <span className="num">{formatClock(runMs)}</span></>
    : t("components.game.running"),
  progress: 0,
  ariaLabel:
    t("components.game.ariaRunning", { name: instanceName }) +
    (runMs != null ? t("components.game.sinceAria", { time: spokenSince(runMs) }) : ""),
});

const crashedState = ({ instanceName, exitCode }: PlayContext): PlayState => ({
  state: "error",
  icon: "refresh",
  label: t("components.game.restart"),
  compactLabel: t("components.game.onceMore"),
  detail: t("components.game.crashed") + (exitCode != null ? t("components.game.exitCode", { code: exitCode }) : ""),
  progress: 0,
  ariaLabel: t("components.game.ariaCrashed", { name: instanceName }),
});

const loadingState = ({ instanceName }: PlayContext): PlayState => ({
  state: "idle",
  icon: "play",
  label: t("common.play"),
  compactLabel: t("common.play"),
  detail: t("ui.dialog.pending"),
  progress: 0,
  disabled: true,
  ariaLabel: t("components.game.ariaPlay", { name: instanceName }),
});

/** Spielbereit; `notice` ist, was unter „Spielen“ steht, und `hint` die Ergänzung für Screenreader. */
const playableState = ({ instanceName }: PlayContext, notice: { detail: string; hint: string }): PlayState => ({
  state: "idle",
  icon: "play",
  label: t("common.play"),
  compactLabel: t("common.play"),
  detail: notice.detail,
  progress: 0,
  ariaLabel: t("components.game.ariaPlay", { name: instanceName }) + notice.hint,
});

const needsNameNotice = () => ({ detail: t("components.game.needNameFirst"), hint: t("components.game.needNameFirstAria") });

const readyState = (context: PlayContext) =>
  playableState(
    context,
    context.playerName != null
      ? { detail: t("components.game.playsAs", { name: context.playerName }), hint: "" }
      : needsNameNotice(),
  );

const notInstalledState = (context: PlayContext) =>
  playableState(
    context,
    context.playerName != null
      ? { detail: t("components.game.installsOnFirstStart"), hint: t("components.game.installsOnFirstStartAria") }
      : needsNameNotice(),
  );

const STATE_OF_PHASE: Record<Phase, (context: PlayContext) => PlayState> = {
  loading: loadingState,
  preparing: preparingState,
  starting: startingState,
  running: runningState,
  crashed: crashedState,
  installed: readyState,
  missing: notInstalledState,
};

/**
 * Große Zeile = Aktion oder laufender Vorgang (Spielen, Wird installiert, Startet, Beenden …).
 * aria-label beginnt mit dem sichtbaren Wort (WCAG 2.5.3), danach Instanz und Stand.
 */
export const playState = (phase: Phase, context: PlayContext): PlayState => STATE_OF_PHASE[phase](context);
