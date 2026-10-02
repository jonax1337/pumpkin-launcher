import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useBackgroundTask } from "@/hooks/useBackgroundTask";
import { useContentState } from "@/store/contentState";
import { useFileDrop } from "@/hooks/useFileDrop";
import { api } from "@/lib/api";
import { fileName } from "@/lib/format";
import { isMrpack } from "@/lib/mods";
import { newInstanceUrl } from "@/lib/routes";
import { toastError } from "@/lib/toast";
import { t, useI18n } from "@/i18n";
import type { Instance, FileCheck, LocalFile, Mod } from "@/lib/types";
import { rejectedFileToast } from "./dropFiles";
import type { Ask, DropzoneState } from "./LocalFilesDropzone";

const CONTENT_FILE = /\.(jar|zip)$/i;

/** „Sodium hinzugefügt, von Modrinth erkannt“ bzw. „3 Dateien hinzugefügt, 2 davon von Modrinth erkannt“. */
function addedText(added: Mod[]) {
  const known = added.filter((m) => m.source.type === "modrinth").length;
  if (added.length === 1) {
    const { name } = added[0];
    return known ? t("detail.files.addedOneKnown", { name }) : t("components.content.added", { name });
  }
  return known ? t("detail.files.addedManyKnown", { n: added.length, k: known }) : t("detail.files.addedMany", { n: added.length });
}

/** Ein Modpack gehört nicht in die Inhalte; der Toast bietet den Import als eigene Instanz an. */
function announceModpack(paths: string[], open: (url: string) => void) {
  const pack = paths.find(isMrpack);
  if (!pack) return;
  toast(t("detail.files.modpackToast"), {
    action: { label: t("components.newInstance.importLabel"), onClick: () => open(newInstanceUrl({ type: "file", path: pack })) },
  });
}

/** Die Jars und Zips unter `paths`; für alles andere (außer Modpacks) meldet ein Toast, was passt. */
function contentFiles(paths: string[]) {
  const other = paths.find((p) => !isMrpack(p) && !CONTENT_FILE.test(p));
  if (other) rejectedFileToast(other, t("detail.files.allowedContent"));
  return paths.filter((p) => CONTENT_FILE.test(p));
}

/** Meldet Fehler und Doppelte der Prüfung per Toast; übrig bleiben Dateien mit klarer Art (`sure`) und Zips zum Nachfragen (`unsure`). */
function classify(checks: FileCheck[]): Ask {
  for (const c of checks) {
    if (c.error) toast.error(c.error);
    else if (c.duplicateOf) toast.error(t("detail.files.duplicate", { file: fileName(c.path), name: c.duplicateOf }));
  }
  const fresh = checks.filter((c) => !c.error && !c.duplicateOf);
  return {
    sure: fresh.flatMap(({ path, kind }) => (kind ? [{ path, kind }] : [])),
    unsure: fresh.filter((c) => !c.kind).map((c) => c.path),
  };
}

/**
 * Eigene Dateien in den Inhalten einer Instanz: aufs Fenster ziehen (solange `active`), „Datei hinzufügen…“ (`pick`, nur
 * in der App) und „Mit Modrinth abgleichen“. `dropzone` gehört an `LocalFilesDropzone` in einem `relative`-Container.
 */
export function useLocalFiles(instance: Instance, active: boolean) {
  const { t } = useI18n();
  const background = useBackgroundTask();
  const navigate = useNavigate();
  const [ask, setAsk] = useState<Ask | null>(null);
  // Während der Rückfrage würde ein weiterer Ablage-Vorgang die offenen Dateien ersetzen.
  const dragging = useFileDrop(active && !ask, (paths) => void take(paths).catch(toastError));

  async function take(paths: string[]) {
    // Sonst verwirft `useContentInstall` die Dateien kommentarlos.
    if (useContentState.getState().active) {
      toast.error(t("detail.files.waitCurrentJob"));
      return;
    }
    announceModpack(paths, navigate);
    const files = contentFiles(paths);
    if (!files.length) return;
    const sorted = classify(await api.checkLocalFiles(instance.id, files));
    if (sorted.unsure.length) setAsk(sorted);
    else add(sorted.sure);
  }

  function add(files: LocalFile[]) {
    if (!files.length) return;
    const before = instance.mods.length;
    const single = files.length === 1 ? fileName(files[0].path) : null;
    background.run({
      key: "files",
      label: single ? t("detail.files.addOneLabel", { file: single }) : t("detail.files.addManyLabel", { n: files.length }),
      doneLabel: single ? t("detail.files.addOneDone", { file: single }) : t("detail.files.addedMany", { n: files.length }),
      task: (op) => api.addLocalFiles(instance.id, files, op),
      // Das Backend hängt neue Einträge hinten an.
      onDone: (result) => toast.success(addedText(result.mods.slice(before))),
    });
  }

  async function pick() {
    const picked = await api.pickPaths({ multiple: true, filters: [{ name: t("detail.files.pickFilter"), extensions: ["jar", "zip"] }] });
    if (picked.length) await take(picked);
  }

  function identify(m: Mod) {
    background.run({
      key: `identify:${m.id}`,
      label: t("detail.files.matchLabel", { name: m.name }),
      doneLabel: t("detail.files.matchDone", { name: m.name }),
      task: () => api.modrinthIdentify(instance.id, [m.id]),
      onDone: (result) => {
        const now = result.mods.find((x) => x.fileName === m.fileName);
        if (now?.source.type === "modrinth") {
          toast.success(t("detail.files.identified", { name: m.name, match: now.name, version: now.version }));
        }
        else if (now) toast(t("detail.files.notFoundOnModrinth", { name: m.name }));
      },
    });
  }

  const dropzone: DropzoneState = {
    dragging,
    ask,
    onAdd: (files) => {
      setAsk(null);
      add(files);
    },
  };

  // Eigene Dateien gibt es nur in der App: der Browser liefert keine Pfade.
  return { pick: api.capabilities.pickPaths ? () => void pick().catch(toastError) : undefined, identify, dropzone };
}
