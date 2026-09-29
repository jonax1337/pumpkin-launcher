import { useState } from "react";
import { BookmarkPlus, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog, ErrorNote } from "@/components/common";
import { useContentInstall, useContentState } from "@/hooks/useContent";
import { useDeleteTemplate, useTemplates } from "@/hooks/useTemplates";
import { api } from "@/lib/api";
import { progressLabel } from "@/lib/modrinth";
import { LOADER_LABELS, type Template } from "@/lib/types";

/** Neu › Vorlage: neue Instanz aus einer gespeicherten Vorlage. Die Instanz hat danach keine Verbindung zur Vorlage. */
export function TemplatesTab({ onDone }: { onDone: (instanceId: string) => void }) {
  const templates = useTemplates();
  const del = useDeleteTemplate();
  const install = useContentInstall();
  const { active, progress } = useContentState();
  const [running, setRunning] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Template | null>(null);

  function create(t: Template) {
    setRunning(t.id);
    install.mutate((op) => api.templateCreateInstance(t.id, t.name, op), {
      onSuccess: (inst) => inst && onDone(inst.id),
      onSettled: () => setRunning(null),
    });
  }

  if (templates.isLoading) return <Skeleton className="h-24 w-full" />;
  if (templates.error) return <ErrorNote error={templates.error} />;
  if (!templates.data?.length)
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        <BookmarkPlus className="size-5" aria-hidden />
        <p>Noch keine Vorlagen.</p>
        <p className="text-xs">Speichere eine Instanz über ihr Menü ⋯ › „Als Vorlage speichern“, um sie hier als Ausgangspunkt zu nutzen.</p>
      </div>
    );

  return (
    <>
    <ul className="max-h-80 divide-y overflow-y-auto rounded-xl border">
      {templates.data.map((t) => (
        <li key={t.id} className="flex items-center gap-3 p-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{t.name}</p>
            <p className="text-xs text-muted-foreground">
              {LOADER_LABELS[t.loader]} {t.minecraftVersion}
              {t.modCount > 0 && ` · ${t.modCount} Inhalte`}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Vorlage ${t.name} löschen`}
            className="text-muted-foreground hover:text-destructive"
            disabled={del.isPending}
            onClick={() => setToDelete(t)}
          >
            <Trash2 aria-hidden />
          </Button>
          <Button size="sm" disabled={!!active} onClick={() => create(t)}>
            {running === t.id && <Loader2 className="animate-spin" aria-hidden />}
            {running === t.id ? progressLabel(progress) : "Erstellen"}
          </Button>
        </li>
      ))}
    </ul>
    <ConfirmDialog
      open={!!toDelete}
      onOpenChange={(o) => !o && setToDelete(null)}
      title={`Vorlage „${toDelete?.name}" löschen?`}
      description="Instanzen, die aus der Vorlage entstanden sind, bleiben erhalten."
      pending={del.isPending}
      onConfirm={() => toDelete && del.mutate(toDelete.id, { onSuccess: () => setToDelete(null) })}
    />
    </>
  );
}
