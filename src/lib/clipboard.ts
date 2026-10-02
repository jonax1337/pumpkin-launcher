import { toast } from "sonner";
import { t } from "@/i18n/core";

/** Text in die Zwischenablage; ein Toast meldet Erfolg (`done`) oder, dass das Kopieren scheiterte. */
export function copyWithToast(text: string, done: string) {
  void navigator.clipboard.writeText(text).then(
    () => toast.success(done),
    () => toast.error(t("components.common.copyFailed")),
  );
}
