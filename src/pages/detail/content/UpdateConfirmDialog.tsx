import { useI18n } from "@/i18n";
import { Dialog, DialogActions, Hint, ProjectIcon } from "@/ui";
import type { ModUpdate } from "@/lib/content-types";
import type { Instance, Mod } from "@/lib/types";
import { ChangelogDisclosure } from "./Changelog";

/** Ein Update der Rückfrage: alter und neuer Stand, das Änderungsprotokoll erst auf Wunsch. */
function UpdateItem({ instance, mod, update, title, icon }: {
  instance: Instance; mod: Mod; update: ModUpdate; title: string; icon: string | null | undefined;
}) {
  const { t } = useI18n();
  return (
    <li className="dc-upd">
      <ProjectIcon url={icon} seed={mod.id} />
      <div className="dc-upd-body">
        <b className="dc-upd-name">{title}</b>
        <span className="dc-upd-ver">{t("detail.content.versionChange", { from: mod.version, to: update.versionNumber })}</span>
      </div>
      <div className="dc-upd-log">
        <ChangelogDisclosure instance={instance} mod={mod} versionId={update.versionId} />
      </div>
    </li>
  );
}

/**
 * Rückfrage vor „Alle aktualisieren“ und vor Updates mehrerer Inhalte: jede Zeile zeigt alten und neuen Stand und
 * öffnet das Änderungsprotokoll. Inhalte, die mit dem Modpack kamen, bekommen einen Hinweis.
 */
export function UpdateConfirmDialog({ instance, items, titleOf, iconOf, onConfirm, onClose }: {
  instance: Instance;
  items: { mod: Mod; update: ModUpdate }[];
  titleOf: (mod: Mod) => string;
  iconOf: (mod: Mod) => string | null | undefined;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const fromPack = items.filter(({ mod }) => mod.packManaged).length;
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t(items.length === 1 ? "detail.content.confirmTitle.one" : "detail.content.confirmTitle.other", { n: items.length })}
      sub={t("detail.content.confirmSub")}
      footer={<DialogActions cancel={t("common.cancel")} confirm={{ label: t("detail.content.updateAction"), icon: "update", onClick: onConfirm }} />}
    >
      {fromPack > 0 && (
        <Hint tone="warn" className="dc-panel-hint">
          {t(fromPack === 1 ? "detail.content.confirmPackHint.one" : "detail.content.confirmPackHint.other", { n: fromPack })}
        </Hint>
      )}
      <ul className="dc-upd-list">
        {items.map(({ mod, update }) => (
          <UpdateItem key={mod.id} instance={instance} mod={mod} update={update} title={titleOf(mod)} icon={iconOf(mod)} />
        ))}
      </ul>
    </Dialog>
  );
}
