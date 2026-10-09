/** Fehlerbox der App: Fehler in Alltagssprache mit Buddy als Symbol; mit `title` ist die Backend-Meldung das Detail. */
import { Buddy } from "@/branding/Brand";
import { useI18n } from "@/i18n";
import { Button, StatusPanel } from "@/ui";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** `onRetry` → „Erneut versuchen“. */
export function ErrorBox({ error, title, onRetry, className }: { error: unknown; title?: string; onRetry?: () => void; className?: string }) {
  const { t } = useI18n();
  return (
    <StatusPanel
      tone="bad"
      icon={<Buddy mood="oops" size={48} />}
      role="alert"
      className={className}
      title={title ?? message(error)}
      actions={onRetry && <Button size="s" icon="refresh" onClick={onRetry}>{t("common.retry")}</Button>}
    >
      {title ? message(error) : undefined}
    </StatusPanel>
  );
}
