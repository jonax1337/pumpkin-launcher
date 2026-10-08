import { create } from "zustand";
import { Button, Chip, Dialog, DialogActions, Hint, List, ListRow, RowTitle } from "@/ui";
import { useI18n } from "@/i18n";
import { openPage } from "@/lib/links";
import { useAdoptDownloads, useBlockedDownloads, type ManualTarget } from "@/hooks/useAdoptDownloads";

/** `session` zählt die Öffnungen: Jede beginnt mit frischem Zustand, ohne dass das Schließen den Dialog aus dem Baum nimmt. */
const useManual = create<{ target: ManualTarget | null; session: number }>(() => ({ target: null, session: 0 }));

/** Öffnet den Dialog „Von Hand laden“ (für einzelne Mods, die CurseForge nur über die Webseite ausliefert). */
export const openManualDownloads = (target: ManualTarget) => useManual.setState((s) => ({ target, session: s.session + 1 }));

const closeManualDownloads = () => useManual.setState({ target: null });

/**
 * Manche Autoren erlauben den Download ihrer Mods nur über CurseForge. Das umgeht Pumpkin Launcher nicht: Der Nutzer lädt
 * die Datei dort selbst, der Launcher sieht sie im Downloads-Ordner (Größe und Prüfsumme müssen stimmen) und baut sie ein.
 */
export function ManualDownloads() {
  const session = useManual((s) => s.session);
  useBlockedDownloads(openManualDownloads);
  return <ManualDownloadsDialog key={session} />;
}

function ManualDownloadsDialog() {
  const { t } = useI18n();
  const target = useManual((s) => s.target);
  const { done, pending } = useAdoptDownloads(target, closeManualDownloads);
  const items = target?.items ?? [];

  return (
    <Dialog
      open={!!target}
      onOpenChange={(open) => !open && closeManualDownloads()}
      title={pending.length === 1 ? t("components.manual.titleOne") : t("components.manual.titleMany", { n: pending.length || items.length })}
      sub={target?.instanceName}
      footer={<DialogActions cancel={pending.length ? t("components.manual.later") : t("common.done")} />}
    >
      <Hint icon="info">{t("components.manual.hint")}</Hint>
      <List variant="versions" aria-label={t("components.manual.listLabel")} className="manual-list">
        {items.map((i) => (
          <ListRow key={i.fileId}>
            <RowTitle title={i.name} sub={i.fileName} />
            {done.has(i.fileId) ? (
              <Chip icon="check">{t("components.manual.builtIn")}</Chip>
            ) : (
              <>
                <Chip size="s" dot>{t("components.manual.waiting")}</Chip>
                <Button size="s" icon="external" onClick={() => openPage(i.url)}>{t("common.open")}</Button>
              </>
            )}
          </ListRow>
        ))}
      </List>
    </Dialog>
  );
}
