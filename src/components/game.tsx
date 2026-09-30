import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button, Chip, ConfirmDialog, Count, Empty, Icon, SearchField, Segmented, Spacer, StatusPanel, Tip, Toolbar, type IconName } from "@/ui";
import { askStop, useCancelInstall, useInstanceStatus, useKill, usePlay, useStopAsk } from "@/hooks/useInstances";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatClock, formatCount, relativeTime } from "@/lib/format";
import { installStepLabel, SUPPORTED_LOADERS, type Instance, type InstallProgress, type InstallStep, type ModLoader } from "@/lib/types";
import { useGame, type LogLine } from "@/store/game";
import { useSettings } from "@/store/settings";

// Reihenfolge der Schritte im Backend (`install::install`, mit Loader umrahmt von `instance_install`)
const VANILLA_STEPS: InstallStep[] = ["java", "client", "libraries", "natives", "assets"];
const stepsFor = (loader: ModLoader): InstallStep[] => (loader === "vanilla" ? VANILLA_STEPS : ["loader", ...VANILLA_STEPS, "mods"]);

/** Gesamtfortschritt 0–100: jeder Schritt zählt gleich, innerhalb des Schritts anteilig. */
function overallPercent(p: InstallProgress, steps: InstallStep[]) {
  const index = Math.max(0, steps.indexOf(p.step));
  const within = p.total > 0 ? p.done / p.total : 0;
  return Math.min(100, Math.round(((index + within) / steps.length) * 100));
}

export type Phase = "loading" | "preparing" | "starting" | "running" | "crashed" | "installed" | "missing";

export function usePhase(instanceId: string): Phase {
  const status = useInstanceStatus(instanceId);
  const preparing = useGame((s) => !!s.installs[instanceId]);
  const launching = useGame((s) => !!s.launching[instanceId]);
  const crashed = useGame((s) => !!s.crashes[instanceId]);
  if (preparing) return "preparing";
  if (status.data?.running) return "running";
  if (launching) return "starting";
  if (crashed) return "crashed";
  // Schlägt die Statusabfrage fehl, gilt die Instanz als nicht installiert; „Spielen“ installiert sie dann.
  if (status.isPending) return "loading";
  return status.data?.installed ? "installed" : "missing";
}

/** Fortschritt einer Instanz (null = keine Installation). */
export function useInstallPercent(instance: Instance) {
  const progress = useGame((s) => s.installs[instance.id]);
  return progress ? overallPercent(progress, stepsFor(instance.loader)) : null;
}

/** Tickt jede Sekunde, solange `on` (für „Läuft seit“). */
function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

/** Laufzeit zum Vorlesen, minutengenau (das Label ändert sich nicht jede Sekunde). */
function spokenSince(ms: number) {
  const m = Math.floor(ms / 60_000), h = Math.floor(m / 60);
  if (m < 1) return "weniger als einer Minute";
  if (h < 1) return m === 1 ? "einer Minute" : `${m} Minuten`;
  return `${h === 1 ? "einer Stunde" : `${h} Stunden`}${m % 60 ? ` ${m % 60} Minuten` : ""}`;
}

type PlayState = { st: "idle" | "prep" | "start" | "run" | "error" | "blocked"; icon: IconName; l1: string; s1: string; l2: ReactNode; p: number | null; pct?: string; dis?: boolean; aria: string };

/**
 * Balken im Spielen-Knopf (`.play .pbar`): segmentierter Fortschritt in den Knopf-Farben
 * (`--prog-on: var(--ink)` auf der Akzentfläche, siehe components/play.css). `p` 0–1, ohne `p` unbestimmt.
 * `label` ist der zugängliche Name; `decorative` blendet ihn aus, wenn derselbe Fortschritt schon anders angesagt wird.
 */
function PlayBar({ p, thin, bad, className, style, label = "Fortschritt", decorative }: { p?: number | null; thin?: boolean; bad?: boolean; className?: string; style?: CSSProperties; label?: string; decorative?: boolean }) {
  const ind = p == null;
  const look = {
    className: cn("prog", thin && "thin", ind && "ind", bad && "bad", className),
    style: { ...style, ["--p" as string]: ind ? 0 : Math.max(0, Math.min(1, p)) },
  };
  if (decorative) return <span aria-hidden {...look} />;
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={ind ? undefined : Math.round(Math.max(0, Math.min(1, p!)) * 100)}
      {...look}
    />
  );
}

/**
 * Große Zeile = Aktion oder laufender Vorgang (Spielen, Wird installiert, Startet, Beenden …).
 * aria-label beginnt mit dem sichtbaren Wort (WCAG 2.5.3), danach Instanz und Stand.
 */
