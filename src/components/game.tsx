import { useEffect, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import { Copy, FileText, Loader2, Play, Square, Trash2, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCancelInstall, useInstanceStatus, useKill, usePlay } from "@/hooks/useInstances";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { installStepLabel, SUPPORTED_LOADERS, type Instance, type InstallProgress, type InstallStep, type ModLoader } from "@/lib/types";
import { useGame } from "@/store/game";

// Reihenfolge der Schritte im Backend (`install::install`, mit Loader umrahmt von `instance_install`)
const VANILLA_STEPS: InstallStep[] = ["java", "client", "libraries", "natives", "assets"];
const stepsFor = (loader: ModLoader): InstallStep[] => (loader === "vanilla" ? VANILLA_STEPS : ["loader", ...VANILLA_STEPS, "mods"]);

/** Gesamtfortschritt 0–100: jeder Schritt zählt gleich, innerhalb des Schritts anteilig. */
function overallPercent(p: InstallProgress, steps: InstallStep[]) {
  const index = Math.max(0, steps.indexOf(p.step));
  const within = p.total > 0 ? p.done / p.total : 0;
  return Math.round(((index + within) / steps.length) * 100);
}

const count = (n: number) => n.toLocaleString("de");

/** „Lade Spieldateien … 312 von 3 480“ */
function stepText(p: InstallProgress, loader: ModLoader) {
  const label = installStepLabel(p.step, loader);
  return p.total > 1 ? `${label} … ${count(p.done)} von ${count(p.total)}` : `${label} …`;
}

type Phase = "loading" | "preparing" | "starting" | "running" | "installed" | "missing";

function usePhase(instanceId: string): Phase {
  const status = useInstanceStatus(instanceId);
  const preparing = useGame((s) => !!s.installs[instanceId]);
  const launching = useGame((s) => !!s.launching[instanceId]);
  if (preparing) return "preparing";
  if (status.data?.running) return "running";
  if (launching) return "starting";
  // Schlägt die Statusabfrage fehl, gilt die Instanz als nicht installiert; „Spielen“ bereitet sie dann vor.
  if (status.isPending) return "loading";
  return status.data?.installed ? "installed" : "missing";
}

/** Fortschritt einer Instanz (null = keine Vorbereitung). */
export function useInstallPercent(instance: Instance) {
  const progress = useGame((s) => s.installs[instance.id]);
  return progress ? overallPercent(progress, stepsFor(instance.loader)) : null;
}

const PHASE_LABEL: Record<Exclude<Phase, "loading">, string> = {
  missing: "Nicht installiert",
  preparing: "Wird vorbereitet",
  starting: "Startet",
  installed: "Bereit",
  running: "Läuft",
};

const PHASE_DOT: Record<Exclude<Phase, "loading">, string> = {
  missing: "border border-muted-foreground",
  preparing: "bg-gold",
  starting: "bg-gold",
  installed: "bg-foreground/60",
  running: "bg-primary animate-pulse",
};

/** Status als Punkt + Wort (keine Pille). */
export function StatusBadge({ instanceId, className }: { instanceId: string; className?: string }) {
  const phase = usePhase(instanceId);
  if (phase === "loading") return <Skeleton className={cn("h-4 w-20", className)} />;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", phase === "running" && "text-foreground", className)}>
      <span aria-hidden className={cn("size-2 rounded-full", PHASE_DOT[phase])} />
      {PHASE_LABEL[phase]}
    </span>
  );
}

/**
 * Ein Knopf für alles: Spielen (installiert bei Bedarf), Fortschritt im Knopf mit „Abbrechen“, Stoppen.
 * `size="hero"` ist der große Knopf einer Ansicht (nur einmal pro Ansicht), `size="icon"` der Knopf auf Karten.
 */
