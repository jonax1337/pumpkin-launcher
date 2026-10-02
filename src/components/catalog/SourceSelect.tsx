import { useI18n } from "@/i18n";
import { Select } from "@/ui";
import { ALL_SOURCES, SOURCE_KEYS, type SourceChoice } from "@/lib/content-types";
import { sourceChoiceLabel } from "./labels";

const SOURCE_CHOICES: SourceChoice[] = [ALL_SOURCES, ...SOURCE_KEYS];

/** Auswahl der Quelle für Katalogsuchen: alle zusammen oder ein Anbieter; in „Entdecken“ und im Dialog „Neue Instanz“ dieselbe. */
export function SourceSelect({ value, onChange }: { value: SourceChoice; onChange: (source: SourceChoice) => void }) {
  const { t } = useI18n();
  return (
    <Select
      label={t("components.sheet.sourceLabel")}
      value={value}
      onChange={(next) => onChange(next as SourceChoice)}
      options={SOURCE_CHOICES.map((source) => ({ value: source, label: sourceChoiceLabel(source) }))}
    />
  );
}
