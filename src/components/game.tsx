import { useLayoutEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Download, Loader2, Play, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useInstall, useInstanceStatus, useKill, useLaunch } from "@/hooks/useInstances";
import { cn } from "@/lib/utils";
import { INSTALL_STEP_LABELS, type Instance, type InstallProgress, type InstallStep } from "@/lib/types";
import { useGame } from "@/store/game";

// Reihenfolge der Vanilla-Schritte im Backend (`install::install`)
const STEPS: InstallStep[] = ["java", "client", "libraries", "natives", "assets"];

/** Gesamtfortschritt 0–100: jeder Schritt zählt gleich, innerhalb des Schritts anteilig. */
function overallPercent(p: InstallProgress) {
  const index = Math.max(0, STEPS.indexOf(p.step));
  const within = p.total > 0 ? p.done / p.total : 0;
  return Math.round(((index + within) / STEPS.length) * 100);
}

type Phase = "loading" | "installing" | "running" | "installed" | "missing";

function usePhase(instanceId: string): Phase {
  const status = useInstanceStatus(instanceId);
  const installing = useGame((s) => !!s.installs[instanceId]);
  if (installing) return "installing";
  if (!status.data) return "loading";
  if (status.data.running) return "running";
  return status.data.installed ? "installed" : "missing";
}

const PHASE_LABEL: Record<Exclude<Phase, "loading">, string> = {
  missing: "Nicht installiert",
  installing: "Wird installiert",
  installed: "Bereit",
  running: "Läuft",
};

const PHASE_TINT: Record<Exclude<Phase, "loading">, string> = {
  missing: "bg-white/5 text-muted-foreground ring-white/10 [&>span]:bg-muted-foreground",
  installing: "bg-gold/10 text-gold ring-gold/25 [&>span]:bg-gold",
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

function InstallBar({ progress, hero }: { progress: InstallProgress; hero?: boolean }) {
  const percent = overallPercent(progress);
  const stepNo = STEPS.indexOf(progress.step) + 1;
  return (
    <div className={cn("space-y-2", hero ? "w-72" : "w-64")} aria-live="polite">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="inline-flex min-w-0 items-center gap-2 font-medium">
          <Loader2 className="size-3.5 shrink-0 animate-spin text-gold" aria-hidden />
          <span className="truncate">{INSTALL_STEP_LABELS[progress.step]}</span>
        </span>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">{percent} %</span>
      </div>
      <Progress
        value={percent}
        aria-label="Installationsfortschritt"
        className={cn("bg-white/10 [&>*]:bg-gold [&>*]:duration-300", hero ? "h-2" : "h-1.5")}
      />
      <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
        Schritt {stepNo}/{STEPS.length}
        {progress.total > 0 && ` · ${progress.done.toLocaleString("de")} / ${progress.total.toLocaleString("de")}`}
      </p>
    </div>
  );
}

/** Installieren → Spielen → Stoppen, je nach Zustand der Instanz. */
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
  const install = useInstall();
  const launch = useLaunch();
  const kill = useKill();

  const size = hero
    ? "h-16 min-w-56 gap-3 rounded-2xl px-8 text-lg font-semibold ring-1 ring-white/20 [&_svg:not([class*='size-'])]:size-5"
    : "min-w-32";

  if (phase === "loading") return <Skeleton className={hero ? "h-16 w-56 rounded-2xl" : "h-9 w-32"} />;
  if (phase === "installing" && progress) return <InstallBar progress={progress} hero={hero} />;

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
        Stoppen
      </Button>
    );
  }

  if (phase === "missing") {
    return (
      <Button
        size={hero ? "lg" : "default"}
        variant={hero ? "default" : "secondary"}
        onClick={() => install.mutate(instance)}
        aria-label={`${instance.name} installieren`}
        className={cn(size, hero && "shadow-[0_10px_40px_-10px_var(--primary)]")}
      >
        <Download aria-hidden /> Installieren
      </Button>
    );
  }

  return (
    <motion.div whileHover={hero ? { scale: 1.02 } : undefined} whileTap={{ scale: 0.98 }}>
      <Button
        size={hero ? "lg" : "default"}
        disabled={launch.isPending}
        onClick={() => launch.mutate(instance, { onSuccess: onLaunched })}
        aria-label={`${instance.name} spielen`}
        className={cn(size, hero && "shadow-[0_10px_40px_-10px_var(--primary)]")}
      >
        {launch.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Play className="fill-current" aria-hidden />}
        {launch.isPending ? "Startet…" : "Spielen"}
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
        <p className="font-mono text-xs text-muted-foreground">
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
            <div key={l.id} className={cn("break-all whitespace-pre-wrap", l.stream === "stderr" ? "text-red-300/90" : "text-foreground/80")}>
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
