import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Slot } from "radix-ui";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { Btn, Checkbox, ConfirmDialog, Dialog, DialogClose, Empty, ErrorBox, ProjectIcon, SearchField, Seg, Select, Skel, TextField, Tip } from "@/components/px";
import { MemoryChooser } from "@/components/common";
import { useInstallPack } from "@/components/ContentBrowser";
import { useContentInstall, useContentState, withTarget } from "@/hooks/useContent";
import { useCreateInstance, useLoaderVersions, useVersions } from "@/hooks/useInstances";
import { useDeleteTemplate, useTemplates } from "@/hooks/useTemplates";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { formatDownloads, progressLabel } from "@/lib/modrinth";
import { ALL_LOADERS, LOADER_LABELS, type ModLoader, type Template } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Glyph, Icon, type IconName } from "@/pixel/icons";
import "@/styles/library.css";

type Tab = "blank" | "pack" | "file" | "tpl";

const TABS: { value: Tab; label: string; icon: IconName }[] = [
  { value: "blank", label: "Eigene Instanz", icon: "plus" },
  { value: "pack", label: "Modpack", icon: "box" },
  { value: "file", label: "Datei", icon: "file" },
  { value: "tpl", label: "Vorlage", icon: "save" },
];

const LOADER_HELP: Record<ModLoader, string> = {
  vanilla: "Minecraft pur, ohne Mods.",
  fabric: "Leicht und schnell. Die meisten Leistungs-Mods gibt es für Fabric.",
  quilt: "Wie Fabric, kann auch die meisten Fabric-Mods laden.",
  forge: "Für große, klassische Mods wie Create.",
  neoforge: "Nachfolger von Forge für neuere Versionen.",
};

// Leerer Wert steht für loaderVersion = null („neueste stabile“).
const LATEST = "latest";

