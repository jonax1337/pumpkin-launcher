import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Btn, Chip, Progress, SearchField, Seg, Tip } from "@/components/px";
import { openAccounts } from "@/components/PlayerNames";
import { useCancelInstall, useInstanceStatus, useKill, usePlay } from "@/hooks/useInstances";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatClock, formatCount, relativeTime } from "@/lib/format";
import { installStepLabel, SUPPORTED_LOADERS, type Instance, type InstallProgress, type InstallStep, type ModLoader } from "@/lib/types";
import { Icon, type IconName } from "@/pixel/icons";
import { useGame, type LogLine } from "@/store/game";
import { useLook } from "@/store/look";
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
  // Schlägt die Statusabfrage fehl, gilt die Instanz als nicht installiert; „Spielen“ bereitet sie dann vor.
  if (status.isPending) return "loading";
  return status.data?.installed ? "installed" : "missing";
}

/** Fortschritt einer Instanz (null = keine Vorbereitung). */
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

type PlayState = { st: "idle" | "prep" | "start" | "run" | "error" | "blocked"; icon: IconName; l1: string; s1: string; l2: string; p: number | null; pct?: string; dis?: boolean; aria: string };

function playState(instance: Instance, phase: Phase, percent: number | null, step: string, code: number | null, hasAccount: boolean): PlayState {
  const name = instance.name;
  switch (phase) {
    case "preparing":
      return { st: "prep", icon: "dl", l1: "Vorbereiten", s1: "Lädt", l2: step, p: (percent ?? 0) / 100, pct: `${percent ?? 0}%`, aria: `${name} wird vorbereitet, ${percent ?? 0} Prozent` };
    case "starting":
      return { st: "start", icon: "hour", l1: "Startet", s1: "Startet", l2: "Minecraft öffnet sich", p: null, aria: `${name} startet` };
    case "running":
      return { st: "run", icon: "stop", l1: "Läuft", s1: "Stoppen", l2: "Klicken zum Stoppen", p: 0, aria: `${name} läuft. Stoppen` };
    case "crashed":
      return { st: "error", icon: "redo", l1: "Erneut starten", s1: "Nochmal", l2: `Abgestürzt${code != null ? ` (Code ${code})` : ""}`, p: 0, aria: `${name} erneut starten` };
    case "loading":
      return { st: "idle", icon: "play", l1: "Spielen", s1: "Spielen", l2: "Einen Moment", p: 0, dis: true, aria: `${name} spielen` };
  }
  if (phase === "missing" && !SUPPORTED_LOADERS.includes(instance.loader))
    return { st: "blocked", icon: "plug", l1: "Kann nicht starten", s1: "Gesperrt", l2: "Diesen Loader kann Voxlet noch nicht", p: 0, dis: true, aria: "Kann nicht starten" };
  return {
    st: "idle", icon: "play", l1: "Spielen", s1: "Spielen",
    l2: !hasAccount ? "Erst Spielernamen festlegen" : phase === "installed" ? "Bereit" : "Lädt beim ersten Start",
    p: 0, aria: `${name} spielen`,
  };
}

/**
 * Ein Knopf für alles, feste Größe in allen Zuständen: Spielen (installiert bei Bedarf), Vorbereiten mit Prozent,
 * Startet, Läuft (Klick stoppt), Erneut starten nach Absturz. `l` 272×56, `m` 176×40, `i` 32×32.
 */
export function PlayButton({ instance, size = "l", onLaunched, tabIndex }: { instance: Instance; size?: "l" | "m" | "i"; onLaunched?: () => void; tabIndex?: number }) {
  const phase = usePhase(instance.id);
  const progress = useGame((s) => s.installs[instance.id]);
  const code = useGame((s) => s.crashes[instance.id]?.code ?? null);
  const hasAccount = useSettings((s) => !!s.active);
  const { acc } = useLook(instance.id);
  const play = usePlay();
  const kill = useKill();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => void (mounted.current = false);
  }, []);
  const percent = progress ? overallPercent(progress, stepsFor(instance.loader)) : null;
  const step = progress ? installStepLabel(progress.step, instance.loader) : "";
  const s = playState(instance, phase, percent, step, code, hasAccount);

  function click() {
    if (s.dis) return;
    if (phase === "running") return void (!kill.isPending && kill.mutate(instance));
    if (phase === "preparing" || phase === "starting") return;
    void play(instance, () => mounted.current && onLaunched?.());
  }

  const btn = (
    <button
      type="button"
      className={cn("btn btn-p fx play", size !== "l" && size)}
      data-st={s.st}
      style={{ "--acc": acc } as CSSProperties}
      aria-label={s.aria}
      aria-disabled={s.dis || undefined}
      tabIndex={tabIndex}
      onClick={click}
    >
      <span className="bf" />
      <span className="bc">
        <span className="pic"><Icon name={s.icon} /></span>
        <span className="lab">
          <span className="l1">{size === "m" ? s.s1 : s.l1}</span>
          <span className="l2">{s.l2}</span>
        </span>
        <span className="pct">{s.pct ?? ""}</span>
      </span>
      <Progress p={s.p} className="pbar" />
    </button>
  );
  return size === "i" ? <Tip label={s.l1}>{btn}</Tip> : btn;
}

