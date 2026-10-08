import { create } from "zustand";
import { TABS } from "@/app/mainTabs";
import { HELP_KEY, SEARCH_KEY, SHORTCUT, shortcutLabel } from "@/app/shortcuts";
import { useI18n } from "@/i18n";
import { platform } from "@/lib/platform";
import { Dialog, DialogActions } from "@/ui";

const useShortcutHelp = create<{ open: boolean }>(() => ({ open: false }));

/** Öffnet die Übersicht der Tastaturkürzel (Taste "?", Einstellungen › Über). */
export const showShortcuts = () => useShortcutHelp.setState({ open: true });

/** Übersicht aller Kürzel; Texte und Tasten kommen aus derselben Tabelle wie Tooltips und `aria-keyshortcuts`. */
export function ShortcutsDialog() {
  const { t } = useI18n();
  const open = useShortcutHelp((s) => s.open);
  const rows = [
    ...TABS.map((tab) => ({ label: t("ui.shortcut.goTo", { name: t(tab.key) }), keys: [tab.shortcut] })),
    { label: t("palette.shortcut"), keys: [SHORTCUT.palette] },
    { label: t("ui.shortcut.settings"), keys: [SHORTCUT.settings] },
    { label: t("ui.shortcut.newInstance"), keys: [SHORTCUT.newInstance] },
    { label: t("ui.shortcut.play"), keys: [SHORTCUT.play] },
    { label: t("ui.shortcut.search"), keys: [SHORTCUT.search, SEARCH_KEY] },
    { label: t("ui.shortcut.help"), keys: [HELP_KEY] },
  ];
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => useShortcutHelp.setState({ open: next })}
      title={t("ui.shortcut.title")}
      width={520}
      footer={<DialogActions cancel={t("common.close")} />}
    >
      <dl className="vx-keys">
        {rows.map(({ label, keys }) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {keys.map((key) => (
                <kbd key={key}>{shortcutLabel(key, t)}</kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
      <p className="help mt-4">{t("ui.shortcut.tabHint")}</p>
      {platform === "windows" && <p className="help mt-2">{t("ui.shortcut.windowHint")}</p>}
    </Dialog>
  );
}