function playState(instance: Instance, phase: Phase, percent: number | null, code: number | null, hasAccount: boolean, runMs: number | null): PlayState {
  const name = instance.name;
  switch (phase) {
    case "preparing":
      // Kein Knopf, sondern Vorgang: Abbrechen steht in der Statuszeile.
      return { st: "prep", icon: "dl", l1: "Wird installiert", s1: "Installiert", l2: "", p: (percent ?? 0) / 100, pct: `${percent ?? 0}%`, dis: true, aria: `Wird installiert: ${name}, ${percent ?? 0} %` };
    case "starting":
      return { st: "start", icon: "hour", l1: "Startet", s1: "Startet", l2: "", p: null, dis: true, aria: `Startet: ${name}` };
    case "running":
      // Groß die Aktion (Klick fragt nach), klein seit wann es läuft.
      return {
        st: "run", icon: "stop", l1: "Beenden", s1: "Beenden",
        l2: runMs != null ? <>Läuft seit <span className="num">{formatClock(runMs)}</span></> : "Läuft",
        p: 0, aria: `Beenden: ${name}, läuft${runMs != null ? ` seit ${spokenSince(runMs)}` : ""}`,
      };
    case "crashed":
      return { st: "error", icon: "redo", l1: "Erneut starten", s1: "Nochmal", l2: `Abgestürzt${code != null ? ` (Code ${code})` : ""}`, p: 0, aria: `Erneut starten: ${name}, abgestürzt` };
    case "loading":
      return { st: "idle", icon: "play", l1: "Spielen", s1: "Spielen", l2: "Einen Moment", p: 0, dis: true, aria: `Spielen: ${name}` };
  }
  if (phase === "missing" && !SUPPORTED_LOADERS.includes(instance.loader))
    return { st: "blocked", icon: "plug", l1: "Kann nicht starten", s1: "Gesperrt", l2: "Diesen Loader kann Pumpkin Launcher noch nicht", p: 0, dis: true, aria: `Kann nicht starten: ${name}, Loader wird noch nicht unterstützt` };
  const [l2, hint] = !hasAccount ? ["Erst Spielernamen festlegen", ", erst Spielernamen festlegen"] : phase === "installed" ? ["Bereit", ""] : ["Installiert beim ersten Start", ", wird beim ersten Start installiert"];
  return { st: "idle", icon: "play", l1: "Spielen", s1: "Spielen", l2, p: 0, aria: `Spielen: ${name}${hint}` };
}

/**
 * Ein Knopf für alles, feste Größe in allen Zuständen: Spielen (installiert bei Bedarf), Wird installiert x %,
 * Startet (beide nicht klickbar), Beenden (Klick fragt „Minecraft beenden?“), Erneut starten nach Absturz.
 * `l` 272×56, `m` 176×40, `i` 32×32.
 */
export function PlayButton({ instance, size = "l", onLaunched, tabIndex }: { instance: Instance; size?: "l" | "m" | "i"; onLaunched?: () => void; tabIndex?: number }) {
  const phase = usePhase(instance.id);
  const progress = useGame((s) => s.installs[instance.id]);
  const code = useGame((s) => s.crashes[instance.id]?.code ?? null);
  const since = useGame((s) => s.started[instance.id]);
  const hasAccount = useSettings((s) => !!s.active);
  const play = usePlay();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => void (mounted.current = false);
  }, []);
  const now = useNow(phase === "running" && !!since);
  const percent = progress ? overallPercent(progress, stepsFor(instance.loader)) : null;
  const s = playState(instance, phase, percent, code, hasAccount, phase === "running" && since ? now - since : null);

  function click() {
    if (s.dis) return;
    if (phase === "running") return askStop(instance);
    void play(instance, () => mounted.current && onLaunched?.());
  }

  const btn = (
    <button
      type="button"
      className={cn("btn btn-p fx play", size !== "l" && size)}
      data-st={s.st}
      aria-label={s.aria}
      aria-disabled={s.dis || undefined}
      tabIndex={tabIndex}
      onClick={click}
    >
      <span className="bf" />
      <span className="bc">
        <span className="pic"><Icon name={s.icon} size={size === "i" ? "s" : size} /></span>
        <span className="lab">
          <span className="l1">{size === "m" ? s.s1 : s.l1}</span>
          <span className="l2">{s.l2}</span>
        </span>
        {/* Symbolknopf (i): Prozent nur im Namen, sonst ragt die Zahl aus den 32 px */}
        {size !== "i" && <span className="pct">{s.pct ?? ""}</span>}
      </span>
      <PlayBar p={s.p} className="pbar" />
    </button>
  );
  return size === "i" ? <Tip label={s.l1}>{btn}</Tip> : btn;
}

