import { toast } from "sonner";
import { t } from "@/i18n";
import { Icon } from "@/ui";
import { fileName } from "@/lib/format";

/** Inhalt der Ablage-Fläche (`DropZone overlay`), solange Dateien über dem Fenster schweben; bleibt beim Scrollen im Blick. `children` nennt, was passt. */
export function DropHint({ children }: { children: string }) {
  return (
    <div className="sticky top-[30vh] flex flex-col items-center gap-2 py-10">
      <Icon name="download" size="xl" />
      <b>{t("detail.drop.releaseToAdd")}</b>
      <span>{children}</span>
    </div>
  );
}

/** Meldet eine abgelehnte Datei; `allowed` sagt, was stattdessen passt. */
export const rejectedFileToast = (path: string, allowed: string) =>
  void toast.error(t("detail.drop.rejectedFile", { file: fileName(path), allowed }));
