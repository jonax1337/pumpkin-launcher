import { useState, type FormEvent } from "react";
import {
  Cell, ConfirmDialog, Dialog, DialogActions, Empty, Field, Glyph, IconButton, List, ListRow, Menu, ProjectIcon, RowTitle, SectionHeader, Segmented,
  TextField, type MenuEntry,
} from "@/ui";
import { QueryList } from "@/components/QueryList";
import { useConfirmTarget } from "@/hooks/useConfirmTarget";
import { useRemoveServer, useSaveServer, useServers } from "@/hooks/useWorlds";
import { useI18n } from "@/i18n";
import type { Instance, Server } from "@/lib/types";
import { GuardedButton, type SectionProps } from "./guards";

const NEW_SERVER: Server = { name: "", address: "", icon: null, acceptTextures: null };

/** Serverliste der Instanz (`servers.dat`): hineinspielen, hinzufügen, bearbeiten, entfernen. */
export function ServersSection({ instance, busy, onPlay }: SectionProps) {
  const { t } = useI18n();
  const servers = useServers(instance.id);
  const remove = useRemoveServer(instance.id);
  // Server im Dialog; `index` null = neu.
  const [editing, setEditing] = useState<{ index: number | null; server: Server } | null>(null);
  const removal = useConfirmTarget<{ index: number; server: Server }>();
  const addButton = (
    <GuardedButton size="s" icon="plus" blocked={busy} onClick={() => setEditing({ index: null, server: NEW_SERVER })}>
      {t("common.add")}
    </GuardedButton>
  );

  const menuFor = (server: Server, index: number): MenuEntry[] => [
    { id: "edit", text: t("detail.servers.editMenu"), icon: "file", disabled: !!busy, onSelect: () => setEditing({ index, server }) },
    "-",
    { id: "rm", text: t("detail.servers.removeMenu"), icon: "trash", bad: true, disabled: !!busy, onSelect: () => removal.ask({ index, server }) },
  ];

  return (
    <section className="mt-8" aria-labelledby="servers-h">
      <SectionHeader id="servers-h" title={t("common.server")} actions={addButton} />
      <div className="mt-3">
        <QueryList
          query={servers}
          error={t("detail.servers.loadError")}
          empty={
            <Empty ill={<Glyph name="compass" pal="copper" box={64} />} title={t("detail.servers.emptyTitle")} actions={addButton}>
              {t("detail.servers.emptyHint")}
            </Empty>
          }
        >
          {(list) => (
            <List variant="worlds" divided aria-label={t("common.server")}>
              {list.map((server, index) => (
                // Die Serverliste darf denselben Server mehrmals enthalten; die Stelle ist der Schlüssel.
                <ListRow key={index} menu={menuFor(server, index)}>
                  <ProjectIcon url={server.icon} seed={server.address} />
                  <RowTitle title={server.name || server.address} sub={server.address} />
                  <Cell flex align="end">
                    <GuardedButton size="s" icon="play" blocked={busy} aria-label={t("components.game.ariaPlay", { name: server.name })} onClick={() => onPlay({ type: "server", address: server.address })}>
                      {t("common.play")}
                    </GuardedButton>
                  </Cell>
                  <Menu items={menuFor(server, index)} trigger={<IconButton size="s" icon="more" tip={false} label={t("detail.content.moreAbout", { name: server.name })} />} />
                </ListRow>
              ))}
            </List>
          )}
        </QueryList>
      </div>
      {editing && <ServerDialog key={editing.index ?? "new"} instance={instance} {...editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        {...removal.dialogProps({
          title: ({ server }) => t("detail.servers.removeTitle", { name: server.name }),
          text: () => t("detail.servers.removeText"),
          confirmLabel: t("common.remove"),
          pending: remove.isPending,
          onConfirm: (target, close) => remove.mutate(target, { onSuccess: close }),
        })}
      />
    </section>
  );
}

type TexturePolicy = "prompt" | "accept" | "reject";

/** Ressourcenpakete des Servers, wie im Spiel unter „Server bearbeiten“; `accept` ist der Wert von `acceptTextures`. */
const TEXTURE_POLICIES: { value: TexturePolicy; accept: boolean | null }[] = [
  { value: "prompt", accept: null },
  { value: "accept", accept: true },
  { value: "reject", accept: false },
];

function ServerDialog({ instance, index, server, onClose }: { instance: Instance; index: number | null; server: Server; onClose: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(server.name);
  const [address, setAddress] = useState(server.address);
  const [policy, setPolicy] = useState(TEXTURE_POLICIES.find((p) => p.accept === server.acceptTextures)?.value ?? "prompt");
  const save = useSaveServer(instance.id);
  const ready = name.trim() !== "" && address.trim() !== "";

  function submit(e: FormEvent) {
    e.preventDefault();
    const acceptTextures = TEXTURE_POLICIES.find((p) => p.value === policy)?.accept ?? null;
    if (ready) save.mutate({ index, server: { ...server, name, address, acceptTextures } }, { onSuccess: onClose });
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={index == null ? t("detail.servers.addTitle") : t("detail.servers.editTitle")}
      width={480}
      footer={<DialogActions cancel={t("common.cancel")} confirm={{ label: save.isPending ? t("detail.servers.saving") : t("common.save"), width: 130, form: "server-form", disabled: !ready || save.isPending }} />}
    >
      <form id="server-form" onSubmit={submit}>
        <Field label={t("common.name")}>
          <TextField value={name} onChange={(e) => setName(e.target.value)} maxLength={64} autoFocus />
        </Field>
        <Field label={t("detail.servers.addressLabel")} help={t("detail.servers.addressHelp")}>
          <TextField value={address} onChange={(e) => setAddress(e.target.value)} maxLength={255} spellCheck={false} />
        </Field>
        <Field label={t("detail.servers.texturePolicyLabel")} group>
          <Segmented
            size="s"
            label={t("detail.servers.texturePolicyLabel")}
            value={policy}
            onChange={setPolicy}
            items={[
              { value: "prompt", label: t("detail.servers.textures.ask") },
              { value: "accept", label: t("detail.servers.textures.allow") },
              { value: "reject", label: t("detail.servers.textures.reject") },
            ]}
          />
        </Field>
      </form>
    </Dialog>
  );
}
