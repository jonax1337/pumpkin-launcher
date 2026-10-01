import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Slot } from "radix-ui";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import {
  Actions, Button, Checkbox, Choice, ConfirmDialog, Count, Dialog, DialogActions, Disclosure, Empty, ErrorBox, Field, Glyph, Hint, Icon, IconButton, Panel,
  ProjectIcon, RowTitle, SearchField, Segmented, Select, Skel, TabPanel, Tabs, TextField, type IconName,
} from "@/ui";
import { MemoryChooser } from "@/components/common";
import { useInstallPack } from "@/components/ContentBrowser";
import { ImportPane } from "@/components/LauncherImport";
import { useContentInstall, useContentState, withTarget } from "@/hooks/useContent";
import { useFileDrop } from "@/hooks/useFileDrop";
import { useForeignSelection, useImportInstances } from "@/hooks/useImport";
import { useCreateInstance, useLoaderVersions, useVersions } from "@/hooks/useInstances";
import { useDeleteTemplate, useTemplates } from "@/hooks/useTemplates";
import { api } from "@/lib/api";
import { fileName, formatDate } from "@/lib/format";
import { formatDownloads, isMrpack, progressLabel } from "@/lib/modrinth";
import { ALL_LOADERS, LOADER_LABELS, type ModLoader, type Template } from "@/lib/types";
import { cn } from "@/lib/utils";

type Tab = "blank" | "pack" | "file" | "tpl" | "import";

const TABS: { value: Tab; label: string; icon: IconName }[] = [
  { value: "blank", label: "Eigene Instanz", icon: "plus" },
  { value: "pack", label: "Modpack", icon: "box" },
  { value: "file", label: "Datei", icon: "file" },
  { value: "tpl", label: "Vorlage", icon: "save" },
  { value: "import", label: "Anderer Launcher", icon: "swap" },
];

const LOADER_HELP: Record<ModLoader, string> = {
  vanilla: "Minecraft pur, ohne Mods.",
  fabric: "Leicht und schnell. Die meisten Leistungs-Mods gibt es für Fabric.",
  quilt: "Wie Fabric, kann auch die meisten Fabric-Mods laden.",
  forge: "Für große, klassische Mods wie Create.",
  neoforge: "Nachfolger von Forge für neuere Versionen.",
};

const LOADER_ITEMS = ALL_LOADERS.map((l) => ({ value: l, label: LOADER_LABELS[l] }));

// Leerer Wert steht für loaderVersion = null („neueste stabile“).
const LATEST = "latest";

const packName = (path: string) => fileName(path).replace(/\.mrpack$/i, "");

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Modpack aus dem Katalog als neue Instanz: Suche und Auswahlliste. */
function PackPane({ selected, onSelect }: { selected: string | null; onSelect: (p: { id: string; title: string }) => void }) {
  const [input, setInput] = useState("");
  const query = useDebounced(input.trim(), 300);
  const results = useQuery({
    queryKey: ["modrinth-search", "modpack", query, null, null, "pick"],
    queryFn: () => api.modrinthSearch(query, "modpack", null, null, 0),
    staleTime: 5 * 60_000,
    retry: false,
  });
  return (
    <>
      <SearchField value={input} onChange={setInput} placeholder="Modpacks suchen" autoFocus className="mb-4" />
      {results.error ? (
        <ErrorBox title="Der Katalog ist gerade nicht erreichbar" error={results.error} onRetry={() => void results.refetch()} />
      ) : (
        <div className="flex flex-col gap-1" aria-busy={results.isPending || undefined}>
          {results.isPending && [0, 1, 2, 3].map((k) => <Skel key={k} h={56} />)}
          {results.data?.hits.map((hit) => (
            <Choice
              key={hit.project_id}
              media={<ProjectIcon url={hit.icon_url} seed={hit.project_id} />}
              title={hit.title}
              sub={`von ${hit.author} · ${hit.description}`}
              trail={<Count value={formatDownloads(hit.downloads)} />}
              selected={selected === hit.project_id}
              onClick={() => onSelect({ id: hit.project_id, title: hit.title })}
            />
          ))}
          {results.data && !results.data.hits.length && <Hint>Kein Modpack gefunden für „{query}“.</Hint>}
        </div>
      )}
    </>
  );
}

