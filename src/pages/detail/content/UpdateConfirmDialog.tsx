import { useState } from "react";
import { useI18n } from "@/i18n";
import { Dialog, DialogActions, Disclosure, Hint, ProjectIcon } from "@/ui";
import type { ModUpdate } from "@/lib/content-types";
import type { Instance, Mod } from "@/lib/types";
import { Changelog } from "./Changelog";

/** Ein Update der Rückfrage: alter und neuer Stand, das Änderungsprotokoll erst auf Wunsch. */
function UpdateItem({ instance, mod, update, title, icon }: {
  instance: Instance; mod: Mod; update: ModUpdate; title: string; icon: string | null | undefined;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <li className="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-2">
      <ProjectIcon url={icon} seed={mod.id} />
      <div className="min-w-0">
        <b className="block truncate">{title}</b>
        <span className="text-fg-3 text-[13px]">{t("detail.content.versionChange", { from: mod.version, to: update.versionNumber })}</span>
      </div>
      <div className="col-start-2">
        <Disclosure summary={t("detail.content.changes")} open={open} onToggle={setOpen}>
          {open && <Changelog instance={instance} mod={mod} versionId={update.versionId} />}
        </Disclosure>
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
      width={620}
      title={t(items.length === 1 ? "detail.content.confirmTitle.one" : "detail.content.confirmTitle.other", { n: items.length })}
      sub={t("detail.content.confirmSub")}
      footer={<DialogActions cancel={t("common.cancel")} confirm={{ label: t("detail.content.updateAction"), icon: "up", onClick: onConfirm }} />}
    >
      {fromPack > 0 && (
        <Hint tone="warn" className="mb-2">
          {t(fromPack === 1 ? "detail.content.confirmPackHint.one" : "detail.content.confirmPackHint.other", { n: fromPack })}
        </Hint>
      )}
      <ul className="divide-line m-0 list-none divide-y p-0">
        {items.map(({ mod, update }) => (
          <UpdateItem key={mod.id} instance={instance} mod={mod} update={update} title={titleOf(mod)} icon={iconOf(mod)} />
        ))}
      </ul>
    </Dialog>
  );
}
