import { Link } from "react-router";
import { ArrowRight, Clock, Cpu, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BlockTile, ErrorNote, LoaderBadge, tileHue } from "@/components/common";
import { ContentIcon } from "@/components/ContentBrowser";
import { PlayControl, StatusBadge } from "@/components/game";
import { Onboarding } from "@/components/Onboarding";
import { useProjects } from "@/hooks/useContent";
import { pickRecentInstance, useInstances, useMemory } from "@/hooks/useInstances";
import { formatDate, formatMemory, relativeTime } from "@/lib/format";
import { projectOf } from "@/lib/modrinth";
import { LOADER_LABELS, type Instance, type ModKind } from "@/lib/types";
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

const KIND_COUNT: Record<ModKind, [string, string]> = { mod: ["Mod", "Mods"], shader: ["Shader", "Shader"], resourcepack: ["Ressourcenpaket", "Ressourcenpakete"] };

/** Zweite Hero-Spalte in breiten Fenstern: Eckdaten und die zuletzt selbst hinzugefügten Inhalte (Backend hängt neue hinten an). */
function InstanceFacts({ instance }: { instance: Instance }) {
  const latest = instance.mods.filter((m) => m.requiredBy.length === 0).slice(-4).reverse();
  const projects = useProjects(latest.flatMap((m) => projectOf(m) ?? []));
  const counts = (Object.keys(KIND_COUNT) as ModKind[])
    .map((k) => [k, instance.mods.filter((m) => m.kind === k).length] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${KIND_COUNT[k][n === 1 ? 0 : 1]}`)
    .join(" · ");
  const facts: [string, string][] = [
    ["Inhalte", counts || "Keine"],
    ["Loader", `${LOADER_LABELS[instance.loader]}${instance.loaderVersion ? ` ${instance.loaderVersion}` : ""}`],
    ["Erstellt", formatDate(instance.createdAt)],
  ];
  return (
    <div className="hidden min-w-0 space-y-5 border-l pl-8 xl:block">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="truncate tabular-nums" title={v}>{v}</dd>
          </div>
        ))}
      </dl>
      {latest.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Zuletzt hinzugefügt</p>
          <ul className="space-y-2">
            {latest.map((m) => {
              const project = projects.data?.get(projectOf(m) ?? "");
              const name = project?.title ?? m.name;
              return (
                <li key={m.id} className="flex min-w-0 items-center gap-2.5 text-sm">
                  <ContentIcon url={project?.icon_url} seed={m.id} size="sm" />
                  <span className="truncate" title={name}>{name}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
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
          className="grid gap-8 rounded-xl border p-6 xl:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)] xl:p-8 3xl:min-h-80 3xl:grid-cols-[minmax(0,1fr)_26rem] 3xl:p-10"
          // Einziger Verlauf der App: Instanzfarbe mit höchstens 12 % Deckkraft über der Kartenfläche.
          style={{ background: `linear-gradient(120deg, oklch(0.62 0.12 ${tileHue(recent.id)} / 0.12), transparent 65%), var(--card)` }}
        >
          <div className="flex min-w-0 flex-col">
          <p className="text-xs font-medium text-muted-foreground">{recent.lastPlayedAt != null ? "Zuletzt gespielt" : "Deine Instanz"}</p>
          <div className="mt-3 flex min-w-0 items-center gap-5">
            <BlockTile seed={recent.id} size="lg" className="xl:size-20 3xl:size-28" />
            <div className="min-w-0 flex-1">
              <h1 id="hero-title" className="truncate text-3xl font-semibold tracking-tight xl:text-4xl 3xl:text-5xl" title={recent.name}>
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
          <div className="mt-8 flex flex-wrap items-start gap-3 xl:mt-auto xl:pt-8">
            <PlayControl instance={recent} />
            <Button variant="ghost" size="lg" asChild className="h-12 text-muted-foreground">
              <Link to={`/instances/${recent.id}`}>
                <SlidersHorizontal aria-hidden /> Inhalte und Einstellungen
              </Link>
            </Button>
          </div>
          </div>
          <InstanceFacts instance={recent} />
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
            {others.slice(0, 8).map((inst) => (
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
