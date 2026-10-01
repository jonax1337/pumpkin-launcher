import { Hint } from "@/ui";
import { isGameLive, usePhase } from "@/components/play/phase";
import { useI18n } from "@/i18n";
import type { Instance } from "@/lib/types";
import { GameSection } from "./settings/GameSection";
import { GeneralSection } from "./settings/GeneralSection";
import { useInstanceForm } from "./settings/useInstanceForm";
import { DangerSection, VersionSection } from "./settings/VersionSection";

/** Einstellungen einer Instanz. Alles speichert sofort (Textfelder beim Verlassen des Felds). */
export function SettingsTab({ instance }: { instance: Instance }) {
  const { t } = useI18n();
  const form = useInstanceForm(instance);
  // Solange das Spiel läuft, lehnt das Backend jede Änderung an der Instanz ab; das Bild lebt nur lokal.
  const locked = isGameLive(usePhase(instance.id));
  return (
    <div className="max-w-[var(--page-max)] pt-2">
      {locked && <Hint className="mb-4">{t("detail.settings.lockedHint")}</Hint>}
      <GeneralSection instance={instance} form={form} locked={locked} />
      <GameSection instance={instance} form={form} locked={locked} />
      <VersionSection instance={instance} />
      <DangerSection instance={instance} />
    </div>
  );
}