/**
 * Statuszeile unter dem Spielen-Knopf (32 px, feste Höhe): Schritt mit Abbrechen, Weg zum Protokoll, Absturz.
 * Die Laufzeit steht im Knopf, nicht hier.
 * Vorgelesen wird nur der Anfang (`lead`, ändert sich mit dem Zustand); Zähler und Uhr stehen außerhalb der Live-Region.
 * Ein fehlender Spielername steht nur im Knopf („Erst Spielernamen festlegen“), „Nicht installiert“ nur im Knopf/Chip.
 * `showLast={false}`: „Zuletzt gespielt“ steht schon woanders (Start: Metazeile im Hero).
 * `onScene`: Knöpfe über einer Szene (Grundplatte, harter Schatten).
 */
export function PlayStatus({ instance, className, style, showLast = true, onScene }: { instance: Instance; className?: string; style?: CSSProperties; showLast?: boolean; onScene?: boolean }) {
  const phase = usePhase(instance.id);
  const progress = useGame((s) => s.installs[instance.id]);
  const crash = useGame((s) => s.crashes[instance.id]);
  const cancel = useCancelInstall();
  const navigate = useNavigate();
  const toLog = () => navigate(`/instances/${instance.id}?tab=console`);

  let lead: ReactNode = null;
  let tail: ReactNode = null;
  let acts: ReactNode = null;
  if (phase === "preparing" && progress) {
    lead = <b>{installStepLabel(progress.step, instance.loader)}</b>;
    if (progress.total > 1) tail = <> {formatCount(progress.done)} von {formatCount(progress.total)}</>;
    acts = <Button variant="ghost" size="s" icon="x" onScene={onScene} className="pcancel" disabled={cancel.isPending} onClick={() => cancel.mutate(instance.id)}>Abbrechen</Button>;
  } else if (phase === "starting") {
    lead = "Minecraft startet.";
    tail = " Das Fenster öffnet sich gleich.";
  } else if (phase === "running") {
    // Laufzeit steht im Knopf („Läuft seit …“); hier nur für Screenreader die Zustandsänderung.
    lead = <span className="sr">Minecraft läuft</span>;
    acts = <Button variant="ghost" size="s" icon="term" onScene={onScene} className="plog" onClick={toLog}>Protokoll ansehen</Button>;
  } else if (phase === "crashed" && crash) {
    lead = <b>Minecraft ist abgestürzt{crash.code != null ? ` (Code ${crash.code})` : ""}</b>;
    acts = (
      <>
        {crash.crashReport && (
          <Button variant="ghost" size="s" tone="bad" onScene={onScene} onClick={() => void api.openPath(crash.crashReport!).catch((e: Error) => toast.error(e.message))}>Absturzbericht öffnen</Button>
        )}
        <Button variant="ghost" size="s" onScene={onScene} onClick={toLog}>Protokoll ansehen</Button>
      </>
    );
  } else if (phase === "installed" && showLast) {
    lead = instance.lastPlayedAt != null ? `Zuletzt gespielt ${relativeTime(instance.lastPlayedAt)}` : "Noch nie gespielt";
  }
  return (
    <div className={cn("pstat", phase === "crashed" && "bad", phase === "running" && "run", className)} style={style}>
      <span className="ptxt">
        <span aria-live="polite">{lead}</span>
        {tail}
      </span>
      {acts}
    </div>
  );
}

/** Zustände, die auffallen sollen; „Bereit“ und „Nicht installiert“ sind der ruhige Normalfall. */
export const LOUD_PHASES: Phase[] = ["preparing", "starting", "running", "crashed"];

/**
 * Status als Chip (Poster, Mini-Karte, Listen-Statusspalte, oben links): Breite nach Inhalt, feste Höhe.
 * Die Prozentzahl steht in Pixelschrift mit fester Stellenbreite, damit der Chip beim Zählen nicht springt.
 * `loudOnly`: im ruhigen Normalfall nichts zeigen. `small`: Chip s (22 px), sonst m (28 px).
 * `fixed` bleibt für Aufrufer erhalten, ohne Wirkung (die Breite folgt dem Inhalt, die Zahl reserviert ihre Stellen).
 */
