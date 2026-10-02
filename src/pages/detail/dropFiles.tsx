import { toast } from "sonner";
import { t } from "@/i18n";
import { Icon } from "@/ui";
import { fileName } from "@/lib/format";

/** Inhalt der Ablage-Fläche, solange Dateien über dem Fenster schweben; `children` nennt, was passt. */
export function DropHint({ children }: { children: string }) {
  return (
    <>
      <Icon name="ul" size="xl" />
      <b>{t("detail.drop.releaseToAdd")}</b>
      <span>{children}</span>
    </>
  );
}

/** Meldet eine abgelehnte Datei; `allowed` sagt, was stattdessen passt. */
export const rejectedFileToast = (path: string, allowed: string) =>
  void toast.error(t("detail.drop.rejectedFile", { file: fileName(path), allowed }));
