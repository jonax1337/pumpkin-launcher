import { Link } from "react-router";
import { ArrowRight, Clock, Cpu, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BlockTile, ErrorNote, LoaderBadge } from "@/components/common";
import { PlayControl, StatusBadge } from "@/components/game";
import { Onboarding } from "@/components/Onboarding";
import { pickRecentInstance, useInstances } from "@/hooks/useInstances";
import { formatMemory, relativeTime } from "@/lib/format";
import { useSettings } from "@/store/settings";

export function HomePage() {
  const { data: instances, isLoading, error } = useInstances();
  const recent = pickRecentInstance(instances);
  const defaultMemory = useSettings((s) => s.memoryMb);
  const hasName = useSettings((s) => !!s.offlineName);
  const needsInstance = instances?.length === 0;

  if (needsInstance) return <Onboarding needsInstance />;

  return (
    <div className="space-y-10">
      {error && <ErrorNote error={error} />}
      {!hasName && !isLoading && <Onboarding needsInstance={false} />}
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-emerald-950/60 to-card p-6 lg:p-8">
        <div className="relative flex flex-wrap items-end justify-between gap-8">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-[0.18em] text-primary uppercase">
              {recent?.lastPlayedAt != null ? "Zuletzt gespielt" : "Deine Instanz"}
            </p>
            {isLoading ? (
              <div className="mt-3 flex items-center gap-4">
                <Skeleton className="size-20 rounded-xl" />
                <div className="space-y-3">
                  <Skeleton className="h-9 w-64" />
                  <Skeleton className="h-4 w-48" />
                </div>
              </div>
            ) : recent ? (
              <div className="mt-3 flex items-center gap-4">
                <BlockTile seed={recent.id} size="lg" />
                <div className="min-w-0">
                  <h1 className="truncate text-3xl font-semibold lg:text-4xl">{recent.name}</h1>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                    <StatusBadge instanceId={recent.id} />
                    <LoaderBadge loader={recent.loader} />
                    <span>{recent.minecraftVersion}</span>
                    {recent.lastPlayedAt != null && (
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="size-3.5" aria-hidden />
                        {relativeTime(recent.lastPlayedAt)}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1.5">
                      <Cpu className="size-3.5" aria-hidden />
                      {formatMemory(recent.memoryMb ?? defaultMemory)}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <h1 className="mt-3 text-4xl font-semibold">Noch keine Instanz</h1>
            )}
          </div>

          <div className="flex flex-col items-end gap-3">
            {isLoading ? (
              <Skeleton className="h-16 w-56 rounded-2xl" />
            ) : recent ? (
              <PlayControl instance={recent} hero />
            ) : (
              <Button size="lg" asChild className="h-14 rounded-2xl px-6">
                <Link to="/instances">
                  <Plus aria-hidden /> Instanz anlegen
                </Link>
              </Button>
            )}
            {recent && (
              <Link to={`/instances/${recent.id}`} className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                Inhalte &amp; Einstellungen
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* Schnellzugriff Instanzen */}
      {instances && instances.length > 1 && (
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Deine Instanzen</h2>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/instances">
                Alle anzeigen <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {instances.slice(0, 3).map((inst) => (
              <Link
                key={inst.id}
                to={`/instances/${inst.id}`}
                className="group flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors outline-none hover:border-primary/30 hover:bg-card focus-visible:ring-2 focus-visible:ring-ring"
              >
                <BlockTile seed={inst.id} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{inst.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {inst.minecraftVersion} · {inst.mods.length} Inhalte
                  </p>
                </div>
                <ArrowRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
