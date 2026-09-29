import { useEffect, useLayoutEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Loader2, Play, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useInstanceStatus, useKill, usePlay } from "@/hooks/useInstances";
import { cn } from "@/lib/utils";
import {
  INSTALL_STEP_LABELS,
  INSTALLABLE_LOADERS,
  type Instance,
  type InstallProgress,
  type InstallStep,
  type ModLoader,
} from "@/lib/types";
import { useGame } from "@/store/game";

// Reihenfolge der Schritte im Backend (`install::install`, bei Fabric umrahmt von `instance_install`)
const VANILLA_STEPS: InstallStep[] = ["java", "client", "libraries", "natives", "assets"];
const stepsFor = (loader: ModLoader): InstallStep[] =>
  loader === "fabric" ? ["loader", ...VANILLA_STEPS, "mods"] : VANILLA_STEPS;

/** Gesamtfortschritt 0–100: jeder Schritt zählt gleich, innerhalb des Schritts anteilig. */
function overallPercent(p: InstallProgress, steps: InstallStep[]) {
  const index = Math.max(0, steps.indexOf(p.step));
  const within = p.total > 0 ? p.done / p.total : 0;
  return Math.round(((index + within) / steps.length) * 100);
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

const PHASE_LABEL: Record<Exclude<Phase, "loading">, string> = {
  missing: "Nicht installiert",
  preparing: "Wird vorbereitet",
  starting: "Startet",
  installed: "Bereit",
  running: "Läuft",
};

const PHASE_TINT: Record<Exclude<Phase, "loading">, string> = {
  missing: "bg-white/5 text-muted-foreground ring-white/10 [&>span]:bg-muted-foreground",
  preparing: "bg-gold/10 text-gold ring-gold/25 [&>span]:bg-gold",
  starting: "bg-gold/10 text-gold ring-gold/25 [&>span]:bg-gold",
  installed: "bg-primary/10 text-primary ring-primary/25 [&>span]:bg-primary",
  running: "bg-emerald-400/15 text-emerald-300 ring-emerald-400/30 [&>span]:bg-emerald-300 [&>span]:animate-pulse",
};

export function StatusBadge({ instanceId, className }: { instanceId: string; className?: string }) {
  const phase = usePhase(instanceId);
  if (phase === "loading") return <Skeleton className={cn("h-6 w-24 rounded-full", className)} />;
  return (
    <span
      role="status"
      className={cn(
        "inline-flex h-6 items-center gap-2 rounded-full px-2.5 text-xs font-medium ring-1",
        PHASE_TINT[phase],
        className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full" />
      {PHASE_LABEL[phase]}
    </span>
  );
}

/** Ein Knopf für alles: Spielen (installiert bei Bedarf), Fortschritt beim Vorbereiten, Beenden. */
export function PlayControl({
  instance,
  hero,
  onLaunched,
}: {
  instance: Instance;
  hero?: boolean;
  onLaunched?: () => void;
}) {
  const phase = usePhase(instance.id);
  const progress = useGame((s) => s.installs[instance.id]);
  const play = usePlay();
  const kill = useKill();
  // onLaunched (z. B. Tab wechseln) nur, solange der Knopf noch zu sehen ist.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const size = hero
    ? "h-16 min-w-56 gap-3 rounded-2xl px-8 text-lg font-semibold ring-1 ring-white/20 [&_svg:not([class*='size-'])]:size-5"
    : "min-w-32";

  if (phase === "loading") return <Skeleton className={hero ? "h-16 w-56 rounded-2xl" : "h-9 w-32"} />;

  if (phase === "preparing" || phase === "starting") {
    const percent = phase === "preparing" && progress ? overallPercent(progress, stepsFor(instance.loader)) : null;
    return (
      <div className="flex flex-col items-end gap-1.5">
        <Button
          size={hero ? "lg" : "default"}
          disabled
          aria-label={percent == null ? `${instance.name} startet` : `${instance.name} wird vorbereitet, ${percent} %`}
          className={cn(size, "relative overflow-hidden disabled:opacity-100", hero ? "min-w-72" : "min-w-52")}
        >
          {percent != null && (
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 bg-white/20 transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          )}
          <Loader2 className="relative animate-spin" aria-hidden />
          <span className="relative tabular-nums">
            {percent == null ? "Startet …" : `Wird vorbereitet … ${percent} %`}
          </span>
        </Button>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {phase === "preparing" && progress ? INSTALL_STEP_LABELS[progress.step] : "Minecraft wird gestartet"}
        </p>
      </div>
    );
  }

  if (phase === "running") {
    return (
      <Button
        size={hero ? "lg" : "default"}
        variant="outline"
        disabled={kill.isPending}
        onClick={() => kill.mutate(instance)}
        aria-label={`${instance.name} beenden`}
        className={cn(size, "border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive")}
      >
        {kill.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Square className="fill-current" aria-hidden />}
        Beenden
      </Button>
    );
  }

  if (phase === "missing" && !INSTALLABLE_LOADERS.includes(instance.loader)) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <Button size={hero ? "lg" : "default"} variant="secondary" disabled className={size}>
          <Play className="fill-current" aria-hidden /> Spielen
        </Button>
        <p className="text-xs text-muted-foreground">Diese Variante kann Voxlet noch nicht starten.</p>
      </div>
    );
  }

  return (
    <motion.div whileHover={hero ? { scale: 1.02 } : undefined} whileTap={{ scale: 0.98 }}>
      <Button
        size={hero ? "lg" : "default"}
        onClick={() => void play(instance, () => mounted.current && onLaunched?.())}
        aria-label={`${instance.name} spielen`}
        className={cn(size, hero && "shadow-[0_10px_40px_-10px_var(--primary)]")}
      >
        <Play className="fill-current" aria-hidden />
        Spielen
      </Button>
    </motion.div>
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

  return (
    <div className="overflow-hidden rounded-xl border bg-black/40">
      <div className="flex items-center justify-between border-b bg-white/[0.02] px-4 py-2">
        <p className="text-xs text-muted-foreground">
          {lines?.length ? `${lines.length.toLocaleString("de")} Zeilen` : "Keine Ausgabe"}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-muted-foreground"
          disabled={!lines?.length}
          onClick={() => clearLog(instanceId)}
        >
          <Trash2 aria-hidden /> Leeren
        </Button>
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
        className="h-[420px] overflow-y-auto px-4 py-3 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {lines?.length ? (
          lines.map((l) => (
            <div
              key={l.id}
              className={cn(
                "break-all whitespace-pre-wrap",
                l.stream === "stderr" || /\/(ERROR|FATAL)\]/.test(l.line)
                  ? "text-red-300/90"
                  : /\/WARN\]/.test(l.line)
                    ? "text-gold"
                    : "text-foreground/80",
              )}
            >
              {l.line}
            </div>
          ))
        ) : (
          <p className="text-muted-foreground">Starte das Spiel, um hier die Ausgabe live zu sehen.</p>
        )}
      </div>
    </div>
  );
}