/** Neue Instanz aus einer gespeicherten Vorlage; Vorlagen lassen sich hier auch löschen. */
function TemplatePane({ selected, onSelect }: { selected: string | null; onSelect: (t: Template | null) => void }) {
  const templates = useTemplates();
  const del = useDeleteTemplate();
  const [toDelete, setToDelete] = useState<Template | null>(null);

  if (templates.error) return <ErrorBox title="Vorlagen konnten nicht geladen werden" error={templates.error} onRetry={() => void templates.refetch()} />;
  if (templates.isPending)
    return (
      <div className="flex flex-col gap-1">
        {[0, 1].map((k) => <Skel key={k} h={56} />)}
      </div>
    );
  if (!templates.data.length)
    return (
      <Empty ill={<Glyph name="chest" pal="sand" box={64} />} title="Noch keine Vorlagen" size="pane">
        Speichere eine Instanz über ihr Menü mit „Als Vorlage speichern“, dann kannst du sie hier als Ausgangspunkt nehmen.
      </Empty>
    );

  return (
    <>
      <div className="flex flex-col gap-1">
        {templates.data.map((t) => (
          <div key={t.id} className="flex items-center gap-1">
            <Choice
              className="min-w-0 flex-1"
              media={<Glyph name="chest" pal="sand" />}
              title={t.name}
              sub={`${LOADER_LABELS[t.loader]} ${t.minecraftVersion} · ${t.modCount} ${t.modCount === 1 ? "Inhalt" : "Inhalte"} · gespeichert ${formatDate(t.createdAt)}`}
              selected={selected === t.id}
              onClick={() => onSelect(t)}
            />
            <IconButton size="s" icon="trash" tone="bad" label={`Vorlage ${t.name} löschen`} tip="Vorlage löschen" disabled={del.isPending} onClick={() => setToDelete(t)} />
          </div>
        ))}
      </div>
      <Hint className="mt-3">Vorlagen speicherst du über das Menü einer Instanz: „Als Vorlage speichern“.</Hint>
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Vorlage „${toDelete?.name ?? ""}“ löschen?`}
        text="Instanzen, die aus der Vorlage entstanden sind, bleiben erhalten."
        pending={del.isPending}
        onConfirm={() =>
          toDelete &&
          del.mutate(toDelete.id, {
            onSuccess: () => {
              if (selected === toDelete.id) onSelect(null);
              setToDelete(null);
            },
          })
        }
      />
    </>
  );
}

/**
 * Inhalt des Dialogs. Ist nur eingehängt, solange der Dialog offen ist oder etwas daraus noch läuft,
 * damit Versionslisten erst beim Öffnen geladen werden und laufende Installationen ihr Ende melden.
 */
function NewInstanceForm({ open, onOpenChange, initial, onBusy, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; initial: { tab: Tab; path: string }; onBusy: (busy: boolean) => void; onDone: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>(initial.tab);

  // Eigene
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [snapshots, setSnapshots] = useState(false);
  const [version, setVersion] = useState("");
  const [loader, setLoader] = useState<ModLoader>("fabric");
  const [loaderVersion, setLoaderVersion] = useState(LATEST);
  const [memory, setMemory] = useState<number | null>(null);
  const versions = useVersions();
  const filtered = versions.data?.filter((v) => v.type === "release" || snapshots) ?? [];
  // Neueste Version vorauswählen, bis der Nutzer selbst wählt
  const selectedVersion = filtered.some((v) => v.id === version) ? version : (filtered[0]?.id ?? "");
  const loaderVersions = useLoaderVersions(loader, selectedVersion);
  // Gewählte Loader-Version verfällt, wenn es sie für die neue Minecraft-Version nicht gibt
  const selectedLoader = loaderVersions.data?.some((v) => v.version === loaderVersion) ? loaderVersion : LATEST;
  const loaderUnavailable = loader !== "vanilla" && (!!loaderVersions.error || loaderVersions.data?.length === 0);
  const suggestion = `${loader === "vanilla" ? "Minecraft" : LOADER_LABELS[loader]} ${selectedVersion}`.trim();
  const create = useCreateInstance();

  // Modpack
  const [pack, setPack] = useState<{ id: string; title: string } | null>(null);
  const packInstall = useInstallPack(pack?.id ?? "", pack?.title ?? "", onDone);

  // Datei
  const [path, setPath] = useState(initial.path);
  const [fileName, setFileName] = useState("");

  // Vorlage
  const [template, setTemplate] = useState<Template | null>(null);

  // Anderer Launcher
  const foreign = useForeignSelection(tab === "import");
  const importer = useImportInstances();

  const install = useContentInstall();
  const { progress } = useContentState();
  const busy = create.isPending || install.isPending || !!packInstall.busy || importer.running;
  useEffect(() => onBusy(busy), [busy, onBusy]);

  async function chooseFile() {
    const picked = await openFile({ multiple: false, directory: false, filters: [{ name: "Modpack", extensions: ["mrpack"] }] });
    if (picked) setPath(picked);
  }

  const valid =
    tab === "blank" ? !!selectedVersion && !loaderUnavailable
    : tab === "pack" ? !!pack && !packInstall.blocked
    : tab === "file" ? !!path && !api.isMock
    : tab === "import" ? foreign.chosen.length > 0
    : !!template;

  function go() {
    if (!valid || busy) return;
    const done = { onSuccess: (inst: { id: string } | null) => inst && onDone(inst.id) };
    if (tab === "blank") {
      create.mutate(
        {
          name: (nameEdited ? name.trim() : "") || suggestion,
          minecraftVersion: selectedVersion,
          loader,
          loaderVersion: selectedLoader === LATEST ? null : selectedLoader,
          memoryMb: memory,
        },
        done,
      );
    } else if (tab === "pack") {
      void packInstall.run();
    } else if (tab === "file") {
      const title = fileName.trim() || packName(path);
      install.mutate(withTarget("import", (op) => api.modrinthImportPack(path, title, op), `${title} importieren`), done);
    } else if (tab === "import") {
      void importer.run(foreign.chosen).then((last) => last && onDone(last.id));
    } else if (template) {
      install.mutate(withTarget(`template:${template.id}`, (op) => api.templateCreateInstance(template.id, template.name, op), `${template.name} anlegen`), done);
    }
  }

  const goLabel =
    tab === "blank" ? (create.isPending ? "Wird angelegt" : "Anlegen")
    : tab === "pack" ? (packInstall.busy ?? "Anlegen")
    : install.isPending || importer.running ? progressLabel(progress)
    : tab === "file" ? "Importieren"
    : tab === "import" ? (foreign.chosen.length > 1 ? `${foreign.chosen.length} importieren` : "Importieren")
    : "Anlegen";

  const hint =
    tab === "blank" ? "Das Spiel wird beim ersten Start geladen."
    : tab === "pack" ? (pack ? "Die Installation läuft im Hintergrund." : "Wähle ein Modpack.")
    : tab === "file" ? (path ? "Alle Inhalte aus der Datei werden übernommen." : "Unterstützt: .mrpack")
    : tab === "import" ? "Welten, Mods und Einstellungen werden kopiert. Der andere Launcher bleibt unverändert."
    : template ? "Welten sind nicht Teil einer Vorlage." : "Wähle eine Vorlage.";

  const navigate = useNavigate();

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Neue Instanz"
      width={720}
      height={600}
      footLeft={hint}
      footer={
        <>
          {tab === "pack" && packInstall.cancel && (
            <Button variant="ghost" aria-label="Installation abbrechen" onClick={packInstall.cancel}>Abbrechen</Button>
          )}
          {tab === "import" && importer.running && (
            <Button variant="ghost" aria-label="Import abbrechen" onClick={importer.cancel}>Abbrechen</Button>
          )}
          <DialogActions cancel={busy ? "Schließen" : "Abbrechen"} confirm={{ label: goLabel, width: 170, disabled: !valid || busy, onClick: go }} />
        </>
      }
    >
      <div className="nwrap">
        <Tabs variant="vertical" idBase="ni" label="Weg" value={tab} onChange={setTab} items={TABS} />
        <TabPanel idBase="ni" value={tab} className="npane">
          {tab === "blank" && (
            <>
              <Field label="Name" help="Vorschlag aus Version und Loader. Du kannst ihn später ändern.">
                <TextField
                  value={nameEdited ? name : suggestion}
                  maxLength={64}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameEdited(true);
                  }}
                />
              </Field>
              <Field label="Minecraft-Version">
                <Actions gap={12} wrap>
                  {versions.isPending ? (
                    <Skel w={220} h={40} />
                  ) : (
                    <Select
                      value={selectedVersion}
                      onChange={setVersion}
                      disabled={!filtered.length}
                      options={
                        filtered.length
                          ? filtered.map((v, k) => ({ value: v.id, label: `${v.id}${v.type !== "release" ? " (Vorabversion)" : k === 0 ? " (neueste)" : ""}` }))
                          : [{ value: "", label: versions.error ? "Versionen gerade nicht erreichbar" : "Keine Versionen" }]
                      }
                    />
                  )}
                  <Checkbox checked={snapshots} onChange={setSnapshots}>Vorabversionen zeigen</Checkbox>
                </Actions>
              </Field>
              <Field
                label="Loader"
                group
                reserveLines={1}
                help={LOADER_HELP[loader]}
                error={
                  loaderUnavailable
                    ? loaderVersions.error ? `${LOADER_LABELS[loader]} ist gerade nicht erreichbar.` : `Für Minecraft ${selectedVersion} gibt es noch kein ${LOADER_LABELS[loader]}.`
                    : undefined
                }
              >
                <Segmented label="Loader" value={loader} onChange={setLoader} items={LOADER_ITEMS} />
              </Field>
              <Disclosure summary="Erweitert">
                <Field label="Loader-Version" group={loader === "vanilla"}>
                  {loader === "vanilla" ? (
                    <span className="text-fg-2">Nicht nötig bei Vanilla</span>
                  ) : (
                    <Select
                      value={selectedLoader}
                      onChange={setLoaderVersion}
                      disabled={loaderUnavailable || loaderVersions.isPending}
                      options={[
                        { value: LATEST, label: "Neueste stabile (empfohlen)" },
                        ...(loaderVersions.data ?? []).map((v) => ({ value: v.version, label: `${v.version}${v.stable ? "" : " (Vorabversion)"}` })),
                      ]}
                    />
                  )}
                </Field>
                <Field label="Arbeitsspeicher" group>
                  <MemoryChooser name="ni-ram" value={memory} onChange={setMemory} autoText="Standard aus den Einstellungen" />
                </Field>
              </Disclosure>
            </>
          )}

          {tab === "pack" && (
            <>
              <PackPane selected={pack?.id ?? null} onSelect={setPack} />
              <Button
                variant="ghost"
                size="s"
                icon="chev"
                bleed="start"
                className="mt-2.5"
                onClick={() => {
                  onOpenChange(false);
                  navigate(pack ? `/discover?projekt=${pack.id}` : "/discover");
                }}
              >
                Mehr in Entdecken
              </Button>
            </>
          )}

          {tab === "file" &&
            (api.isMock ? (
              <Empty ill="file" title="Nur in der App" size="pane">
                Dateien lassen sich nur in der Pumpkin Launcher-App öffnen, nicht im Browser.
              </Empty>
            ) : (
              <>
                <div className="drop">
                  <Icon name="ul" size="xl" tone="muted" />
                  <b>.mrpack hierher ziehen</b>
                  <span>oder</span>
                  <Button onClick={() => void chooseFile()}>Datei auswählen</Button>
                </div>
                {/* Platz bleibt reserviert (unsichtbar), damit nichts springt, wenn eine Datei gewählt wird */}
                <Panel level="raised" className={cn("mt-3 flex h-14 items-center gap-2.5 pr-2 pl-3", !path && "invisible")}>
                  <Glyph name="chest" pal="copper" />
                  <div className="min-w-0 flex-1">
                    <RowTitle title={path ? `${packName(path)}.mrpack` : ""} sub={path} />
                  </div>
                  <IconButton size="s" icon="x" label="Datei entfernen" disabled={!path} onClick={() => setPath("")} />
                </Panel>
                {path && (
                  <Field label="Name" optional className="mt-4">
                    <TextField value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder={packName(path)} maxLength={64} />
                  </Field>
                )}
              </>
            ))}

          {tab === "tpl" && <TemplatePane selected={template?.id ?? null} onSelect={setTemplate} />}

          {tab === "import" && <ImportPane selection={foreign} busy={busy} />}
        </TabPanel>
      </div>
    </Dialog>
  );
}

/**
 * „Neue Instanz“ um einen beliebigen Auslöser (`children`): Eigene, Modpack, Datei, Vorlage oder anderer Launcher.
 * Die `primary`-Instanz der Bibliothek braucht keinen Auslöser: Sie öffnet über `?neu=1` (Strg+N, Knöpfe der Bibliothek)
 * bzw. `?neu=import` (Onboarding) und nimmt aufs Fenster gezogene .mrpack-Dateien an.
 */
export function NewInstanceDialog({ children, primary }: { children?: ReactNode; primary?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState(0);
  const [initial, setInitial] = useState<{ tab: Tab; path: string }>({ tab: "blank", path: "" });
  const navigate = useNavigate();

  function show(tab: Tab, path = "") {
    // Läuft noch etwas aus dem letzten Öffnen, bleibt dessen Stand erhalten.
    if (!busy) {
      setInitial({ tab, path });
      setSession((s) => s + 1);
    }
    setOpen(true);
  }

  useFileDrop(!!primary, (paths) => {
    const file = paths.find(isMrpack);
    if (file) show("file", file);
  });

  // Strg+N führt zu /instances?neu=1 (siehe Layout), ein auf die Inhalte gezogenes Modpack zu ?neu=1&datei=<Pfad>,
  // das Onboarding zu ?neu=import.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (!primary || !params.has("neu")) return;
    const file = params.get("datei");
    if (file) show("file", file);
    else show(params.get("neu") === "import" ? "import" : "blank");
    setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primary, params, setParams]);

  function done(id: string) {
    setOpen(false);
    navigate(`/instances/${id}`);
  }

  return (
    <>
      {children && <Slot.Root onClick={() => show("blank")}>{children}</Slot.Root>}
      {(open || busy) && <NewInstanceForm key={session} open={open} onOpenChange={setOpen} initial={initial} onBusy={setBusy} onDone={done} />}
    </>
  );
}
