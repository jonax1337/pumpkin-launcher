import { useI18n } from "@/i18n";
import { cssVars } from "@/ui";
import { cn } from "@/lib/utils";

/**
 * Balken im Spielen-Knopf: segmentierter Fortschritt in den Knopf-Farben (`--prog-on`/`--prog-off` setzt `PlayPlate`,
 * Zellen siehe components/play.css). `p` 0–1, `null` = unbestimmt (`.ind`).
 */
export function PlayBar({ p, className }: { p: number | null; className?: string }) {
  const { t } = useI18n();
  const indeterminate = p == null;
  const share = indeterminate ? 0 : Math.max(0, Math.min(1, p));
  return (
    <span
      role="progressbar"
      aria-label={t("ui.progress.label")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(share * 100)}
      className={cn("prog", indeterminate && "ind", className)}
      style={cssVars({ "--p": share })}
    />
  );
}
