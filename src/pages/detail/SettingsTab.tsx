import { Hint } from "@/ui";
import { isGameLive, usePhase } from "@/components/play/phase";
import { useI18n } from "@/i18n";
import type { Instance } from "@/lib/types";
import { GameSection } from "./settings/GameSection";
import { GeneralSection } from "./settings/GeneralSection";
import { LaunchSection } from "./settings/LaunchSection";
import { NotesSection } from "./settings/NotesSection";
import { PackSection } from "./settings/PackSection";
import { useInstanceForm } from "./settings/useInstanceForm";
import { DangerSection, VersionSection } from "./settings/VersionSection";

/**
 * Einstellungen einer Instanz. Alles speichert sofort (Textfelder beim Verlassen des Felds).
 * `packRequested`: der Kopf „Pack-Update“ wurde angeklickt, der Modpack-Abschnitt soll in den Blick (`onPackShown`: erledigt).
 */
export function SettingsTab({ instance, packRequested = false, onPackShown }: { instance: Instance; packRequested?: boolean; onPackShown?: () => void }) {
  const { t } = useI18n();
  const form = useInstanceForm(instance);
  // Solange das Spiel läuft, lehnt das Backend jede Änderung an der Instanz ab; das Bild lebt nur lokal.
  const locked = isGameLive(usePhase(instance.id));
  return (
    <div className="st-form">
      {locked && <Hint className="st-locked">{t("detail.settings.lockedHint")}</Hint>}
      <GeneralSection instance={instance} form={form} locked={locked} />
      <GameSection instance={instance} form={form} locked={locked} />
      <LaunchSection instance={instance} form={form} locked={locked} />
      <NotesSection instance={instance} form={form} locked={locked} />
      <VersionSection instance={instance} />
      <PackSection instance={instance} requested={packRequested} onShown={onPackShown} />
      <DangerSection instance={instance} />
    </div>
  );
}
