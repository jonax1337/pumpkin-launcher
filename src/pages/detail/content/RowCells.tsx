import { useI18n } from "@/i18n";
import { Button, IconButton, JobProgress, Menu, Switch, Tip } from "@/ui";
import type { Mod } from "@/lib/types";
import { RP_HINT_KEY } from "./constants";
import { useContentModel } from "./ContentModel";

/** Liste: Zellen in der Spalte; Kachel: Zellen im Kartenrand, wo der Platz knapper ist. */
export type CellLayout = "list" | "tile";

const UPDATE_BUTTON_WIDTH = 96;
const TILE_PROGRESS_WIDTH = 112;

/** Update je Inhalt: Fortschritt beim Aktualisieren, sonst Knopf mit fester Breite (Version mit Auslassung, voller Text im Tooltip). */
export function UpdateCell({ mod, layout }: { mod: Mod; layout: CellLayout }) {
  const { t } = useI18n();
  const model = useContentModel();
  const tile = layout === "tile";
  if (model.isUpdating(mod)) {
    return (
      <JobProgress
        label={t("detail.content.updating")}
        p={model.updateShare}
        width={tile ? TILE_PROGRESS_WIDTH : undefined}
        className={tile ? undefined : "w-full"}
      />
    );
  }
  const update = model.updateFor.get(mod.id);
  if (!update) return null;
  const title = model.titleOf(mod);
  return (
    <Tip label={t("detail.content.updateFromTo", { name: title, from: mod.version, to: update.versionNumber })}>
      <Button
        size="s"
        icon="up"
        width={UPDATE_BUTTON_WIDTH}
        disabled={model.locked}
        aria-label={t("detail.content.updateTo", { name: title, version: update.versionNumber })}
        onClick={() => model.runUpdates([mod.id])}
      >
        <span className="truncate">{update.versionNumber}</span>
      </Button>
    </Tip>
  );
}

/** An/Aus: Schalter mit sichtbarem „Aus“; Ressourcenpakete haben keinen (das Spiel schaltet sie ein). */
export function EnabledCell({ mod, layout }: { mod: Mod; layout: CellLayout }) {
  const { t } = useI18n();
  const model = useContentModel();
  if (mod.kind === "resourcepack") {
    return (
      <Tip label={t(RP_HINT_KEY)}>
        <span>{t("detail.content.inGame")}<span className="sr"> {t("detail.content.turnOnSr")}</span></span>
      </Tip>
    );
  }
  // Kachel: „Aus“ nur im ausgeschalteten Zustand (spart dem Namen Platz); Zeile: Platz bleibt reserviert.
  const stateText: [string, string] | undefined = layout === "tile" && mod.enabled ? undefined : ["", t("ui.switch.off")];
  return (
    <Switch
      checked={mod.enabled}
      onChange={(on) => model.setEnabled([mod.id], on)}
      label={t("detail.content.enabledLabel", { name: model.titleOf(mod) })}
      stateText={stateText}
    />
  );
}

/** Menüknopf „…“ der Zeile; `describedBy` verweist auf den Text für Screenreader. */
export function MoreMenu({ mod, describedBy }: { mod: Mod; describedBy?: string }) {
  const { t } = useI18n();
  const model = useContentModel();
  return (
    <Menu
      items={model.menuFor(mod)}
      trigger={
        <IconButton
          size="s"
          icon="more"
          tip={false}
          data-more={mod.id}
          label={t("detail.content.moreAbout", { name: model.titleOf(mod) })}
          aria-describedby={describedBy}
        />
      }
    />
  );
}
