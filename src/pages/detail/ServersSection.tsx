import { useState, type FormEvent } from "react";
import {
  Cell, ConfirmDialog, Dialog, DialogActions, Empty, Field, Glyph, IconButton, List, ListRow, Menu, ProjectIcon, RowTitle, SectionHeader, Segmented,
  TextField, type MenuEntry,
} from "@/ui";
import { QueryList } from "@/components/QueryList";
import { useRemoveServer, useSaveServer, useServers } from "@/hooks/useWorlds";
import type { Instance, Server } from "@/lib/types";
import { GuardedButton, type SectionProps } from "./guards";

const NEW_SERVER: Server = { name: "", address: "", icon: null, acceptTextures: null };

/** Serverliste der Instanz (`servers.dat`): hineinspielen, hinzufügen, bearbeiten, entfernen. */
export function ServersSection({ instance, busy, onPlay }: SectionProps) {
  const servers = useServers(instance.id);
  const remove = useRemoveServer(instance.id);
  // Server im Dialog; `index` null = neu.
  const [editing, setEditing] = useState<{ index: number | null; server: Server } | null>(null);
  const [removing, setRemoving] = useState<{ index: number; server: Server } | null>(null);
  const addButton = (
    <GuardedButton size="s" icon="plus" blocked={busy} onClick={() => setEditing({ index: null, server: NEW_SERVER })}>
      Hinzufügen
    </GuardedButton>
  );

  const menuFor = (server: Server, index: number): MenuEntry[] => [
    { id: "edit", text: "Bearbeiten…", icon: "file", disabled: !!busy, onSelect: () => setEditing({ index, server }) },
    "-",
    { id: "rm", text: "Entfernen…", icon: "trash", bad: true, disabled: !!busy, onSelect: () => setRemoving({ index, server }) },
  ];

  return (
    <section className="mt-8" aria-labelledby="servers-h">
      <SectionHeader id="servers-h" title="Server" actions={addButton} />
      <div className="mt-3">
        <QueryList
          query={servers}
          error="Die Serverliste konnte nicht geladen werden"
          empty={
            <Empty ill={<Glyph name="compass" pal="copper" box={64} />} title="Noch keine Server" actions={addButton}>
              Füge einen Server hinzu, dann landest du mit einem Klick direkt dort.
            </Empty>
          }
        >
          {(list) => (
            <List variant="worlds" divided aria-label="Server">
              {list.map((server, index) => (
                // Die Serverliste darf denselben Server mehrmals enthalten; die Stelle ist der Schlüssel.
                <ListRow key={index} menu={menuFor(server, index)}>
                  <ProjectIcon url={server.icon} seed={server.address} />
                  <RowTitle title={server.name || server.address} sub={server.address} />
                  <Cell flex align="end">
                    <GuardedButton size="s" icon="play" blocked={busy} aria-label={`Spielen: ${server.name}`} onClick={() => onPlay({ type: "server", address: server.address })}>
                      Spielen
                    </GuardedButton>
                  </Cell>
                  <Menu items={menuFor(server, index)} trigger={<IconButton size="s" icon="more" tip={false} label={`Mehr zu ${server.name}`} />} />
                </ListRow>
              ))}
            </List>
          )}
        </QueryList>
      </div>
      {editing && <ServerDialog key={editing.index ?? "new"} instance={instance} {...editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`„${removing?.server.name ?? ""}“ entfernen?`}
        text="Der Server verschwindet aus der Serverliste im Spiel."
        confirmLabel="Entfernen"
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing, { onSuccess: () => setRemoving(null) })}
      />
    </section>
  );
}

type TexturePolicy = "prompt" | "accept" | "reject";

/** Ressourcenpakete des Servers, wie im Spiel unter „Server bearbeiten“; `accept` ist der Wert von `acceptTextures`. */
const TEXTURE_POLICIES: { value: TexturePolicy; label: string; accept: boolean | null }[] = [
  { value: "prompt", label: "Nachfragen", accept: null },
  { value: "accept", label: "Annehmen", accept: true },
  { value: "reject", label: "Ablehnen", accept: false },
];

function ServerDialog({ instance, index, server, onClose }: { instance: Instance; index: number | null; server: Server; onClose: () => void }) {
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
      title={index == null ? "Server hinzufügen" : "Server bearbeiten"}
      width={480}
      footer={<DialogActions cancel="Abbrechen" confirm={{ label: save.isPending ? "Speichert" : "Speichern", width: 130, form: "server-form", disabled: !ready || save.isPending }} />}
    >
      <form id="server-form" onSubmit={submit}>
        <Field label="Name">
          <TextField value={name} onChange={(e) => setName(e.target.value)} maxLength={64} autoFocus />
        </Field>
        <Field label="Adresse" help="Zum Beispiel play.example.net oder play.example.net:25565">
          <TextField value={address} onChange={(e) => setAddress(e.target.value)} maxLength={255} spellCheck={false} />
        </Field>
        <Field label="Ressourcenpakete des Servers" group>
          <Segmented size="s" label="Ressourcenpakete des Servers" value={policy} onChange={setPolicy} items={TEXTURE_POLICIES} />
        </Field>
      </form>
    </Dialog>
  );
}