export function StatusChip({ instance, small, loudOnly }: { instance: Instance; small?: boolean; fixed?: boolean; loudOnly?: boolean }) {
  const phase = usePhase(instance.id);
  const percent = useInstallPercent(instance);
  if (loudOnly && !LOUD_PHASES.includes(phase)) return null;
  const [text, tone]: [ReactNode, "run" | "acc" | "bad" | undefined] =
    phase === "running" ? ["Läuft", "run"]
    : phase === "preparing" ? [<>Wird installiert <Count value={percent ?? 0} minDigits={3} />&nbsp;%</>, "acc"]
    : phase === "starting" ? ["Startet", "acc"]
    : phase === "crashed" ? ["Abgestürzt", "bad"]
    : phase === "missing" ? ["Nicht installiert", undefined]
    : phase === "installed" ? ["Bereit", undefined]
    : ["Wird geprüft", undefined];
  // Text in einem Span: sonst setzt der Chip seinen Flex-Abstand zwischen Wort, Zahl und „%“.
  return <Chip size={small ? "s" : "m"} dot tone={tone}><span>{text}</span></Chip>;
}

/**
 * Rückfrage vor dem harten Beenden („Minecraft beenden?“), einmal global eingehängt (Kontomenü, neben den Konto-Dialogen).
 * Öffnen per `askStop(instance)`. ConfirmDialog: alertdialog, Fokus zuerst auf „Abbrechen“; endet das Spiel von selbst, schließt sich die Frage.
 */
export function StopDialog() {
  const instance = useStopAsk((s) => s.instance);
  const phase = usePhase(instance?.id ?? "");
  const kill = useKill();
  const close = () => useStopAsk.setState({ instance: null });
  const gone = !!instance && phase !== "running" && phase !== "loading";
  useEffect(() => {
    if (gone) close();
  }, [gone]);
  return (
    <ConfirmDialog
      open={!!instance}
      onOpenChange={(o) => !o && close()}
      title="Minecraft beenden?"
      text="Nicht gespeicherter Fortschritt geht verloren. Beende das Spiel besser im Spiel selbst."
      confirmLabel="Beenden"
      pending={kill.isPending}
      onConfirm={() => {
        if (instance) kill.mutate(instance);
        close();
      }}
    />
  );
}

// ---------- Protokoll ----------

type LogFilter = "all" | "warn" | "err";
const LOG_FILTERS: { value: LogFilter; label: string }[] = [{ value: "all", label: "Alle" }, { value: "warn", label: "Warnungen" }, { value: "err", label: "Fehler" }];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Kopfzeile des Protokolls: läuft, abgestürzt oder Ruhe. */
function LogStat({ instance }: { instance: Instance }) {
  const phase = usePhase(instance.id);
  const crash = useGame((s) => s.crashes[instance.id]);
  const since = useGame((s) => s.started[instance.id]);
  const now = useNow(phase === "running");
  // Abstände wie bisher (oben 12, unten 10): die Höhe der Konsole rechnet damit (.console).
  const place = "mt-3 mb-2.5";
  if (phase === "running")
    return (
      <StatusPanel
        size="s"
        tone="run"
        icon="term"
        className={place}
        title={<>Läuft{since && <> seit <Count value={formatClock(now - since)} /></>}.</>}
        actions={<Button size="s" icon="stop" onClick={() => askStop(instance)}>Beenden…</Button>}
      >
        Neue Zeilen erscheinen sofort.
      </StatusPanel>
    );
  if (crash)
    return (
      <StatusPanel
        size="s"
        tone="bad"
        className={place}
        title={`Minecraft ist abgestürzt${crash.code != null ? ` (Code ${crash.code})` : ""}.`}
        actions={crash.crashReport && <Button size="s" onClick={() => void api.openPath(crash.crashReport!).catch((e: Error) => toast.error(e.message))}>Absturzbericht öffnen</Button>}
      >
        {crash.crashReport ? "Der Absturzbericht nennt meist die Ursache." : "Die letzten Zeilen unten zeigen, was passiert ist."}
      </StatusPanel>
    );
  // Wie man zu Ausgabe kommt, sagt der Leerzustand der Konsole; hier nur Stand und Aufbewahrung
  return (
    <StatusPanel size="s" icon="info" className={place} title={instance.lastPlayedAt != null ? `Zuletzt gespielt ${relativeTime(instance.lastPlayedAt)}.` : "Noch nie gespielt."}>
      Das Protokoll wird beim Schließen von Pumpkin Launcher geleert.
    </StatusPanel>
  );
}

const LogRow = memo(function LogRow({ line, re }: { line: LogLine; re: RegExp | null }) {
  const cls = cn("ln", line.tone === "warn" && "w", line.tone === "error" && "e");
  if (!re) return <span className={cls}>{line.line}</span>;
  const parts = line.line.split(re);
  return <span className={cls}>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}</span>;
});

