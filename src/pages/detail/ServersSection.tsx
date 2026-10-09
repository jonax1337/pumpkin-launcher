import { useState, type FormEvent } from "react";
import {
  Actions, Cell, ConfirmDialog, Count, Dialog, DialogActions, Empty, Field, Glyph, IconButton, Input, List, ListRow, Menu, RowTitle, SectionHeader,
  Segmented,
  type ListLayout,
  type MenuEntry,
} from "@/ui";
import { QueryList } from "@/components/QueryList";
import { useConfirmTarget } from "@/hooks/useConfirmTarget";
import { useRefreshServerStatus, useRemoveServer, useSaveServer, useServers, useServerStatus } from "@/hooks/useWorlds";
import { useI18n, type TKey } from "@/i18n";
import { isValidServerAddress, serverNameFromAddress, SERVER_ADDRESS_MAX_LENGTH } from "@/lib/serverAddress";
import type { Instance, Server } from "@/lib/types";
import { GuardedButton, type SectionProps } from "./guards";
import { KindTile } from "./KindTile";
import { ServerStatusCell } from "./ServerStatusCell";

const NEW_SERVER: Server = { name: "", address: "", icon: null, acceptTextures: null };

const SERVER_FORM_ID = "server-form";
const SAVE_BUTTON_CLASS = "w-[130px]";
const NAME_MAX_LENGTH = 64;

/** Serverliste: Symbol, Name mit Adresse, Status, Spielen, Menü; schmal rückt der Name zusammen. */
const SERVER_LIST: ListLayout = {
  cols: { base: "40px minmax(0,1fr) 150px 120px 36px", 720: "40px minmax(6rem,1fr) 120px 120px 36px" },
  density: "compact",
};

