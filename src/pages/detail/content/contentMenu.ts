import { t } from "@/i18n";
import type { MenuEntry } from "@/ui";
import type { ModUpdate } from "@/lib/content-types";
import { openPage, projectUrl } from "@/lib/links";
import type { Mod } from "@/lib/types";

/** Was das Menü einer Zeile auslöst; `locked` sperrt, solange ein Vorgang läuft, `onReveal` fehlt, wo es keinen Dateimanager gibt. */
export type ContentMenuActions = {
  update: ModUpdate | undefined;
  locked: boolean;
  onUpdate: () => void;
  onPickVersion: () => void;
  onTogglePin: () => void;
  onReveal: (() => void) | undefined;
  onIdentify: () => void;
  onRemove: () => void;
};

/** Einträge, die nur für Modrinth-Inhalte gelten: Update, Version wählen, Festhalten. */
function modrinthEntries(mod: Mod, { update, locked, onUpdate, onPickVersion, onTogglePin }: ContentMenuActions): MenuEntry[] {
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
    { id: "version", text: t("detail.content.pickVersion"), icon: "swap", disabled: locked, onSelect: onPickVersion },
    { id: "pin", text: t(mod.pinned ? "detail.content.unpin" : "detail.content.pin"), icon: "dot", onSelect: onTogglePin },
  ];
}

/**
 * Einträge des „…“-Menüs eines Inhalts: Update, Version wählen und Festhalten (Modrinth), Abgleich mit Modrinth
 * (eigene Dateien), Im Ordner zeigen, Webseite, Entfernen. Reine Funktion, deshalb Modul-`t`.
 */
export function contentMenuEntries(mod: Mod, actions: ContentMenuActions): MenuEntry[] {
  const web = projectUrl(mod.source);
  const own = mod.source.type === "local";
  const sourceEntries = mod.source.type === "modrinth" ? modrinthEntries(mod, actions) : [];
  const entries: MenuEntry[] = [
    ...sourceEntries,
    ...(own ? [{ id: "identify", text: t("detail.content.matchOnModrinth"), icon: "search" as const, disabled: actions.locked, onSelect: actions.onIdentify }] : []),
    ...(actions.onReveal ? [{ id: "reveal", text: t("detail.content.revealInFolder"), icon: "folder" as const, onSelect: actions.onReveal }] : []),
    ...(web
      ? [{
          id: "web",
          text: t(mod.source.type === "curseforge" ? "detail.content.viewOnCurseForge" : "detail.content.viewOnModrinth"),
          icon: "ext" as const,
          onSelect: () => openPage(web),
        }]
      : []),
  ];
  return [...entries, ...(entries.length ? ["-" as const] : []), { id: "rm", text: t("common.remove"), icon: "trash", bad: true, onSelect: actions.onRemove }];
}