/**
 * Kurzmeldung für Screenreader: neue Warnungen und Fehler seit der letzten Meldung, höchstens alle 5 s.
 * Die Konsole selbst liest nicht mit (aria-live="off"), sonst käme jede Zeile.
 */
function useLogDigest(lines: LogLine[] | undefined) {
  const [msg, setMsg] = useState("");
  const latest = useRef(lines);
  latest.current = lines;
  // Bestand beim Öffnen wird nicht angesagt, nur was danach kommt.
  const seen = useRef(lines?.at(-1)?.id ?? -1);
  const last = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (timer.current !== undefined) return;
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      const all = latest.current ?? [];
      let w = 0, e = 0;
      for (let i = all.length - 1; i >= 0 && all[i].id > seen.current; i--) {
        if (all[i].tone === "warn") w++;
        else if (all[i].tone === "error") e++;
      }
      seen.current = all.at(-1)?.id ?? seen.current;
      if (!w && !e) return;
      last.current = Date.now();
      const parts = [w && `${w} ${w === 1 ? "neue Warnung" : "neue Warnungen"}`, e && `${e} ${e === 1 ? "neuer Fehler" : "neue Fehler"}`].filter(Boolean);
      const text = `Protokoll: ${parts.join(", ")}`;
      // Gleicher Wortlaut wie zuletzt: unsichtbar ändern, damit er erneut angesagt wird.
      setMsg((m) => (m === text ? `${text} ` : text));
    }, Math.max(0, last.current + 5000 - Date.now()));
  }, [lines]);
  useEffect(() => () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  return msg;
}

/** Live-Ausgabe des Spiels mit Filter, Suche und Mitscrollen (solange man unten ist). */
export function LogConsole({ instance }: { instance: Instance }) {
  const lines = useGame((s) => s.logs[instance.id]);
  const clearLog = useGame((s) => s.clearLog);
  const crash = useGame((s) => s.crashes[instance.id]);
  const [filter, setFilter] = useState<LogFilter>("all");
  const [query, setQuery] = useState("");
  const [follow, setFollow] = useState(true);
  const digest = useLogDigest(lines);
  const ref = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();
  const re = useMemo(() => (q ? new RegExp(`(${escapeRe(q)})`, "gi") : null), [q]);
  const shown = useMemo(
    () => (lines ?? []).filter((l) => (filter === "all" || (filter === "warn" ? l.tone !== "normal" : l.tone === "error")) && (!q || l.line.toLowerCase().includes(q))),
    [lines, filter, q],
  );

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [shown, follow]);

  function copy() {
    void navigator.clipboard.writeText((lines ?? []).map((l) => l.line).join("\n")).then(
      () => toast.success("Protokoll kopiert"),
      () => toast.error("Kopieren hat nicht geklappt"),
    );
  }

  return (
    <>
      <LogStat instance={instance} />
      <Toolbar search="s" className="mb-2.5">
        <SearchField size="s" value={query} onChange={setQuery} placeholder="Im Protokoll suchen" />
        <Segmented size="s" label="Filter" value={filter} onChange={setFilter} items={LOG_FILTERS} />
        <Spacer />
        <Button size="s" icon="copy" compactBelow={900} disabled={!lines?.length} onClick={copy}>Kopieren</Button>
        {crash?.logFile && (
          <Button size="s" icon="folder" compactBelow={900} onClick={() => void api.openPath(crash.logFile!).catch((e: Error) => toast.error(e.message))}>Logdatei</Button>
        )}
        <Button size="s" icon="trash" compactBelow={900} disabled={!lines?.length} onClick={() => clearLog(instance.id)}>Leeren</Button>
      </Toolbar>
      <div className="console">
        <div
          ref={ref}
          className="cbody"
          tabIndex={0}
          role="log"
          aria-live="off"
          aria-label="Protokoll"
          onScroll={(e) => {
            const el = e.currentTarget;
            setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
          }}
        >
          {shown.map((l) => <LogRow key={l.id} line={l} re={re} />)}
        </div>
        <div className="none" style={{ visibility: shown.length ? "hidden" : "visible" }}>
          {lines?.length ? (
            <Empty size="pane" ill="search" title="Keine Treffer">Keine Zeilen für diesen Filter.</Empty>
          ) : (
            <Empty size="pane" ill="term" title="Noch keine Ausgabe">Starte die Instanz, dann erscheint hier das Protokoll.</Empty>
          )}
        </div>
        <Button size="s" icon="down" className={cn("down", !follow && "show")} onClick={() => setFollow(true)}>Nach unten</Button>
      </div>
      <span className="sr" role="status">{digest}</span>
    </>
  );
}
