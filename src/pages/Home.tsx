import { useState } from "react";
import { Link } from "react-router";
import { motion } from "framer-motion";
import { ArrowRight, Clock, Cpu, Loader2, Play, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BlockTile, LoaderBadge } from "@/components/common";
import { pickRecentInstance, useInstances } from "@/hooks/useInstances";
import { MOCK_NEWS } from "@/lib/mock";
import { formatDate, formatMemory, relativeTime } from "@/lib/format";
import { useSettings } from "@/store/settings";

export function HomePage() {
  const { data: instances, isLoading } = useInstances();
  const recent = pickRecentInstance(instances);
  const defaultMemory = useSettings((s) => s.memoryMb);
  const [launching, setLaunching] = useState(false);

  function handlePlay() {
    // Start-Command existiert im Backend noch nicht – nur visuelles Feedback
    setLaunching(true);
    setTimeout(() => setLaunching(false), 1800);
  }

  return (
    <div className="space-y-10">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-emerald-950/70 via-card/80 to-card/60 p-8 shadow-2xl shadow-black/30">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-grid opacity-60 [mask-image:linear-gradient(to_left,black,transparent_65%)]" />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -bottom-32 size-96 rounded-full blur-3xl"
          style={{ background: "radial-gradient(closest-side, oklch(0.8 0.155 158 / 28%), transparent)" }}
        />
        <div className="relative flex flex-wrap items-end justify-between gap-8">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-[0.18em] text-primary uppercase">Zuletzt gespielt</p>
            {isLoading ? (
              <div className="mt-3 h-10 w-64 animate-pulse rounded-lg bg-white/5" />
            ) : recent ? (
              <div className="mt-3 flex items-center gap-4">
                <BlockTile seed={recent.id} size="lg" />
                <div className="min-w-0">
                  <h1 className="truncate text-4xl font-semibold">{recent.name}</h1>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                    <LoaderBadge loader={recent.loader} />
                    <span className="font-mono">{recent.minecraftVersion}</span>
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="size-3.5" aria-hidden />
                      {relativeTime(recent.lastPlayedAt)}
                    </span>
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
            {recent ? (
              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                <Button
                  size="lg"
                  onClick={handlePlay}
                  disabled={launching}
                  aria-label={`${recent.name} spielen`}
                  className="h-16 min-w-56 gap-3 rounded-2xl px-8 text-lg font-semibold shadow-[0_10px_40px_-10px_var(--primary)] ring-1 ring-white/20 [&_svg:not([class*='size-'])]:size-5"
                >
                  {launching ? <Loader2 className="animate-spin" aria-hidden /> : <Play className="fill-current" aria-hidden />}
                  {launching ? "Wird gestartet…" : "Spielen"}
                </Button>
              </motion.div>
            ) : (
              <Button size="lg" asChild className="h-14 rounded-2xl px-6">
                <Link to="/instances">
                  <Plus aria-hidden /> Instanz anlegen
                </Link>
              </Button>
            )}
            {launching && (
              <p className="text-xs text-muted-foreground" role="status">
                Spielstart ist noch nicht angebunden.
              </p>
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
                className="group flex items-center gap-3 rounded-xl border bg-card/60 p-3 transition-colors outline-none hover:border-primary/30 hover:bg-card focus-visible:ring-2 focus-visible:ring-ring"
              >
                <BlockTile seed={inst.id} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{inst.name}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">{inst.minecraftVersion}</span> · {inst.mods.length} Mods
                  </p>
                </div>
                <ArrowRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* News */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">Neuigkeiten</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {MOCK_NEWS.map((n, i) => (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * i + 0.1, duration: 0.3 }}
            >
              <Card className="h-full bg-card/70 transition-colors hover:bg-card">
                <CardHeader>
                  <div className="mb-2 flex items-center justify-between">
                    <Badge variant="outline" className="border-gold/30 text-gold">
                      {n.tag}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{formatDate(n.date)}</span>
                  </div>
                  <CardTitle className="font-heading text-base">{n.title}</CardTitle>
                  <CardDescription>{n.excerpt}</CardDescription>
                </CardHeader>
                <CardContent />
              </Card>
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  );
}
