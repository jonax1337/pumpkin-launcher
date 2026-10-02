import { useState } from "react";
import { useI18n } from "@/i18n";
import { Button, Empty, Field, Glyph, Icon, IconButton, Panel, RowTitle, TextField } from "@/ui";
import { api } from "@/lib/api";
import { TYPE_ONE_KEYS } from "@/lib/catalog";
import { fileName } from "@/lib/format";
import { CURSEFORGE_PACK_EXT, isMrpack, MRPACK_EXT } from "@/lib/mods";
import { cn } from "@/lib/utils";
import type { TabContext, TabModel } from "./tab";

const packName = (path: string) => fileName(path).replace(MRPACK_EXT, "").replace(CURSEFORGE_PACK_EXT, "");

/** `.mrpack` liest das Backend als Modrinth-Pack, eine `.zip` als CurseForge-Pack (mit `manifest.json`). */
const importPack = (path: string, name: string, operationId: string) =>
  isMrpack(path) ? api.modrinthImportPack(path, name, operationId) : api.curseforgeImportPack(path, name, operationId);

function FilePane({ path, customName, setPath, setCustomName }: {
  path: string; customName: string; setPath: (path: string) => void; setCustomName: (name: string) => void;
}) {
  const { t } = useI18n();

  async function chooseFile() {
    const [picked] = await api.pickPaths({ filters: [{ name: t(TYPE_ONE_KEYS.modpack), extensions: ["mrpack", "zip"] }] });
    if (picked) setPath(picked);
  }

  if (!api.capabilities.pickPaths) {
    return (
      <Empty title={t("components.newInstance.appOnlyTitle")} size="pane">
        {t("components.newInstance.appOnlyText")}
      </Empty>
    );
  }
  return (
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
          <RowTitle title={path ? fileName(path) : ""} sub={path} />
        </div>
        <IconButton size="s" icon="x" label={t("components.newInstance.removeFile")} disabled={!path} onClick={() => setPath("")} />
      </Panel>
      {path && (
        <Field label={t("common.name")} optional className="mt-4">
          <TextField value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder={packName(path)} maxLength={64} />
        </Field>
      )}
    </>
  );
}

/** Reiter „Datei“: ein .mrpack (Modrinth) oder eine .zip (CurseForge) als Instanz importieren; `initialPath` kommt von einer aufs Fenster gezogenen Datei. */
export function useFileTab(ctx: TabContext, initialPath: string): TabModel {
  const { t } = useI18n();
  const [path, setPath] = useState(initialPath);
  const [customName, setCustomName] = useState("");
  const { background } = ctx;

  function submit() {
    const title = customName.trim() || packName(path);
    background.run({
      key: "import",
      label: t("components.newInstance.importTask", { name: title }),
      doneLabel: t("hooks.import.instanceTaskDone", { name: title }),
      cancellable: true,
      task: (operationId) => importPack(path, title, operationId),
      onDone: ctx.onCreated,
    });
  }

  return {
    valid: !!path && api.capabilities.pickPaths && !ctx.active,
    label: ctx.runningLabel ?? t("components.newInstance.importLabel"),
    hint: path ? t("components.newInstance.fileContentsNote") : t("components.newInstance.supportedMrpack"),
    queues: true,
    busy: false,
    submit,
    renderPane: () => <FilePane path={path} customName={customName} setPath={setPath} setCustomName={setCustomName} />,
  };
}
