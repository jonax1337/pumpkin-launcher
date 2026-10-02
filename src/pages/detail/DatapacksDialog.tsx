import { toast } from "sonner";
import { Actions, Chip, Dialog, DialogActions, Empty, Hint, IconButton, List, ListRow, RowTitle } from "@/ui";
import { QueryList } from "@/components/QueryList";
import { useFileDrop } from "@/hooks/useFileDrop";
import { useAddDatapacks, useDatapacks, useRemoveDatapack } from "@/hooks/useWorlds";
import { api } from "@/lib/api";
import { TYPE_LABEL_KEYS } from "@/lib/catalog";
import { toastError } from "@/lib/toast";
import { useI18n } from "@/i18n";
import type { Instance, World } from "@/lib/types";
import { DropHint, rejectedFileToast } from "./dropFiles";
import { GuardedButton } from "./guards";
import { WORLD_DIALOG_WIDTH } from "./worldDialog";

const isZip = (path: string) => /\.zip$/i.test(path);

/** Was `level.dat` über ein Datenpaket sagt; schalten kann es nur das Spiel. */
function PackState({ enabled }: { enabled: boolean | null }) {
  const { t } = useI18n();
  if (enabled == null) return <Chip size="s">{t("detail.worlds.packNotLoaded")}</Chip>;
  return (
    <Chip size="s" dot tone={enabled ? "run" : "neutral"}>
      {enabled ? t("detail.worlds.packActive") : t("detail.worlds.packOff")}
    </Chip>
  );
}

/** Datenpakete einer Welt: eigene Zips (Auswahl oder aufs Fenster ziehen), Katalog über `onSearch`, Papierkorb. */
export function DatapacksDialog({ instance, world, busy, onSearch, onClose }: {
  instance: Instance; world: World; busy: string | null; onSearch: () => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const packs = useDatapacks(instance.id, world.id);
  const add = useAddDatapacks(instance.id, world.id);
  const remove = useRemoveDatapack(instance.id, world.id);
  const dragging = useFileDrop(true, take);

  function take(paths: string[]) {
    if (busy) return void toast.error(busy);
    const other = paths.find((p) => !isZip(p));
    if (other) rejectedFileToast(other, t("detail.worlds.packsAllowed"));
    const zips = paths.filter(isZip);
    if (zips.length) add.mutate(zips);
  }

  async function pick() {
    const picked = await api.pickPaths({ multiple: true, filters: [{ name: t(TYPE_LABEL_KEYS.datapack), extensions: ["zip"] }] });
    if (picked.length) take(picked);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t(TYPE_LABEL_KEYS.datapack)}
      sub={world.name}
      width={WORLD_DIALOG_WIDTH}
      footer={<DialogActions cancel={t("common.close")} />}
    >
      <Actions className="mb-3">
        {/* Eigene Dateien gibt es nur in der App: der Browser liefert keine Pfade. */}
        {api.capabilities.pickPaths && (
          <GuardedButton size="s" icon="ul" blocked={busy} disabled={add.isPending} onClick={() => void pick().catch(toastError)}>
            {t("detail.content.addFile")}
          </GuardedButton>
        )}
        <GuardedButton size="s" icon="search" blocked={busy} onClick={onSearch}>{t("detail.worlds.searchModrinth")}</GuardedButton>
      </Actions>
      {dragging ? (
        <div className="drop over" aria-hidden>
          <DropHint>{t("detail.worlds.packDropHint")}</DropHint>
        </div>
      ) : (
        <QueryList
          query={packs}
          error={t("detail.worlds.packsLoadError")}
          empty={<Empty size="pane" title={t("detail.worlds.packsEmptyTitle")}>{t("detail.worlds.packsEmptyHint")}</Empty>}
        >
          {(list) => (
            <List variant="versions" aria-label={t(TYPE_LABEL_KEYS.datapack)}>
              {list.map((pack) => (
                <ListRow key={pack.id}>
                  <RowTitle title={pack.name} sub={pack.description} />
                  <Actions gap={4}>
                    <PackState enabled={pack.enabled} />
                    <IconButton
                      size="s"
                      icon="trash"
                      label={t("detail.worlds.packTrashAria", { name: pack.name })}
                      tip={t("detail.worlds.toTrash")}
                      disabled={!!busy || remove.isPending}
                      onClick={() => remove.mutate(pack)}
                    />
                  </Actions>
                </ListRow>
              ))}
            </List>
          )}
        </QueryList>
      )}
      <Hint className="mt-3">{t("detail.worlds.packActiveHint")}</Hint>
    </Dialog>
  );
}