/** Statuszeile unter dem Spielen-Knopf (32 px, feste Höhe): Schritt, Laufzeit, Absturz. */
export function PlayStatus({ instance, className, style }: { instance: Instance; className?: string; style?: CSSProperties }) {
  const phase = usePhase(instance.id);
  const progress = useGame((s) => s.installs[instance.id]);
  const crash = useGame((s) => s.crashes[instance.id]);
  const since = useGame((s) => s.started[instance.id]);
  const hasAccount = useSettings((s) => !!s.active);
  const cancel = useCancelInstall();
  const navigate = useNavigate();
  const now = useNow(phase === "running");
  const toLog = () => navigate(`/instances/${instance.id}?tab=console`);

  let body;
  if (phase === "preparing" && progress) {
    body = (
      <>
        <span className="ptxt">
          <b>{installStepLabel(progress.step, instance.loader)}</b>
          {progress.total > 1 && <> {formatCount(progress.done)} von {formatCount(progress.total)}</>}
        </span>
        <Btn variant="g" size="s" disabled={cancel.isPending} onClick={() => cancel.mutate(instance.id)}>Abbrechen</Btn>
      </>
    );
  } else if (phase === "starting") {
    body = <span className="ptxt">Minecraft startet. Das Fenster öffnet sich gleich.</span>;
  } else if (phase === "running") {
    body = (
      <>
        <span className="ptxt">{since ? <>Läuft seit <b className="num">{formatClock(now - since)}</b></> : "Läuft"}</span>
        <Btn variant="g" size="s" onClick={toLog}>Protokoll ansehen</Btn>
      </>
    );
  } else if (phase === "crashed" && crash) {
    body = (
      <>
        <span className="ptxt"><b>Minecraft ist abgestürzt{crash.code != null ? ` (Code ${crash.code})` : ""}</b></span>
        {crash.crashReport && (
          <Btn variant="g" size="s" tone="bad" onClick={() => void api.openPath(crash.crashReport!).catch((e: Error) => toast.error(e.message))}>Absturzbericht öffnen</Btn>
        )}
        <Btn variant="g" size="s" onClick={toLog}>Protokoll ansehen</Btn>
      </>
    );
  } else if (!hasAccount) {
    body = (
      <>
        <span className="ptxt">Zum Spielen brauchst du einen Spielernamen.</span>
        <Btn variant="g" size="s" tone="acc" onClick={openAccounts}>Festlegen</Btn>
      </>
    );
  } else if (phase === "missing") {
    body = <span className="ptxt">Noch nicht eingerichtet. „Spielen“ lädt alles Nötige.</span>;
  } else if (phase === "installed") {
    body = <span className="ptxt">{instance.lastPlayedAt != null ? `Zuletzt gespielt ${relativeTime(instance.lastPlayedAt)}` : "Noch nie gespielt"}</span>;
  }
  return <div className={cn("pstat", phase === "crashed" && "bad", className)} style={style} aria-live="polite">{body}</div>;
}

/** Status als Chip; `fixed` hält die Breite konstant (kein Springen bei „Wird vorbereitet 34 %“). */
export function StatusChip({ instance, small, fixed }: { instance: Instance; small?: boolean; fixed?: boolean }) {
  const phase = usePhase(instance.id);
  const percent = useInstallPercent(instance);
  const [text, tone]: [string, "run" | "acc" | "bad" | undefined] =
    phase === "running" ? ["Läuft", "run"]
    : phase === "preparing" ? [`Wird vorbereitet${percent != null ? ` ${percent} %` : ""}`, "acc"]
    : phase === "starting" ? ["Startet", "acc"]
    : phase === "crashed" ? ["Abgestürzt", "bad"]
    : phase === "missing" ? ["Nicht installiert", undefined]
    : phase === "installed" ? ["Bereit", undefined]
    : ["Wird geprüft", undefined];
  return <Chip small={small} fixed={fixed} dot tone={tone}>{text}</Chip>;
}