export function PlayControl({
  instance,
  size = "hero",
  align = "start",
  onLaunched,
  className,
}: {
  instance: Instance;
  size?: "hero" | "icon";
  align?: "start" | "end";
  onLaunched?: () => void;
  className?: string;
}) {
  const phase = usePhase(instance.id);
  const progress = useGame((s) => s.installs[instance.id]);
  const play = usePlay();
  const kill = useKill();
  const cancel = useCancelInstall();
  // onLaunched (z. B. Tab wechseln) nur, solange der Knopf noch zu sehen ist.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const start = () => void play(instance, () => mounted.current && onLaunched?.());
  const unsupported = phase === "missing" && !SUPPORTED_LOADERS.includes(instance.loader);

  if (size === "icon") {
    if (phase === "loading") return <Skeleton className={cn("size-9", className)} />;
    if (phase === "running")
      return (
        <Button variant="secondary" size="icon" onClick={() => kill.mutate(instance)} disabled={kill.isPending} aria-label={`${instance.name} stoppen`} title="Stoppen" className={cn(className, "opacity-100")}>
          <Square className="fill-current text-destructive" aria-hidden />
        </Button>
      );
    if (phase === "preparing" || phase === "starting")
      return (
        <Button variant="secondary" size="icon" disabled aria-label={`${instance.name} wird vorbereitet`} className={cn(className, "opacity-100 disabled:opacity-100")}>
          <Loader2 className="animate-spin" aria-hidden />
        </Button>
      );
    return (
      <Button size="icon" onClick={start} disabled={unsupported} aria-label={`${instance.name} spielen`} title={unsupported ? "Kann Voxlet noch nicht starten" : "Spielen"} className={className}>
        <Play className="fill-current" aria-hidden />
      </Button>
    );
  }

  const big = "h-12 min-w-44 gap-2.5 px-8 text-base font-semibold [&_svg:not([class*='size-'])]:size-5";
  const wrap = cn("flex min-w-0 flex-col gap-2", align === "end" ? "items-end" : "items-start", className);

  if (phase === "loading") return <Skeleton className={cn("h-12 w-44", className)} />;

  if (phase === "preparing" || phase === "starting") {
    const percent = phase === "preparing" && progress ? overallPercent(progress, stepsFor(instance.loader)) : null;
    return (
      <div className={wrap}>
        <Button
          disabled
          aria-label={percent == null ? `${instance.name} startet` : `${instance.name} wird vorbereitet, ${percent} %`}
          className={cn(big, "relative min-w-56 overflow-hidden bg-primary/20 text-foreground disabled:opacity-100")}
        >
          {percent != null && (
            <span
              aria-hidden
              data-progress
              className="absolute inset-y-0 left-0 bg-primary/45 transition-[width] duration-300 ease-out"
              style={{ width: `${percent}%` }}
            />
          )}
          <Loader2 className="relative animate-spin" aria-hidden />
          <span className="relative tabular-nums">{percent == null ? "Startet …" : `Vorbereiten … ${percent} %`}</span>
        </Button>
        <div className={cn("flex max-w-full items-center gap-2", align === "end" && "flex-row-reverse")}>
          <p className="min-w-0 truncate text-xs text-muted-foreground tabular-nums" aria-live="polite">
            {phase === "preparing" && progress ? stepText(progress, instance.loader) : "Minecraft wird gestartet …"}
          </p>
          {phase === "preparing" && (
            <Button variant="ghost" size="sm" disabled={cancel.isPending} onClick={() => cancel.mutate(instance.id)} className="shrink-0 text-muted-foreground">
              <X aria-hidden /> Abbrechen
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (phase === "running") {
    return (
      <div className={wrap}>
        <Button variant="secondary" disabled={kill.isPending} onClick={() => kill.mutate(instance)} aria-label={`${instance.name} stoppen`} className={big}>
          {kill.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Square className="fill-current text-destructive" aria-hidden />}
          Stoppen
        </Button>
      </div>
    );
  }

  return (
    <div className={wrap}>
      <Button onClick={start} disabled={unsupported} aria-label={`${instance.name} spielen`} className={big}>
        <Play className="fill-current" aria-hidden />
        Spielen
      </Button>
      {unsupported && <p className="text-xs text-muted-foreground">Diese Variante kann Voxlet noch nicht starten.</p>}
    </div>
  );
}

/** Hinweis nach einem Absturz, bis zum nächsten Start. */
export function CrashNotice({ instanceId }: { instanceId: string }) {
  const crash = useGame((s) => s.crashes[instanceId]);
  const clear = useGame((s) => s.clearCrash);
  if (!crash) return null;
  return (
    <div role="alert" className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
      <TriangleAlert className="size-4 shrink-0 text-destructive" aria-hidden />
      <p className="min-w-0 flex-1 font-medium">Minecraft ist abgestürzt{crash.code != null ? ` (Code ${crash.code})` : ""}.</p>
      {crash.crashReport && (
        <Button variant="outline" size="sm" onClick={() => void api.openPath(crash.crashReport!).catch((e: Error) => toast.error(e.message))}>
          <FileText aria-hidden /> Absturzbericht öffnen
        </Button>
      )}
      <Button variant="ghost" size="icon-sm" aria-label="Hinweis schließen" onClick={() => clear(instanceId)}>
        <X aria-hidden />
      </Button>
    </div>
  );
}

/** Live-Ausgabe des Spiels. Scrollt mit, solange man unten ist. */
export function LogConsole({ instanceId }: { instanceId: string }) {
  const lines = useGame((s) => s.logs[instanceId]);
  const clearLog = useGame((s) => s.clearLog);
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  function copy() {
    void navigator.clipboard.writeText((lines ?? []).map((l) => l.line).join("\n")).then(
      () => toast.success("Protokoll kopiert"),
      () => toast.error("Kopieren hat nicht geklappt"),
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-sidebar">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
        <p className="text-xs text-muted-foreground tabular-nums">{lines?.length ? `${count(lines.length)} Zeilen` : "Keine Ausgabe"}</p>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={!lines?.length} onClick={copy}>
            <Copy aria-hidden /> Kopieren
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={!lines?.length} onClick={() => clearLog(instanceId)}>
            <Trash2 aria-hidden /> Leeren
          </Button>
        </div>
      </div>
      <div
        ref={ref}
        role="log"
        aria-label="Spielausgabe"
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
        }}
        className="h-[max(14rem,calc(100dvh-24rem))] overflow-y-auto px-4 py-3 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {lines?.length ? (
          lines.map((l) => (
            <div
              key={l.id}
              className={cn(
                "break-all whitespace-pre-wrap",
                l.stream === "stderr" || /\/(ERROR|FATAL)\]/.test(l.line)
                  ? "text-destructive"
                  : /\/WARN\]/.test(l.line)
                    ? "text-gold"
                    : "text-foreground/80",
              )}
            >
              {l.line}
            </div>
          ))
        ) : (
          <p className="font-sans text-sm text-muted-foreground">Starte das Spiel, dann erscheint hier live, was Minecraft meldet.</p>
        )}
      </div>
    </div>
  );
}
