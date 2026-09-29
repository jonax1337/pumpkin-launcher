import { Link } from "react-router";
import { ArrowRight, Clock, Cpu, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BlockTile, ErrorNote, LoaderBadge, tileHue } from "@/components/common";
import { PlayControl, StatusBadge } from "@/components/game";
import { Onboarding } from "@/components/Onboarding";
import { pickRecentInstance, useInstances, useMemory } from "@/hooks/useInstances";
import { formatMemory, relativeTime } from "@/lib/format";
import { LOADER_LABELS } from "@/lib/types";
import { useSettings } from "@/store/settings";

function HeroSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-6 xl:p-8" aria-busy aria-label="Wird geladen">
      <div className="flex items-center gap-5">
        <Skeleton className="size-16 rounded-xl xl:size-20" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-8 w-2/3 max-w-80" />
          <Skeleton className="h-4 w-1/2 max-w-64" />
        </div>
      </div>
      <Skeleton className="mt-8 h-12 w-44" />
    </div>
  );
}

export function HomePage() {
  const { data: instances, isLoading, error, refetch } = useInstances();
  const recent = pickRecentInstance(instances);
  const memory = useMemory();
  const hasAccount = useSettings((s) => !!s.active);

  if (instances?.length === 0) return <Onboarding needsInstance />;

  const others = instances?.filter((i) => i !== recent).sort((a, b) => (b.lastPlayedAt ?? b.createdAt) - (a.lastPlayedAt ?? a.createdAt)) ?? [];

  return (
    <div className="space-y-8">
      {error && <ErrorNote title="Deine Instanzen konnten nicht geladen werden" error={error} onRetry={() => void refetch()} />}
      {!hasAccount && !isLoading && <Onboarding needsInstance={false} />}

      {isLoading && <HeroSkeleton />}
      {recent && (
        <section
          aria-labelledby="hero-title"
          className="rounded-xl border p-6 xl:p-8"
          // Einziger Verlauf der App: Instanzfarbe mit höchstens 12 % Deckkraft über der Kartenfläche.
          style={{ background: `linear-gradient(120deg, oklch(0.62 0.12 ${tileHue(recent.id)} / 0.12), transparent 65%), var(--card)` }}
        >
          <p className="text-xs font-medium text-muted-foreground">{recent.lastPlayedAt != null ? "Zuletzt gespielt" : "Deine Instanz"}</p>
          <div className="mt-3 flex min-w-0 items-center gap-5">
            <BlockTile seed={recent.id} size="lg" className="xl:size-20" />
            <div className="min-w-0 flex-1">
              <h1 id="hero-title" className="truncate text-3xl font-semibold tracking-tight xl:text-4xl" title={recent.name}>
                {recent.name}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                <StatusBadge instanceId={recent.id} />
                <LoaderBadge loader={recent.loader} />
                <span className="tabular-nums">Minecraft {recent.minecraftVersion}</span>
                {recent.lastPlayedAt != null && (
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="size-3.5" aria-hidden />
                    {relativeTime(recent.lastPlayedAt)}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                  <Cpu className="size-3.5" aria-hidden />
                  {formatMemory(recent.memoryMb ?? memory.value)}
                </span>
              </div>
            </div>
          </div>
          <div className="mt-8 flex flex-wrap items-start gap-3">
            <PlayControl instance={recent} />
            <Button variant="ghost" size="lg" asChild className="h-12 text-muted-foreground">
              <Link to={`/instances/${recent.id}`}>
                <SlidersHorizontal aria-hidden /> Inhalte und Einstellungen
              </Link>
            </Button>
          </div>
        </section>
      )}

      {others.length > 0 && (
        <section aria-labelledby="others-title">
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 id="others-title" className="text-base font-semibold">
              Weitere Instanzen
            </h2>
            <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
              <Link to="/instances">
                Bibliothek <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] xl:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
            {others.slice(0, 6).map((inst) => (
              <li key={inst.id} className="min-w-0">
                <Link
                  to={`/instances/${inst.id}`}
                  className="flex min-w-0 items-center gap-3 rounded-xl border bg-card p-3 outline-none transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <BlockTile seed={inst.id} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium" title={inst.name}>
                      {inst.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground" title={`${LOADER_LABELS[inst.loader]} ${inst.minecraftVersion} · ${relativeTime(inst.lastPlayedAt)}`}>
                      {LOADER_LABELS[inst.loader]} {inst.minecraftVersion} · {relativeTime(inst.lastPlayedAt)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