// ---------- Protokoll ----------

type LogFilter = "all" | "warn" | "err";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Kopfzeile des Protokolls: läuft, abgestürzt oder Ruhe. */
function LogStat({ instance }: { instance: Instance }) {
  const phase = usePhase(instance.id);
  const crash = useGame((s) => s.crashes[instance.id]);
  const since = useGame((s) => s.started[instance.id]);
  const kill = useKill();
  const now = useNow(phase === "running");
  if (phase === "running")
    return (
      <div className="logstat run">
        <Icon name="term" />
        <span className="lt"><b>Läuft</b>{since && <> seit <span className="num">{formatClock(now - since)}</span></>}. Neue Zeilen erscheinen sofort.</span>
        <Btn size="s" icon="stop" disabled={kill.isPending} onClick={() => kill.mutate(instance)}>Stoppen</Btn>
      </div>
    );
  if (crash)
    return (
      <div className="logstat bad">
        <Icon name="warn" />
        <span className="lt"><b>Minecraft ist abgestürzt{crash.code != null ? ` (Code ${crash.code})` : ""}.</b> {crash.crashReport ? "Der Absturzbericht nennt meist die Ursache." : "Die letzten Zeilen unten zeigen, was passiert ist."}</span>
        {crash.crashReport && <Btn size="s" onClick={() => void api.openPath(crash.crashReport!).catch((e: Error) => toast.error(e.message))}>Absturzbericht öffnen</Btn>}
      </div>
    );
  return (
    <div className="logstat">
      <Icon name="info" />
      <span className="lt">{instance.lastPlayedAt != null ? `Zuletzt gespielt ${relativeTime(instance.lastPlayedAt)}. ` : ""}Hier erscheint die Ausgabe, solange Voxlet offen ist.</span>
    </div>
  );
}

const LogRow = memo(function LogRow({ line, re }: { line: LogLine; re: RegExp | null }) {
  const cls = cn("ln", line.tone === "warn" && "w", line.tone === "error" && "e");
  if (!re) return <span className={cls}>{line.line}</span>;
  const parts = line.line.split(re);
  return <span className={cls}>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}</span>;
});

/** Live-Ausgabe des Spiels mit Filter, Suche und Mitscrollen (solange man unten ist). */
export function LogConsole({ instance }: { instance: Instance }) {
  const lines = useGame((s) => s.logs[instance.id]);
  const clearLog = useGame((s) => s.clearLog);
  const crash = useGame((s) => s.crashes[instance.id]);
  const [filter, setFilter] = useState<LogFilter>("all");
  const [query, setQuery] = useState("");
  const [follow, setFollow] = useState(true);
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
      <div className="logtool">
        <SearchField small value={query} onChange={setQuery} placeholder="Im Protokoll suchen" />
        <Seg small label="Filter" value={filter} onChange={setFilter} options={[{ value: "all", label: "Alles" }, { value: "warn", label: "Warnungen" }, { value: "err", label: "Fehler" }]} />
        <span className="grow" />
        <Btn size="s" icon="copy" disabled={!lines?.length} onClick={copy}><span className="hide-m">Kopieren</span></Btn>
        {crash?.logFile && (
          <Btn size="s" icon="folder" onClick={() => void api.openPath(crash.logFile!).catch((e: Error) => toast.error(e.message))}><span className="hide-m">Logdatei</span></Btn>
        )}
        <Btn size="s" icon="trash" disabled={!lines?.length} onClick={() => clearLog(instance.id)}><span className="hide-m">Leeren</span></Btn>
      </div>
      <div className="console">
        <div
          ref={ref}
          className="cbody"
          tabIndex={0}
          role="log"
          aria-label="Protokoll"
          onScroll={(e) => {
            const el = e.currentTarget;
            setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
          }}
        >
          {shown.map((l) => <LogRow key={l.id} line={l} re={re} />)}
        </div>
        <div className="none" style={{ visibility: shown.length ? "hidden" : "visible" }}>
          {lines?.length ? "Keine Zeilen für diesen Filter." : "Noch keine Ausgabe. Starte die Instanz, dann erscheint hier das Protokoll."}
        </div>
        <Btn size="s" icon="down2" className={cn("down", !follow && "show")} onClick={() => setFollow(true)}>Nach unten</Btn>
      </div>
    </>
  );
}
