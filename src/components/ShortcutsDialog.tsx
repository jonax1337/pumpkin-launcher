import { create } from "zustand";
import { TABS } from "@/app/mainTabs";
import { HELP_KEY, SEARCH_KEY, SHORTCUT, shortcutLabel } from "@/app/shortcuts";
import { useI18n } from "@/i18n";
import { platform } from "@/lib/platform";
import { Dialog, DialogActions } from "@/ui";

const useShortcutHelp = create<{ open: boolean }>(() => ({ open: false }));

/** Öffnet die Übersicht der Tastaturkürzel (Taste "?", Einstellungen › Über). */
export const showShortcuts = () => useShortcutHelp.setState({ open: true });

type Row = { label: string; keys: string[] };

/** Eine Gruppe der Übersicht: Überschrift, darunter Zeilen mit Beschreibung links und Tasten rechts. */
function KeyGroup({ title, rows }: { title: string; rows: Row[] }) {
  const { t } = useI18n();
  return (
    <section className="vx-keys-group">
      <h3 className="vx-keys-h">{title}</h3>
      <dl className="vx-keys">
        {rows.map(({ label, keys }) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {keys.map((key) => (
                // Jede Taste einer Kombination ist eine eigene Kappe (Strg + K)
                <span key={key} className="vx-keys-combo">
                  {shortcutLabel(key, t).split("+").map((part, i) => <kbd key={i} className="vx-slot">{part}</kbd>)}
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Übersicht aller Kürzel; Texte und Tasten kommen aus derselben Tabelle wie Tooltips und `aria-keyshortcuts`. */
export function ShortcutsDialog() {
  const { t } = useI18n();
  const open = useShortcutHelp((s) => s.open);
  const general: Row[] = [
    { label: t("palette.shortcut"), keys: [SHORTCUT.palette] },
    { label: t("ui.shortcut.settings"), keys: [SHORTCUT.settings] },
    { label: t("ui.shortcut.newInstance"), keys: [SHORTCUT.newInstance] },
    { label: t("ui.shortcut.play"), keys: [SHORTCUT.play] },
    { label: t("ui.shortcut.search"), keys: [SHORTCUT.search, SEARCH_KEY] },
    { label: t("ui.shortcut.help"), keys: [HELP_KEY] },
  ];
  const areas: Row[] = TABS.map((tab) => ({ label: t("ui.shortcut.goTo", { name: t(tab.key) }), keys: [tab.shortcut] }));
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => useShortcutHelp.setState({ open: next })}
      title={t("ui.shortcut.title")}
      size="l"
      footer={<DialogActions cancel={t("common.close")} />}
    >
      <div className="vx-keys-grid">
        <KeyGroup title={t("ui.shortcut.groupGeneral")} rows={general} />
        <KeyGroup title={t("ui.shortcut.groupAreas")} rows={areas} />
      </div>
      <p className="help vx-keys-note">{t("ui.shortcut.tabHint")}</p>
      {platform === "windows" && <p className="help vx-keys-note">{t("ui.shortcut.windowHint")}</p>}
    </Dialog>
  );
}
