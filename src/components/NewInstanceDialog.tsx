import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Slot } from "radix-ui";
import { useI18n } from "@/i18n";
import {
  Actions, Button, Checkbox, Choice, ConfirmDialog, Count, Dialog, DialogActions, Disclosure, Empty, ErrorBox, Field, Glyph, Hint, Icon, IconButton, Panel,
  ProjectIcon, RowTitle, SearchField, Segmented, Select, Skel, TabPanel, Tabs, TextField, type IconName,
} from "@/ui";
import { MemoryChooser } from "@/components/common";
import { useInstallPack } from "@/components/ContentBrowser";
import { ImportPane } from "@/components/LauncherImport";
import { cancelContent, useContentInstall, useContentState, withTarget } from "@/hooks/useContent";
import { useDebounced } from "@/hooks/useDebounced";
import { useFileDrop } from "@/hooks/useFileDrop";
import { useForeignSelection, useImportInstances } from "@/hooks/useImport";
import { useCreateInstance, useLoaderVersions, useVersions } from "@/hooks/useInstances";
import { useDeleteTemplate, useTemplates } from "@/hooks/useTemplates";
import { api } from "@/lib/api";
import { fileName, formatDate } from "@/lib/format";
import { formatDownloads, isMrpack, MRPACK_EXT, progressLabel } from "@/lib/modrinth";
import { ALL_LOADERS, LOADER_LABELS, type ModLoader, type Template } from "@/lib/types";
import { cn } from "@/lib/utils";

type Tab = "blank" | "pack" | "file" | "tpl" | "import";

// Reiter des Dialogs; Beschriftungen als Schlüssel, übersetzt beim Rendern.
const TABS: { value: Tab; label: string; icon: IconName }[] = [
  { value: "blank", label: "components.newInstance.tab.own", icon: "plus" },
  { value: "pack", label: "components.newInstance.tab.modpack", icon: "box" },
  { value: "file", label: "components.newInstance.tab.file", icon: "file" },
  { value: "tpl", label: "components.newInstance.tab.template", icon: "save" },
  { value: "import", label: "components.newInstance.tab.import", icon: "swap" },
];

// Kurze Erklärung je Loader, steht als Hilfe unter der Wahl.
const LOADER_HELP: Record<ModLoader, string> = {
  vanilla: "components.loader.help.vanilla",
  fabric: "components.loader.help.fabric",
  quilt: "components.loader.help.quilt",
  forge: "components.loader.help.forge",
  neoforge: "components.loader.help.neoforge",
};

const LOADER_ITEMS = ALL_LOADERS.map((l) => ({ value: l, label: LOADER_LABELS[l] }));

// Leerer Wert steht für loaderVersion = null („neueste stabile“).
const LATEST = "latest";

const packName = (path: string) => fileName(path).replace(MRPACK_EXT, "");

/** Modpack aus dem Katalog als neue Instanz: Suche und Auswahlliste. */
function PackPane({ selected, onSelect }: { selected: string | null; onSelect: (p: { id: string; title: string }) => void }) {
  const { t } = useI18n();
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
      <SearchField value={input} onChange={setInput} placeholder={t("components.pack.searchPlaceholder")} autoFocus className="mb-4" />
      {results.error ? (
        <ErrorBox title={t("components.catalog.unreachable")} error={results.error} onRetry={() => void results.refetch()} />
      ) : (
        <div className="flex flex-col gap-1" aria-busy={results.isPending || undefined}>
          {results.isPending && [0, 1, 2, 3].map((k) => <Skel key={k} h={56} />)}
          {results.data?.hits.map((hit) => (
            <Choice
              key={hit.project_id}
              media={<ProjectIcon url={hit.icon_url} seed={hit.project_id} />}
              title={hit.title}
              sub={t("components.search.byAuthorWithDesc", { autor: hit.author, beschreibung: hit.description })}
              trail={<Count value={formatDownloads(hit.downloads)} />}
              selected={selected === hit.project_id}
              onClick={() => onSelect({ id: hit.project_id, title: hit.title })}
            />
          ))}
          {results.data && !results.data.hits.length && <Hint>{t("components.pack.noneFound", { suche: query })}</Hint>}
        </div>
      )}
    </>
  );
}

