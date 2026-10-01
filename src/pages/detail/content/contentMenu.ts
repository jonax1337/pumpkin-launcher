import { t } from "@/i18n";
import type { MenuEntry } from "@/ui";
import type { ModUpdate } from "@/lib/content-types";
import { openPage, projectUrl } from "@/lib/links";
import type { Mod } from "@/lib/types";

/** Was das Menü einer Zeile auslöst; `locked` sperrt, solange ein Vorgang läuft. */
export type ContentMenuActions = {
  update: ModUpdate | undefined;
  locked: boolean;
  onUpdate: () => void;
  onIdentify: () => void;
  onRemove: () => void;
};

/**
 * Einträge des „…“-Menüs eines Inhalts: Update, Abgleich mit Modrinth (eigene Dateien), Webseite, Entfernen.
 * Reine Funktion, deshalb Modul-`t`.
 */
export function contentMenuEntries(mod: Mod, { update, locked, onUpdate, onIdentify, onRemove }: ContentMenuActions): MenuEntry[] {
  const web = projectUrl(mod.source);
  const own = mod.source.type === "local";
  return [
    ...(update
      ? [{
          id: "up",
          text: t("detail.content.updateVersionTo", { version: update.versionNumber }),
          icon: "up" as const,
          disabled: locked,
          onSelect: onUpdate,
        }]
      : []),
    ...(own
      ? [{ id: "identify", text: t("detail.content.matchOnModrinth"), icon: "search" as const, disabled: locked, onSelect: onIdentify }]
      : []),
    ...(web
      ? [{
          id: "web",
          text: t(mod.source.type === "curseforge" ? "detail.content.viewOnCurseForge" : "detail.content.viewOnModrinth"),
          icon: "ext" as const,
          onSelect: () => openPage(web),
        }]
      : []),
    ...(update || own || web ? ["-" as const] : []),
    { id: "rm", text: t("common.remove"), icon: "trash", bad: true, onSelect: onRemove },
  ];
}