const packName = (path: string) => path.split(/[\\/]/).pop()!.replace(/\.mrpack$/i, "");

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
      <div className="nf">
        <SearchField value={input} onChange={setInput} placeholder="Modpacks suchen" autoFocus />
      </div>
      {results.error ? (
        <ErrorBox title="Der Katalog ist gerade nicht erreichbar" error={results.error} onRetry={() => void results.refetch()} />
      ) : (
        <div className="pickl" aria-busy={results.isPending || undefined}>
          {results.isPending && [0, 1, 2, 3].map((k) => <Skel key={k} />)}
          {results.data?.hits.map((hit) => (
            <button
              key={hit.project_id}
              type="button"
              className="pk fx"
              aria-pressed={selected === hit.project_id}
              onClick={() => onSelect({ id: hit.project_id, title: hit.title })}
            >
              <ProjectIcon url={hit.icon_url} seed={hit.project_id} />
              <div className="min-w-0">
                <b>{hit.title}</b>
                <span>von {hit.author} · {hit.description}</span>
              </div>
              <span><span className="num">{formatDownloads(hit.downloads)}</span></span>
            </button>
          ))}
          {results.data && !results.data.hits.length && <p className="muted">Kein Modpack gefunden für „{query}“.</p>}
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
      <div className="pickl">
        {[0, 1].map((k) => <Skel key={k} />)}
      </div>
    );
  if (!templates.data.length)
    return (
      <Empty ill={<Glyph name="chest" pal="sand" big />} title="Noch keine Vorlagen" minHeight={280}>
        Speichere eine Instanz über ihr Menü mit „Als Vorlage speichern“, dann kannst du sie hier als Ausgangspunkt nehmen.
      </Empty>
    );

  return (
    <>
      <div className="pickl">
        {templates.data.map((t) => (
          <div key={t.id} className="pkrow">
            <button type="button" className="pk fx" aria-pressed={selected === t.id} onClick={() => onSelect(t)}>
              <Glyph name="chest" pal="sand" />
              <div className="min-w-0">
                <b>{t.name}</b>
                <span>
                  {LOADER_LABELS[t.loader]} {t.minecraftVersion} · {t.modCount} {t.modCount === 1 ? "Inhalt" : "Inhalte"} · gespeichert {formatDate(t.createdAt)}
                </span>
              </div>
              <span />
            </button>
            <Tip label="Vorlage löschen">
              <Btn variant="g" size="s" iconOnly icon="trash" tone="bad" aria-label={`Vorlage ${t.name} löschen`} disabled={del.isPending} onClick={() => setToDelete(t)} />
            </Tip>
          </div>
        ))}
      </div>
      <p className="help" style={{ marginTop: 12 }}>Vorlagen speicherst du über das Menü einer Instanz: „Als Vorlage speichern“.</p>
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

  const install = useContentInstall();
  const { progress } = useContentState();
  const busy = create.isPending || install.isPending || !!packInstall.busy;
  useEffect(() => onBusy(busy), [busy, onBusy]);

  async function chooseFile() {
    const picked = await openFile({ multiple: false, directory: false, filters: [{ name: "Modpack", extensions: ["mrpack"] }] });
    if (picked) setPath(picked);
  }

  const valid =
    tab === "blank" ? !!selectedVersion && !loaderUnavailable
    : tab === "pack" ? !!pack && !packInstall.blocked
    : tab === "file" ? !!path && !api.isMock
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
    } else if (template) {
      install.mutate(withTarget(`template:${template.id}`, (op) => api.templateCreateInstance(template.id, template.name, op), `${template.name} anlegen`), done);
    }
  }

  const goLabel =
    tab === "blank" ? (create.isPending ? "Wird angelegt" : "Anlegen")
    : tab === "pack" ? (packInstall.busy ?? "Anlegen")
    : install.isPending ? progressLabel(progress)
    : tab === "file" ? "Importieren" : "Anlegen";

  const hint =
    tab === "blank" ? "Das Spiel wird beim ersten Start geladen."
    : tab === "pack" ? (pack ? "Die Installation läuft im Hintergrund." : "Wähle ein Modpack.")
    : tab === "file" ? (path ? "Alle Inhalte aus der Datei werden übernommen." : "Unterstützt: .mrpack")
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
          <DialogClose asChild><Btn>{busy ? "Schließen" : "Abbrechen"}</Btn></DialogClose>
          {tab === "pack" && packInstall.cancel && <Btn variant="g" onClick={packInstall.cancel}>Abbrechen</Btn>}
          <Btn variant="p" full style={{ width: 170 }} disabled={!valid || busy} onClick={go}>{goLabel}</Btn>
        </>
      }
    >
      <div className="nwrap">
        <div className="nnav" role="tablist" aria-label="Weg" aria-orientation="vertical">
          {TABS.map((t) => (
            <button
              key={t.value}
              id={`ni-tab-${t.value}`}
              type="button"
              role="tab"
              className="ptab fx"
              aria-selected={tab === t.value}
              aria-controls="ni-pane"
              onClick={() => setTab(t.value)}
            >
              <Icon name={t.icon} />
              {t.label}
              <i className="tick" />
            </button>
          ))}
        </div>
        <div className="npane" id="ni-pane" role="tabpanel" aria-labelledby={`ni-tab-${tab}`}>
          {tab === "blank" && (
            <>
              <div className="nf">
                <label htmlFor="ni-name">Name</label>
                <TextField
                  id="ni-name"
                  aria-describedby="ni-name-help"
                  value={nameEdited ? name : suggestion}
                  maxLength={64}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameEdited(true);
                  }}
                />
                <span className="help" id="ni-name-help">Vorschlag aus Version und Loader. Du kannst ihn später ändern.</span>
              </div>
              <div className="nf">
                <label htmlFor="ni-mc">Minecraft-Version</label>
                <div className="row flex-wrap">
                  {versions.isPending ? (
                    <Skel style={{ height: 40, width: 220 }} />
                  ) : (
                    <Select
                      id="ni-mc"
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
                  <span className="ni-check" onClick={(e) => e.target === e.currentTarget && setSnapshots(!snapshots)}>
                    <Checkbox checked={snapshots} onChange={setSnapshots} label="Vorabversionen zeigen" />
                    <span onClick={() => setSnapshots(!snapshots)}>Vorabversionen zeigen</span>
                  </span>
                </div>
              </div>
              <div className="nf">
                <span className="fl" id="ni-loader">Loader</span>
                {/* Seg reicht keine Beschreibung durch: die Gruppe darum trägt Label und Hilfetext. */}
                <div role="group" aria-labelledby="ni-loader" aria-describedby="ni-loader-help">
                  <Seg label="Loader" value={loader} onChange={setLoader} options={ALL_LOADERS.map((l) => ({ value: l, label: LOADER_LABELS[l] }))} />
                </div>
                {loaderUnavailable ? (
                  <span className="err-msg" role="alert" id="ni-loader-help">
                    {loaderVersions.error ? `${LOADER_LABELS[loader]} ist gerade nicht erreichbar.` : `Für Minecraft ${selectedVersion} gibt es noch kein ${LOADER_LABELS[loader]}.`}
                  </span>
                ) : (
                  <span className="help" id="ni-loader-help">{LOADER_HELP[loader]}</span>
                )}
              </div>
              <details className="adv">
                <summary><Icon name="chevr" small />Erweitert</summary>
                <div style={{ paddingTop: 10 }}>
                  <div className="nf">
                    <label htmlFor="ni-lv">Loader-Version</label>
                    <div className="row">
                      {loader === "vanilla" ? (
                        <span className="muted">Nicht nötig bei Vanilla</span>
                      ) : (
                        <Select
                          id="ni-lv"
                          value={selectedLoader}
                          onChange={setLoaderVersion}
                          disabled={loaderUnavailable || loaderVersions.isPending}
                          options={[
                            { value: LATEST, label: "Neueste stabile (empfohlen)" },
                            ...(loaderVersions.data ?? []).map((v) => ({ value: v.version, label: `${v.version}${v.stable ? "" : " (Vorabversion)"}` })),
                          ]}
                        />
                      )}
                    </div>
                  </div>
                  <div className="nf">
                    <span className="fl">Arbeitsspeicher</span>
                    <MemoryChooser name="ni-ram" value={memory} onChange={setMemory} autoText="Standard aus den Einstellungen" />
                  </div>
                </div>
              </details>
            </>
          )}

          {tab === "pack" && (
            <>
              <PackPane selected={pack?.id ?? null} onSelect={setPack} />
              <Btn
                variant="g"
                size="s"
                icon="chev"
                style={{ marginTop: 10, marginLeft: -8 }}
                onClick={() => {
                  onOpenChange(false);
                  navigate(pack ? `/discover?projekt=${pack.id}` : "/discover");
                }}
              >
                Mehr in Entdecken
              </Btn>
            </>
          )}

          {tab === "file" &&
            (api.isMock ? (
              <Empty ill={<Icon name="file" />} title="Nur in der App" minHeight={280}>
                Dateien lassen sich nur in der Voxlet-App öffnen, nicht im Browser.
              </Empty>
            ) : (
              <>
                <div className="drop">
                  <Icon name="ul" />
                  <b>.mrpack hierher ziehen</b>
                  <span>oder</span>
                  <Btn onClick={() => void chooseFile()}>Datei auswählen</Btn>
                </div>
                <div className={cn("fileok", path && "show")}>
                  <Glyph name="chest" pal="copper" />
                  <div className="grow">
                    <b className="fn ell">{path ? `${packName(path)}.mrpack` : ""}</b>
                    <span className="fs ell">{path}</span>
                  </div>
                  <Btn variant="g" size="s" iconOnly aria-label="Datei entfernen" onClick={() => setPath("")}>
                    <Icon name="x5" small />
                  </Btn>
                </div>
                {path && (
                  <div className="nf" style={{ marginTop: 16 }}>
                    <label htmlFor="ni-file-name">Name <span className="faint">(optional)</span></label>
                    <TextField id="ni-file-name" value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder={packName(path)} maxLength={64} />
                  </div>
                )}
              </>
            ))}

          {tab === "tpl" && <TemplatePane selected={template?.id ?? null} onSelect={setTemplate} />}
        </div>
      </div>
    </Dialog>
  );
}