/** Neue Instanz aus einer gespeicherten Vorlage; Vorlagen lassen sich hier auch löschen. */
function TemplatePane({ selected, onSelect }: { selected: string | null; onSelect: (t: Template | null) => void }) {
  const { t } = useI18n();
  const templates = useTemplates();
  const del = useDeleteTemplate();
  const [toDelete, setToDelete] = useState<Template | null>(null);

  if (templates.error) return <ErrorBox title={t("components.template.loadFailed")} error={templates.error} onRetry={() => void templates.refetch()} />;
  if (templates.isPending)
    return (
      <div className="flex flex-col gap-1">
        {[0, 1].map((k) => <Skel key={k} h={56} />)}
      </div>
    );
  if (!templates.data.length)
    return (
      <Empty ill={<Glyph name="chest" pal="sand" box={64} />} title={t("components.template.noneYet")} size="pane">
        {t("components.template.noneYetHint")}
      </Empty>
    );

  return (
    <>
      <div className="flex flex-col gap-1">
        {templates.data.map((tpl) => (
          <div key={tpl.id} className="flex items-center gap-1">
            <Choice
              className="min-w-0 flex-1"
              media={<Glyph name="chest" pal="sand" />}
              title={tpl.name}
              sub={`${LOADER_LABELS[tpl.loader]} ${tpl.minecraftVersion} · ${t(tpl.modCount === 1 ? "components.template.entryCount.one" : "components.template.entryCount.other", { n: tpl.modCount })} · ${t("components.template.savedAt", { datum: formatDate(tpl.createdAt) })}`}
              selected={selected === tpl.id}
              onClick={() => onSelect(tpl)}
            />
            <IconButton size="s" icon="trash" tone="bad" label={t("components.template.deleteNamed", { name: tpl.name })} tip={t("components.template.delete")} disabled={del.isPending} onClick={() => setToDelete(tpl)} />
          </div>
        ))}
      </div>
      <Hint className="mt-3">{t("components.template.saveHint")}</Hint>
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t("components.template.deleteQuotedTitle", { name: toDelete?.name ?? "" })}
        text={t("components.template.deleteText")}
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
  const { t } = useI18n();
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
  const [customName, setCustomName] = useState("");

  // Vorlage
  const [template, setTemplate] = useState<Template | null>(null);

  // Anderer Launcher
  const foreign = useForeignSelection(tab === "import");
  const importer = useImportInstances();

  const install = useContentInstall();
  const { active, progress } = useContentState();
  const busy = create.isPending || install.isPending || !!packInstall.busy || importer.running;
  useEffect(() => onBusy(busy), [busy, onBusy]);

  async function chooseFile() {
    const [picked] = await api.pickPaths({ filters: [{ name: "Modpack", extensions: ["mrpack"] }] });
    if (picked) setPath(picked);
  }

  const valid =
    tab === "blank" ? !!selectedVersion && !loaderUnavailable
    : tab === "pack" ? !!pack && !packInstall.blocked
    : tab === "file" ? !!path && !api.isMock && !active
    : tab === "import" ? foreign.chosen.length > 0 && !active
    : !!template && !active;

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
      const title = customName.trim() || packName(path);
      install.mutate(withTarget("import", (op) => api.modrinthImportPack(path, title, op), t("components.newInstance.importTask", { name: title }), { cancellable: true }), done);
    } else if (tab === "import") {
      void importer.run(foreign.chosen).then((last) => last && onDone(last.id));
    } else if (template) {
      install.mutate(withTarget(`template:${template.id}`, (op) => api.templateCreateInstance(template.id, template.name, op), t("components.newInstance.createTemplateTask", { name: template.name }), { cancellable: true }), done);
    }
  }

  const goLabel =
    tab === "blank" ? (create.isPending ? t("components.newInstance.creating") : t("components.newInstance.create"))
    : tab === "pack" ? (packInstall.busy ?? t("components.newInstance.create"))
    : install.isPending || importer.running ? progressLabel(progress)
    : tab === "file" ? t("components.newInstance.importLabel")
    : tab === "import" ? (foreign.chosen.length > 1 ? t("components.newInstance.importMany", { n: foreign.chosen.length }) : t("components.newInstance.importLabel"))
    : t("components.newInstance.create");

  // Ein zweiter Vorgang würde still verworfen; deshalb ist der Knopf gesperrt und der Grund steht da.
  const waiting = tab !== "blank" && !!active && !busy;
  const hint =
    waiting ? t("components.newInstance.waitRunning")
    : tab === "blank" ? t("components.newInstance.gameOnFirstStart")
    : tab === "pack" ? (pack ? t("components.newInstance.installInBackground") : t("components.newInstance.pickPack"))
    : tab === "file" ? (path ? t("components.newInstance.fileContentsNote") : t("components.newInstance.supportedMrpack"))
    : tab === "import" ? t("components.newInstance.importNote")
    : template ? t("components.newInstance.noWorldsInTemplate") : t("components.newInstance.pickTemplate");

  const navigate = useNavigate();

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("components.newInstance.title")}
      width={720}
      height={600}
      footLeft={hint}
      footer={
        <>
          {tab === "pack" && packInstall.cancel && (
            <Button variant="ghost" aria-label={t("components.newInstance.cancelInstall")} onClick={packInstall.cancel}>{t("common.cancel")}</Button>
          )}
          {tab === "import" && importer.running && (
            <Button variant="ghost" aria-label={t("components.newInstance.cancelImport")} onClick={cancelContent}>{t("common.cancel")}</Button>
          )}
          <DialogActions cancel={busy ? t("common.close") : t("common.cancel")} confirm={{ label: goLabel, width: 170, disabled: !valid || busy, onClick: go }} />
        </>
      }
    >
      <div className="nwrap">
        <Tabs variant="vertical" idBase="ni" label={t("components.newInstance.tabsLabel")} value={tab} onChange={setTab} items={TABS.map(({ value, label, icon }) => ({ value, label: t(label), icon }))} />
        <TabPanel idBase="ni" value={tab} className="npane">
          {tab === "blank" && (
            <>
              <Field label={t("components.newInstance.nameField")} help={t("components.newInstance.nameHelp")}>
                <TextField
                  value={nameEdited ? name : suggestion}
                  maxLength={64}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameEdited(true);
                  }}
                />
              </Field>
              <Field label={t("components.newInstance.mcVersion")}>
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
                          ? filtered.map((v, k) => ({ value: v.id, label: `${v.id}${v.type !== "release" ? t("components.version.prereleaseSuffix") : k === 0 ? t("components.version.newestSuffix") : ""}` }))
                          : [{ value: "", label: versions.error ? t("components.version.unreachable") : t("components.version.none") }]
                      }
                    />
                  )}
                  <Checkbox checked={snapshots} onChange={setSnapshots}>{t("components.version.showPrereleases")}</Checkbox>
                </Actions>
              </Field>
              <Field
                label={t("components.common.loader")}
                group
                reserveLines={1}
                help={t(LOADER_HELP[loader])}
                error={
                  loaderUnavailable
                    ? loaderVersions.error ? t("components.loader.unreachable", { loader: LOADER_LABELS[loader] }) : t("components.loader.notYetFor", { version: selectedVersion, loader: LOADER_LABELS[loader] })
                    : undefined
                }
              >
                <Segmented label={t("components.common.loader")} value={loader} onChange={setLoader} items={LOADER_ITEMS} />
              </Field>
              <Disclosure summary={t("components.newInstance.advanced")}>
                <Field label={t("components.newInstance.loaderVersion")} group={loader === "vanilla"}>
                  {loader === "vanilla" ? (
                    <span className="text-fg-2">{t("components.loader.notNeededVanilla")}</span>
                  ) : (
                    <Select
                      value={selectedLoader}
                      onChange={setLoaderVersion}
                      disabled={loaderUnavailable || loaderVersions.isPending}
                      options={[
                        { value: LATEST, label: t("components.loader.latestStable") },
                        ...(loaderVersions.data ?? []).map((v) => ({ value: v.version, label: `${v.version}${v.stable ? "" : t("components.version.prereleaseSuffix")}` })),
                      ]}
                    />
                  )}
                </Field>
                <Field label={t("components.newInstance.memory")} group>
                  <MemoryChooser name="ni-ram" value={memory} onChange={setMemory} autoText={t("components.memory.autoFromSettings")} />
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
                {t("components.newInstance.moreInDiscover")}
              </Button>
            </>
          )}

          {tab === "file" &&
            (api.isMock ? (
              <Empty ill="file" title={t("components.newInstance.appOnlyTitle")} size="pane">
                {t("components.newInstance.appOnlyText")}
              </Empty>
            ) : (
              <>
                <div className="drop">
                  <Icon name="ul" size="xl" tone="muted" />
                  <b>{t("components.newInstance.dropHere")}</b>
                  <span>{t("components.common.or")}</span>
                  <Button onClick={() => void chooseFile()}>{t("components.newInstance.chooseFile")}</Button>
                </div>
                {/* Platz bleibt reserviert (unsichtbar), damit nichts springt, wenn eine Datei gewählt wird */}
                <Panel level="raised" className={cn("mt-3 flex h-14 items-center gap-2.5 pr-2 pl-3", !path && "invisible")}>
                  <Glyph name="chest" pal="copper" />
                  <div className="min-w-0 flex-1">
                    <RowTitle title={path ? `${packName(path)}.mrpack` : ""} sub={path} />
                  </div>
                  <IconButton size="s" icon="x" label={t("components.newInstance.removeFile")} disabled={!path} onClick={() => setPath("")} />
                </Panel>
                {path && (
                  <Field label={t("components.newInstance.nameField")} optional className="mt-4">
                    <TextField value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder={packName(path)} maxLength={64} />
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

  // Wer den Dialog geschlossen hat, lässt den Vorgang im Hintergrund laufen und wird nicht mehr weggeholt;
  // „Öffnen“ im Aufgaben-Menü führt zur fertigen Instanz.
  const stillOpen = useRef(open);
  useEffect(() => void (stillOpen.current = open), [open]);
  function done(id: string) {
    if (!stillOpen.current) return;
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
