import { useState } from "react";
import { useNavigate } from "react-router";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { Dialog, DialogActions, Field, Segmented } from "@/ui";
import { useContentInstall, useContentState, withTarget } from "@/hooks/useContent";
import { useFileDrop } from "@/hooks/useFileDrop";
import { api } from "@/lib/api";
import { fileName } from "@/lib/format";
import { isMrpack } from "@/lib/modrinth";
import { toastError } from "@/lib/toast";
import type { Instance, FileCheck, LocalFile, Mod } from "@/lib/types";
import { DropHint, rejectedFileToast } from "./dropFiles";

const CONTENT_FILE = /\.(jar|zip)$/i;

type ZipKind = "resourcepack" | "shader";
const ZIP_KINDS: { value: ZipKind; label: string }[] = [
  { value: "resourcepack", label: "Ressourcenpaket" },
  { value: "shader", label: "Shader" },
];

/** Dateien, deren Art feststeht, und Zips, bei denen der Nutzer wählt. */
type Ask = { sure: LocalFile[]; unsure: string[] };

/** „Sodium hinzugefügt, von Modrinth erkannt“ bzw. „3 Dateien hinzugefügt, 2 davon von Modrinth erkannt“. */
function addedText(added: Mod[]) {
  const known = added.filter((m) => m.source.type === "modrinth").length;
  if (added.length === 1) return `${added[0].name} hinzugefügt${known ? ", von Modrinth erkannt" : ""}`;
  return `${added.length} Dateien hinzugefügt${known ? `, ${known} davon von Modrinth erkannt` : ""}`;
}

/** Ein Modpack gehört nicht in die Inhalte; der Toast bietet den Import als eigene Instanz an. */
function announceModpack(paths: string[], open: (url: string) => void) {
  const pack = paths.find(isMrpack);
  if (!pack) return;
  toast("Modpacks werden als eigene Instanz importiert.", {
    action: { label: "Importieren", onClick: () => open(`/instances?neu=1&datei=${encodeURIComponent(pack)}`) },
  });
}

/** Die Jars und Zips unter `paths`; für alles andere (außer Modpacks) meldet ein Toast, was passt. */
function contentFiles(paths: string[]) {
  const other = paths.find((p) => !isMrpack(p) && !CONTENT_FILE.test(p));
  if (other) rejectedFileToast(other, "Mods sind .jar-Dateien, Ressourcenpakete und Shader .zip-Dateien.");
  return paths.filter((p) => CONTENT_FILE.test(p));
}

/** Meldet Fehler und Doppelte der Prüfung per Toast; übrig bleiben Dateien mit klarer Art (`sure`) und Zips zum Nachfragen (`unsure`). */
function classify(checks: FileCheck[]): Ask {
  for (const c of checks) {
    if (c.error) toast.error(c.error);
    else if (c.duplicateOf) toast.error(`„${fileName(c.path)}“ ist schon in dieser Instanz (${c.duplicateOf}).`);
  }
  const fresh = checks.filter((c) => !c.error && !c.duplicateOf);
  return {
    sure: fresh.flatMap(({ path, kind }) => (kind ? [{ path, kind }] : [])),
    unsure: fresh.filter((c) => !c.kind).map((c) => c.path),
  };
}

/**
 * Eigene Dateien in den Inhalten einer Instanz: aufs Fenster ziehen (solange `active`), „Datei hinzufügen…“ (`pick`, nur
 * in der App) und „Mit Modrinth abgleichen“. `overlay` (Ablage-Fläche, Rückfrage bei unklaren Zips) gehört in einen `relative`-Container.
 */
export function useLocalFiles(instance: Instance, active: boolean) {
  const install = useContentInstall();
  const navigate = useNavigate();
  const [ask, setAsk] = useState<Ask | null>(null);
  // Während der Rückfrage würde ein weiterer Ablage-Vorgang die offenen Dateien ersetzen.
  const dragging = useFileDrop(active && !ask, (paths) => void take(paths).catch(toastError));

  async function take(paths: string[]) {
    // Sonst verwirft `useContentInstall` die Dateien kommentarlos.
    if (useContentState.getState().active) {
      toast.error("Warte, bis der laufende Vorgang fertig ist.");
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
    const label = files.length === 1 ? `${fileName(files[0].path)} hinzufügen` : `${files.length} Dateien hinzufügen`;
    install.mutate(withTarget("files", (op) => api.addLocalFiles(instance.id, files, op), label), {
      // Das Backend hängt neue Einträge hinten an.
      onSuccess: (result) => void (result && toast.success(addedText(result.mods.slice(before)))),
    });
  }

  async function pick() {
    const picked = await openFile({ multiple: true, directory: false, filters: [{ name: "Mods, Ressourcenpakete, Shader", extensions: ["jar", "zip"] }] });
    if (picked) await take(picked);
  }

  function identify(m: Mod) {
    install.mutate(withTarget(`identify:${m.id}`, () => api.modrinthIdentify(instance.id, [m.id]), `${m.name} abgleichen`), {
      onSuccess: (result) => {
        const now = result?.mods.find((x) => x.fileName === m.fileName);
        if (now?.source.type === "modrinth") toast.success(`${m.name} erkannt: ${now.name} ${now.version}`);
        else if (now) toast(`${m.name} ist auf Modrinth nicht zu finden.`);
      },
    });
  }

  const overlay = (
    <>
      {dragging && (
        <div className="drop over absolute inset-0 z-10 h-auto justify-start" aria-hidden>
          <div className="sticky top-[30vh] flex flex-col items-center gap-2 py-10">
            <DropHint>Mods (.jar), Ressourcenpakete und Shader (.zip)</DropHint>
          </div>
        </div>
      )}
      {ask && (
        <KindDialog
          paths={ask.unsure}
          onClose={() => {
            setAsk(null);
            add(ask.sure);
          }}
          onConfirm={(chosen) => {
            setAsk(null);
            add([...ask.sure, ...chosen]);
          }}
        />
      )}
    </>
  );

  // Eigene Dateien gibt es nur in der App: der Browser liefert keine Pfade.
  return { pick: api.isMock ? undefined : () => void pick().catch(toastError), identify, overlay };
}

/** Rückfrage für Zips, die am Inhalt weder eindeutig Ressourcenpaket noch Shader sind. */
function KindDialog({ paths, onClose, onConfirm }: { paths: string[]; onClose: () => void; onConfirm: (files: LocalFile[]) => void }) {
  const [kinds, setKinds] = useState<ZipKind[]>(() => paths.map(() => "resourcepack"));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Ressourcenpaket oder Shader?"
      sub="Am Inhalt ist das nicht eindeutig zu erkennen."
      footer={<DialogActions cancel="Überspringen" confirm={{ label: "Hinzufügen", onClick: () => onConfirm(paths.map((path, i) => ({ path, kind: kinds[i] }))) }} />}
    >
      {paths.map((path, i) => (
        <Field key={path} label={fileName(path)} group>
          <Segmented label={fileName(path)} value={kinds[i]} onChange={(k) => setKinds((ks) => ks.map((x, j) => (j === i ? k : x)))} items={ZIP_KINDS} />
        </Field>
      ))}
    </Dialog>
  );
}
