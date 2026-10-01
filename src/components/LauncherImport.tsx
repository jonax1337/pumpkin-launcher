import { useState } from "react";
import { open as openFolder } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { Button, Chip, Choice, Empty, ErrorBox, Field, Glyph, JobProgress, Skel } from "@/ui";
import { useContentState } from "@/hooks/useContent";
import { importTarget, useForeignInstances } from "@/hooks/useImport";
import { api } from "@/lib/api";
import { progressShare } from "@/lib/modrinth";
import { FOREIGN_LAUNCHER_LABELS, FOREIGN_LAUNCHERS, LOADER_LABELS, type ForeignInstance } from "@/lib/types";

/**
 * Erkannte und per „Ordner wählen…“ ergänzte Instanzen samt Auswahl. Ohne eigene Wahl sind alle gewählt,
 * die noch nicht importiert wurden.
 */
export function useForeignSelection(enabled: boolean) {
  const detected = useForeignInstances(enabled);
  const [added, setAdded] = useState<ForeignInstance[]>([]);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const all = [...(detected.data ?? []), ...added.filter((a) => !detected.data?.some((d) => d.path === a.path))];
  const chosenPaths = picked ?? new Set(all.filter((f) => !f.imported).map((f) => f.path));

  function toggle(source: ForeignInstance) {
    const rest = [...chosenPaths].filter((p) => p !== source.path);
    setPicked(new Set(chosenPaths.has(source.path) ? rest : [...rest, source.path]));
  }

  async function addFolder(folder: string) {
    const found = (await api.importDetect(folder)).filter((f) => !all.some((a) => a.path === f.path));
    if (!found.length) return void toast("In diesem Ordner gibt es keine neuen Instanzen.");
    setAdded((a) => [...a, ...found]);
    setPicked((p) => p && new Set([...p, ...found.filter((f) => !f.imported).map((f) => f.path)]));
  }

  return { detected, all, chosen: all.filter((f) => chosenPaths.has(f.path)), isChosen: (f: ForeignInstance) => chosenPaths.has(f.path), toggle, addFolder };
}

export type ForeignSelection = ReturnType<typeof useForeignSelection>;

/** Import aus anderen Launchern im Dialog „Neue Instanz“: Instanzen nach Launcher gruppiert, Fortschritt in der Zeile. */
export function ImportPane({ selection, busy }: { selection: ForeignSelection; busy: boolean }) {
  const { detected, all } = selection;
  const { active, target, progress } = useContentState();

  async function chooseFolder() {
    const folder = await openFolder({ directory: true, multiple: false, title: "Ordner des Launchers oder einer Instanz" });
    if (folder) await selection.addFolder(folder).catch((e: Error) => toast.error("Der Ordner ließ sich nicht durchsuchen", { description: e.message }));
  }

  const trail = (f: ForeignInstance) =>
    active && target === importTarget(f) ? <JobProgress label="Kopiert" p={progressShare(progress)} width={120} />
    : f.imported ? <Chip>Schon importiert</Chip>
    : undefined;

  return (
    <>
      {detected.error ? (
        <ErrorBox title="Die Suche hat nicht geklappt" error={detected.error} onRetry={() => void detected.refetch()} />
      ) : detected.isPending ? (
        <div className="flex flex-col gap-1">
          {[0, 1, 2].map((k) => <Skel key={k} h={56} />)}
        </div>
      ) : !all.length ? (
        <Empty ill={<Glyph name="chest" pal="sand" box={64} />} title="Keine anderen Launcher gefunden" size="pane">
          Gesucht wurde dort, wo Prism Launcher, Modrinth App, CurseForge App und ATLauncher ihre Instanzen ablegen.
          Liegt dein Launcher woanders, zum Beispiel MultiMC, wähle seinen Ordner.
        </Empty>
      ) : (
        FOREIGN_LAUNCHERS.filter((l) => all.some((f) => f.launcher === l)).map((launcher) => (
          <Field key={launcher} label={FOREIGN_LAUNCHER_LABELS[launcher]} group>
            <div className="flex flex-col gap-1">
              {all.filter((f) => f.launcher === launcher).map((f) => (
                <Choice
                  key={f.path}
                  media={<Glyph name="chest" pal="copper" />}
                  title={f.name}
                  sub={`${LOADER_LABELS[f.loader]} ${f.minecraftVersion}`}
                  trail={trail(f)}
                  selected={selection.isChosen(f)}
                  disabled={busy}
                  onClick={() => selection.toggle(f)}
                />
              ))}
            </div>
          </Field>
        ))
      )}
      <Button variant="ghost" size="s" icon="folder" bleed="start" className="mt-2.5" disabled={api.isMock || busy} onClick={() => void chooseFolder()}>
        Ordner wählen…
      </Button>
    </>
  );
}
