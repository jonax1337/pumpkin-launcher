import { useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BlockTile, PageHeader } from "@/components/common";
import { MOCK_MODS } from "@/lib/mock";
import { SOURCE_LABELS, type ModSourceType } from "@/lib/types";

type SourceFilter = ModSourceType | "all";

export function ModsPage() {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return MOCK_MODS.filter(
      (m) => (source === "all" || m.source.type === source) && (!q || m.name.toLowerCase().includes(q)),
    );
  }, [query, source]);

  return (
    <>
      <PageHeader title="Mods" description="Mods finden und zu Instanzen hinzufügen." />

      <div className="mb-4 rounded-xl border border-gold/25 bg-gold/5 px-4 py-3 text-sm text-gold">
        Modrinth-Anbindung folgt – angezeigt werden Platzhalter-Ergebnisse.
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <div className="relative min-w-64 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label="Mods durchsuchen"
            placeholder="Mods durchsuchen…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-10 pl-9"
          />
        </div>
        <Select value={source} onValueChange={(v) => setSource(v as SourceFilter)}>
          <SelectTrigger aria-label="Quelle filtern" className="h-10! w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Quellen</SelectItem>
            {(Object.keys(SOURCE_LABELS) as ModSourceType[]).map((s) => (
              <SelectItem key={s} value={s}>
                {SOURCE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">
        {results.length} Ergebnisse
      </p>
      <ul className="grid gap-3 md:grid-cols-2">
        {results.map((mod) => (
          <li key={mod.id} className="flex items-center gap-4 rounded-xl border bg-card/60 p-4">
            <BlockTile seed={mod.id} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{mod.name}</p>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary">{SOURCE_LABELS[mod.source.type]}</Badge>
                <span className="font-mono">{mod.version}</span>
              </div>
            </div>
            <Button variant="outline" size="icon" disabled aria-label={`${mod.name} installieren (folgt)`}>
              <Download aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
    </>
  );
}
