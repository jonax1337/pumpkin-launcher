import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Slot } from "radix-ui";
import { useI18n, type TKey } from "@/i18n";
import { Button, Dialog, DialogActions, TabPanel, Tabs, type IconName } from "@/ui";
import { useBackgroundTask } from "@/hooks/useBackgroundTask";
import { useFileDrop } from "@/hooks/useFileDrop";
import { useImportInstances } from "@/hooks/useImport";
import { TYPE_ONE_KEYS } from "@/lib/catalog";
import { isMrpack } from "@/lib/mods";
import { progressLabel } from "@/lib/progress";
import { instanceUrl, readNewInstanceStart, type NewInstanceStart } from "@/lib/routes";
import { useContentState } from "@/store/contentState";
import { useBlankTab } from "@/components/newInstance/BlankTab";
import { useFileTab } from "@/components/newInstance/FileTab";
import { useImportTab } from "@/components/newInstance/ImportTab";
import { usePackTab } from "@/components/newInstance/PackTab";
import type { Tab, TabContext, TabModel } from "@/components/newInstance/tab";
import { useTemplateTab } from "@/components/newInstance/TemplateTab";

// Reiter des Dialogs; Beschriftungen als Schlüssel, übersetzt beim Rendern.
const TABS: { value: Tab; label: TKey; icon: IconName }[] = [
  { value: "blank", label: "components.newInstance.tab.own", icon: "grass" },
  { value: "pack", label: TYPE_ONE_KEYS.modpack, icon: "modpack" },
  { value: "file", label: "components.newInstance.tab.file", icon: "file" },
  { value: "tpl", label: "components.newInstance.tab.template", icon: "book" },
  { value: "import", label: "components.newInstance.tab.import", icon: "download" },
];

/**
 * Inhalt des Dialogs. Ist nur eingehängt, solange der Dialog offen ist oder etwas daraus noch läuft,
 * damit Versionslisten erst beim Öffnen geladen werden und laufende Installationen ihr Ende melden.
 */
function NewInstanceForm({ open, onOpenChange, start, onBusy, onDone, onImported }: {
  open: boolean; onOpenChange: (o: boolean) => void; start: NewInstanceStart; onBusy: (busy: boolean) => void;
  onDone: (id: string) => void; onImported: () => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>(start.type);
  const background = useBackgroundTask();
  const importer = useImportInstances();
  const { active, progress } = useContentState();
  const working = background.isPending || importer.running;
  const context: TabContext = {
    tab,
    close: () => onOpenChange(false),
    onCreated: (instance) => onDone(instance.id),
    onImported,
    active: !!active,
    background,
    importer,
    runningLabel: working ? progressLabel(progress) : null,
  };

  // Alle Reiter halten ihren Zustand, auch solange ein anderer gezeigt wird.
  const models: Record<Tab, TabModel> = {
    blank: useBlankTab(context),
    pack: usePackTab(context),
    file: useFileTab(context, start.type === "file" ? start.path : ""),
    tpl: useTemplateTab(context),
    import: useImportTab(context),
  };
  const current = models[tab];
  const busy = working || Object.values(models).some((m) => m.busy);
  useEffect(() => onBusy(busy), [busy, onBusy]);

  const hint = current.queues && active && !busy ? t("components.newInstance.waitRunning") : current.hint;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("components.newInstance.title")}
      size="l"
      height="m"
      footLeft={hint}
      footer={
        <>
          {current.cancel && (
            <Button variant="ghost" aria-label={current.cancel.aria} onClick={current.cancel.onClick}>{t("common.cancel")}</Button>
          )}
          <DialogActions
            cancel={busy ? t("common.close") : t("common.cancel")}
            confirm={{ label: current.label, width: 170, disabled: !current.valid || busy, onClick: current.submit }}
          />
        </>
      }
    >
      <div className="nwrap">
        <Tabs variant="vertical" idBase="ni" label={t("components.newInstance.tabsLabel")} value={tab} onChange={setTab} items={TABS.map(({ value, label, icon }) => ({ value, label: t(label), icon }))} />
        <TabPanel idBase="ni" value={tab} className="npane">{current.renderPane(busy)}</TabPanel>
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
  // Jedes Öffnen beginnt mit einem frischen Formular.
  const [session, setSession] = useState(0);
  const [start, setStart] = useState<NewInstanceStart>({ type: "blank" });
  const navigate = useNavigate();

  function show(next: NewInstanceStart) {
    // Läuft noch etwas aus dem letzten Öffnen, bleibt dessen Stand erhalten.
    if (!busy) {
      setStart(next);
      setSession((s) => s + 1);
    }
    setOpen(true);
  }

  useFileDrop(!!primary, (paths) => {
    const path = paths.find(isMrpack);
    if (path) show({ type: "file", path });
  });

  // Strg+N, ein auf die Inhalte gezogenes Modpack und das Onboarding öffnen den Dialog über die Adresse (lib/routes).
  const [params, setParams] = useSearchParams();
  const showRequested = useEffectEvent((requested: NewInstanceStart) => {
    show(requested);
    setParams({}, { replace: true });
  });
  useEffect(() => {
    const requested = readNewInstanceStart(params);
    if (primary && requested) showRequested(requested);
  }, [primary, params]);

  // Wer den Dialog geschlossen hat, lässt den Vorgang im Hintergrund laufen und wird nicht mehr weggeholt;
  // „Öffnen“ im Aufgaben-Menü führt zur fertigen Instanz.
  const stillOpen = useRef(open);
  useEffect(() => void (stillOpen.current = open), [open]);
  function done(id: string) {
    if (!stillOpen.current) return;
    setOpen(false);
    navigate(instanceUrl(id));
  }
  // Importierte Instanzen zeigt die Bibliothek hervorgehoben; eine einzelne Detailseite würde die übrigen verstecken.
  function doneImporting() {
    if (!stillOpen.current) return;
    setOpen(false);
    navigate("/instances");
  }

  return (
    <>
      {children && <Slot.Root onClick={() => show({ type: "blank" })}>{children}</Slot.Root>}
      {(open || busy) && <NewInstanceForm key={session} open={open} onOpenChange={setOpen} start={start} onBusy={setBusy} onDone={done} onImported={doneImporting} />}
    </>
  );
}
