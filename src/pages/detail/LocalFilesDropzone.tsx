import { useState } from "react";
import { Dialog, DialogActions, Field, Segmented } from "@/ui";
import { useI18n } from "@/i18n";
import { TYPE_ONE_KEYS } from "@/lib/catalog";
import { fileName } from "@/lib/format";
import type { LocalFile } from "@/lib/types";
import { DropHint } from "./dropFiles";

type ZipKind = "resourcepack" | "shader";

/** Dateien, deren Art feststeht, und Zips, bei denen der Nutzer wählt. */
export type Ask = { sure: LocalFile[]; unsure: string[] };

/** Zustand der Ablage: schweben Dateien über dem Fenster (`dragging`), und wartet eine Rückfrage (`ask`) auf Antwort? */
export type DropzoneState = {
  dragging: boolean;
  ask: Ask | null;
  /** Die Rückfrage ist beantwortet: diese Dateien hinzufügen. */
  onAdd: (files: LocalFile[]) => void;
};

/**
 * Ablage-Fläche über dem Tab, solange Dateien darüber schweben, und die Rückfrage bei unklaren Zips;
 * gehört in einen `relative`-Container.
 */
export function LocalFilesDropzone({ dragging, ask, onAdd }: DropzoneState) {
  const { t } = useI18n();
  return (
    <>
      {dragging && (
        <div className="drop over absolute inset-0 z-10 h-auto justify-start" aria-hidden>
          <div className="sticky top-[30vh] flex flex-col items-center gap-2 py-10">
            <DropHint>{t("detail.files.dropHintContent")}</DropHint>
          </div>
        </div>
      )}
      {/* Überspringen lässt die unklaren Zips draußen; was eine klare Art hat, kommt trotzdem hinzu. */}
      {ask && <KindDialog paths={ask.unsure} onSkip={() => onAdd(ask.sure)} onConfirm={(chosen) => onAdd([...ask.sure, ...chosen])} />}
    </>
  );
}

/** Rückfrage für Zips, die am Inhalt weder eindeutig Ressourcenpaket noch Shader sind. */
function KindDialog({ paths, onSkip, onConfirm }: { paths: string[]; onSkip: () => void; onConfirm: (files: LocalFile[]) => void }) {
  const { t } = useI18n();
  const [kinds, setKinds] = useState<ZipKind[]>(() => paths.map(() => "resourcepack"));
  const chosen = () => paths.map((path, i): LocalFile => ({ path, kind: kinds[i] }));
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onSkip()}
      title={t("detail.files.kindDialogTitle")}
      sub={t("detail.files.kindDialogSub")}
      footer={
        <DialogActions cancel={t("detail.files.skipAction")} confirm={{ label: t("common.add"), onClick: () => onConfirm(chosen()) }} />
      }
    >
      {paths.map((path, i) => (
        <Field key={path} label={fileName(path)} group>
          <Segmented
            label={fileName(path)}
            value={kinds[i]}
            onChange={(kind) => setKinds((all) => all.map((k, j) => (j === i ? kind : k)))}
            items={[
              { value: "resourcepack", label: t(TYPE_ONE_KEYS.resourcepack) },
              { value: "shader", label: t(TYPE_ONE_KEYS.shader) },
            ]}
          />
        </Field>
      ))}
    </Dialog>
  );
}