/** Serverliste der Instanz (`servers.dat`): hineinspielen, hinzufügen, bearbeiten, entfernen. */
export function ServersSection({ instance, busy, onPlay }: SectionProps) {
  const { t } = useI18n();
  const servers = useServers(instance.id);
  const remove = useRemoveServer(instance.id);
  // Server im Dialog; `index` null = neu.
  const [editing, setEditing] = useState<{ index: number | null; server: Server } | null>(null);
  const removal = useConfirmTarget<{ index: number; server: Server }>();
  const { fetching, refresh } = useRefreshServerStatus(instance.id);
  const addButton = (
    <GuardedButton size="s" icon="plus" blocked={busy} onClick={() => setEditing({ index: null, server: NEW_SERVER })}>
      {t("common.add")}
    </GuardedButton>
  );
  const refreshButton = (
    <IconButton size="s" icon="refresh" label={t("detail.servers.refresh")} disabled={fetching} onClick={() => void refresh()} />
  );

  const menuFor = (server: Server, index: number): MenuEntry[] => [
    { id: "edit", text: t("detail.servers.editMenu"), icon: "edit", disabled: !!busy, onSelect: () => setEditing({ index, server }) },
    "-",
    {
      id: "rm",
      text: t("detail.servers.removeMenu"),
      icon: "trash",
      bad: true,
      disabled: !!busy,
      onSelect: () => removal.ask({ index, server }),
    },
  ];

  return (
    <section aria-labelledby="servers-h">
      <SectionHeader
        id="servers-h"
        title={<>{t("common.server")}{servers.data && <Count value={servers.data.length} muted />}</>}
        actions={<Actions>{(servers.data?.length ?? 0) > 0 && refreshButton}{addButton}</Actions>}
      />
      <div className="wl-body">
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
            <List framed divided {...SERVER_LIST} aria-label={t("common.server")}>
              {list.map((server, index) => (
                // Die Serverliste darf denselben Server mehrmals enthalten; die Stelle ist der Schlüssel.
                <ServerRow key={index} instance={instance} server={server} menu={menuFor(server, index)} busy={busy} onPlay={onPlay} />
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

function ServerRow({ instance, server, menu, busy, onPlay }: SectionProps & { server: Server; menu: MenuEntry[] }) {
  const { t } = useI18n();
  const status = useServerStatus(instance.id, server.address);
  const { motd, version } = status.data ?? {};
  return (
    <ListRow menu={menu}>
      <KindTile url={server.icon} seed={server.address} icon="server" />
      <RowTitle title={server.name || server.address} sub={motd ? `${server.address} · ${motd}` : server.address} aside={version} asideClassName="le-720:hidden" />
      <ServerStatusCell status={status} />
      <Cell flex align="end">
        <GuardedButton
          size="s"
          icon="play"
          blocked={busy}
          aria-label={t("components.game.ariaPlay", { name: server.name })}
          onClick={() => onPlay({ type: "server", address: server.address })}
        >
          {t("common.play")}
        </GuardedButton>
      </Cell>
      <Menu
        items={menu}
        trigger={<IconButton size="s" icon="more" tip={false} label={t("detail.content.moreAbout", { name: server.name })} />}
      />
    </ListRow>
  );
}

type TexturePolicy = "prompt" | "accept" | "reject";

/** Ressourcenpakete des Servers, wie im Spiel unter „Server bearbeiten“; `accept` ist der Wert von `acceptTextures`. */
const TEXTURE_POLICIES: { value: TexturePolicy; accept: boolean | null; label: TKey }[] = [
  { value: "prompt", accept: null, label: "detail.servers.textures.ask" },
  { value: "accept", accept: true, label: "detail.servers.textures.allow" },
  { value: "reject", accept: false, label: "detail.servers.textures.reject" },
];

function ServerDialog({ instance, index, server, onClose }: {
  instance: Instance; index: number | null; server: Server; onClose: () => void;
}) {
  const { t } = useI18n();
  // Neue Server nehmen ihren Namen aus der Adresse, bis er selbst getippt wird.
  const [typedName, setTypedName] = useState<string | null>(index == null ? null : server.name);
  const [address, setAddress] = useState(server.address);
  const [policy, setPolicy] = useState(TEXTURE_POLICIES.find((p) => p.accept === server.acceptTextures)?.value ?? "prompt");
  const save = useSaveServer(instance.id);
  const name = typedName ?? serverNameFromAddress(address).slice(0, NAME_MAX_LENGTH);
  const addressMissing = address.trim() === "";
  const addressInvalid = !addressMissing && !isValidServerAddress(address);
  const ready = !addressMissing && !addressInvalid && name.trim() !== "";
  const blocker = addressMissing ? t("detail.servers.needAddress") : !addressInvalid && !ready ? t("detail.servers.needName") : null;

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
      size="s"
      footLeft={blocker}
      footer={
        <DialogActions
          cancel={t("common.cancel")}
          confirm={{
            label: save.isPending ? t("detail.servers.saving") : t("common.save"),
            className: SAVE_BUTTON_CLASS,
            form: SERVER_FORM_ID,
            disabled: !ready || save.isPending,
          }}
        />
      }
    >
      <form id={SERVER_FORM_ID} onSubmit={submit}>
        <Field
          label={t("detail.servers.addressLabel")}
          help={t("detail.servers.addressHelp")}
          error={addressInvalid && t("detail.servers.addressInvalid")}
          reserveLines={2}
        >
          <Input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={SERVER_ADDRESS_MAX_LENGTH} spellCheck={false} autoFocus />
        </Field>
        <Field label={t("common.name")}>
          <Input value={name} onChange={(e) => setTypedName(e.target.value)} maxLength={NAME_MAX_LENGTH} />
        </Field>
        <Field label={t("detail.servers.texturePolicyLabel")} group>
          <Segmented
            size="s"
            label={t("detail.servers.texturePolicyLabel")}
            value={policy}
            onChange={setPolicy}
            items={TEXTURE_POLICIES.map(({ value, label }) => ({ value, label: t(label) }))}
          />
        </Field>
      </form>
    </Dialog>
  );
}