/**
 * „Neue Instanz“ um einen beliebigen Auslöser (`children`). Eigene, Modpack, Datei oder Vorlage.
 * Die `primary`-Instanz nimmt aufs Fenster gezogene .mrpack-Dateien und Strg+N (`?neu=1`) an.
 */
export function NewInstanceDialog({ children, primary }: { children: ReactNode; primary?: boolean }) {
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

  useEffect(() => {
    if (api.isMock || !primary) return;
    const unlisten = getCurrentWebview().onDragDropEvent(({ payload }) => {
      const file = payload.type === "drop" ? payload.paths.find((p) => /\.mrpack$/i.test(p)) : undefined;
      if (file) show("file", file);
    });
    return () => void unlisten.then((f) => f());
    // `show` liest nur `busy`; der Listener wird einmal registriert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primary]);

  // Strg+N führt zu /instances?neu=1 (siehe Layout).
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (!primary || !params.has("neu")) return;
    show("blank");
    setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primary, params, setParams]);

  function done(id: string) {
    setOpen(false);
    navigate(`/instances/${id}`);
  }

  return (
    <>
      <Slot.Root onClick={() => show("blank")}>{children}</Slot.Root>
      {(open || busy) && <NewInstanceForm key={session} open={open} onOpenChange={setOpen} initial={initial} onBusy={setBusy} onDone={done} />}
    </>
  );
}
