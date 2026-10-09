import { useI18n } from "@/i18n";
import { Button, Chip, IconButton, JobProgress, Menu, Switch, Tip } from "@/ui";
import type { Mod } from "@/lib/types";
import { RP_HINT_KEY } from "./constants";
import { useContentModel } from "./ContentModel";

/** Liste: Zellen in der Spalte; Kachel: Zellen im Kartenrand, wo der Platz knapper ist. */
export type CellLayout = "list" | "tile";

const UPDATE_BUTTON = "w-24";
const TILE_PROGRESS = "w-28 flex-none";

/**
 * Update je Inhalt: Fortschritt beim Aktualisieren, sonst Knopf mit fester Breite (Version mit Auslassung, voller Text im Tooltip).
 * `hideNoSource` lässt den Hinweis „Keine Update-Quelle“ weg, damit ein Hinweis der Kachel die Zeile ganz bekommt.
 */
export function UpdateCell({ mod, layout, hideNoSource }: { mod: Mod; layout: CellLayout; hideNoSource?: boolean }) {
  const { t } = useI18n();
  const model = useContentModel();
  const tile = layout === "tile";
  if (model.isUpdating(mod)) {
    return (
      <JobProgress
        label={t("detail.content.updating")}
        p={model.updateShare}
        className={tile ? TILE_PROGRESS : "w-full"}
      />
    );
  }
  const update = model.updateFor.get(mod.id);
  if (!update) return <NoUpdateStatus mod={mod} hideNoSource={hideNoSource} />;
  const title = model.titleOf(mod);
  return (
    <Tip label={t("detail.content.updateFromTo", { name: title, from: mod.version, to: update.versionNumber })}>
      <Button
        size="s"
        icon="update"
        className={UPDATE_BUTTON}
        disabled={model.locked}
        aria-label={t("detail.content.updateTo", { name: title, version: update.versionNumber })}
        onClick={() => model.runUpdates([mod.id])}
      >
        <span className="ell">{update.versionNumber}</span>
      </Button>
    </Tip>
  );
}

/** Wenn es kein Update gibt, sagt die Zelle warum: festgehalten oder keine Quelle, bei der der Launcher Updates prüfen kann. */
function NoUpdateStatus({ mod, hideNoSource }: { mod: Mod; hideNoSource?: boolean }) {
  const { t } = useI18n();
  if (mod.pinned) {
    return (
      <Tip label={t("detail.content.pinnedTip", { version: mod.version })}>
        <span><Chip size="s">{t("detail.content.pinned")}</Chip></span>
      </Tip>
    );
  }
  if (hideNoSource) return null;
  if (mod.source.type === "modrinth") return <span className="dc-nosrc">{t("detail.content.upToDate")}</span>;
  const tip = mod.source.type === "local" ? "detail.content.noUpdateSourceLocalTip" : "detail.content.noUpdateSourceTip";
  return (
    <Tip label={t(tip)}>
      <span className="dc-nosrc">{t("detail.content.noUpdateSource")}</span>
    </Tip>
  );
}

/** Ressourcenpaket: „Aktiv“ im Spiel (`options.txt`); bis die Auswahl gelesen ist, der Hinweis aufs Spiel. */
function PackSwitch({ mod }: { mod: Mod }) {
  const { t } = useI18n();
  const { packs, titleOf } = useContentModel();
  if (!packs.available) {
    return (
      <Tip label={t(RP_HINT_KEY)}>
        <span>{t("detail.content.inGame")}<span className="sr"> {t("detail.content.turnOnSr")}</span></span>
      </Tip>
    );
  }
  return (
    <Tip label={packs.blocked} describe>
      <span>
        <Switch
          checked={packs.isActive(mod)}
          disabled={!!packs.blocked || !mod.enabled}
          onChange={(on) => packs.setActive(mod, on)}
          label={titleOf(mod)}
          description={t("detail.packs.activeDescription")}
          stateText={["", t("ui.switch.off")]}
        />
      </span>
    </Tip>
  );
}

/** An/Aus: Schalter mit sichtbarem „Aus“; Ressourcenpakete schaltet man im Spiel ein (`PackSwitch`). */
export function EnabledCell({ mod, layout }: { mod: Mod; layout: CellLayout }) {
  const { t } = useI18n();
  const model = useContentModel();
  if (mod.kind === "resourcepack") return <PackSwitch mod={mod} />;
  // Kachel: „Aus“ nur im ausgeschalteten Zustand (spart dem Namen Platz); Zeile: Platz bleibt reserviert.
  const stateText: [string, string] | undefined = layout === "tile" && mod.enabled ? undefined : ["", t("ui.switch.off")];
  return (
    <Switch
      checked={mod.enabled}
      onChange={(on) => model.setEnabled([mod.id], on)}
      label={model.titleOf(mod)}
      stateText={stateText}
    />
  );
}

/** Menüknopf „…“ der Zeile; `describedBy` verweist auf den Text für Screenreader, `className` setzt den Knopf in die Zeile. */
export function MoreMenu({ mod, describedBy, className }: { mod: Mod; describedBy?: string; className?: string }) {
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
          className={className}
          data-more={mod.id}
          label={t("detail.content.moreAbout", { name: model.titleOf(mod) })}
          aria-describedby={describedBy}
        />
      }
    />
  );
}
