import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { QueryList } from "@/components/QueryList";
import { startMsLogin } from "@/components/PlayerNames";
import {
  useAddSkin, useDeleteSkin, useResetSkin, useSaveActiveSkin, useSetCape, useSkinLibrary, useSkinProfile, useSkinTexture, useUpdateSkin,
  useUploadSkin,
} from "@/hooks/useSkins";
import { api } from "@/lib/api";
import { toastError } from "@/lib/toast";
import { SKIN_VARIANT_LABELS, type Cape, type LibrarySkin, type SkinVariant } from "@/lib/types";
import { CapeFigure, SkinFigure } from "@/pixel/SkinFigure";
import { useUsableAccount } from "@/store/offline";
import type { ActiveAccount } from "@/store/settings";
import {
  Actions, Button, CardGrid, ConfirmDialog, Dialog, DialogActions, Empty, ErrorBox, Field, Hint, IconButton, Menu, PageHeader, Panel, SectionHeader,
  Segmented, Select, Skel, StatusPanel, TextField, Trunc, type MenuEntry,
} from "@/ui";

const VARIANTS = (Object.keys(SKIN_VARIANT_LABELS) as SkinVariant[]).map((value) => ({ value, label: SKIN_VARIANT_LABELS[value] }));
// Radix-Auswahlen kennen keinen leeren Wert.
const NO_CAPE = "none";

type MicrosoftAccount = Extract<ActiveAccount, { kind: "microsoft" }>;

export function SkinsPage() {
  const active = useUsableAccount();
  const account = active?.kind === "microsoft" ? active : null;
  return (
    <section className="page skins">
      <PageHeader title="Skins" />
      {account ? <CurrentLook account={account} /> : <NeedsMicrosoft />}
      <Library accountId={account?.id ?? null} />
    </section>
  );
}

function NeedsMicrosoft() {
  const qc = useQueryClient();
  return (
    <StatusPanel
      className="mt-4"
      icon="user"
      title="Skins brauchen ein Microsoft-Konto"
      actions={<Button icon="user" onClick={() => void startMsLogin(qc)}>Mit Microsoft anmelden</Button>}
    >
      Minecraft speichert Skin und Umhang in deinem Microsoft-Konto. Deine Bibliothek kannst du auch ohne Anmeldung pflegen.
    </StatusPanel>
  );
}

/** Was das Konto bei Minecraft gerade trägt: Skin und Umhang, dazu Speichern und Zurücksetzen. */
function CurrentLook({ account }: { account: MicrosoftAccount }) {
  const profile = useSkinProfile(account.id);
  const save = useSaveActiveSkin();
  const reset = useResetSkin();
  const [confirmReset, setConfirmReset] = useState(false);

  if (profile.error) return <ErrorBox className="mt-4" title="Dein Skin konnte nicht geladen werden" error={profile.error} onRetry={() => void profile.refetch()} />;
  if (!profile.data) return <Skel className="mt-4" h={336} />;
  const { skin, capes } = profile.data;
  const cape = capes.find((c) => c.active);

  return (
    <Panel pad="l" className="skin-now mt-4">
      <SkinFigure src={skin?.url} variant={skin?.variant ?? "classic"} zoom={3} label={`Aktueller Skin von ${account.username}`} />
      {cape && <CapeFigure src={cape.url} zoom={3} label={`Umhang ${cape.alias}`} />}
      <div className="skin-now-t">
        <SectionHeader title={account.username} size="sub" />
        <Hint>{skin ? `Modell ${SKIN_VARIANT_LABELS[skin.variant]}` : "Standardskin von Minecraft"}</Hint>
        <CapeChoice accountId={account.id} capes={capes} />
        <Actions wrap>
          <Button icon="save" disabled={!skin || save.isPending} onClick={() => save.mutate({ accountId: account.id, name: account.username })}>
            In Bibliothek speichern
          </Button>
          <Button variant="ghost" icon="redo" onClick={() => setConfirmReset(true)}>Standardskin tragen</Button>
        </Actions>
      </div>
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Standardskin tragen?"
        text="Dein jetziger Skin geht dabei verloren. Speichere ihn vorher in der Bibliothek, wenn du ihn behalten willst."
        confirmLabel="Zurücksetzen"
        pending={reset.isPending}
        onConfirm={() => reset.mutate({ accountId: account.id }, { onSuccess: () => setConfirmReset(false) })}
      />
    </Panel>
  );
}

function CapeChoice({ accountId, capes }: { accountId: string; capes: Cape[] }) {
  const setCape = useSetCape();
  if (!capes.length) return <Hint>Dieses Konto hat keine Umhänge.</Hint>;
  const options = [{ value: NO_CAPE, label: "Kein Umhang" }, ...capes.map((c) => ({ value: c.id, label: c.alias }))];
  return (
    <Field label="Umhang" htmlFor="skin-cape">
      <Select
        id="skin-cape"
        value={capes.find((c) => c.active)?.id ?? NO_CAPE}
        options={options}
        disabled={setCape.isPending}
        onChange={(id) => setCape.mutate({ accountId, cape: capes.find((c) => c.id === id) ?? null })}
      />
    </Field>
  );
}

/** Lokale Skins: hinzufügen, umbenennen, Modell wählen, löschen und mit einem Microsoft-Konto anziehen. */
function Library({ accountId }: { accountId: string | null }) {
  const library = useSkinLibrary();
  const add = useAddSkin();
  const remove = useDeleteSkin();
  const [renaming, setRenaming] = useState<LibrarySkin | null>(null);
  const [removing, setRemoving] = useState<LibrarySkin | null>(null);

  async function pickFile() {
    const path = await openFile({ multiple: false, directory: false, filters: [{ name: "Skin", extensions: ["png"] }] });
    if (typeof path === "string") add.mutate(path);
  }

  return (
    <section className="mt-6" aria-labelledby="skin-lib">
      <SectionHeader
        id="skin-lib"
        title="Bibliothek"
        actions={
          !api.isMock && (
            <Button icon="plus" disabled={add.isPending} onClick={() => void pickFile().catch(toastError)}>
              Skin hinzufügen
            </Button>
          )
        }
      />
      <div className="mt-3">
        <QueryList
          query={library}
          error="Die Bibliothek konnte nicht geladen werden"
          loading={
            <CardGrid aria-busy aria-label="Wird geladen">
              {[0, 1, 2].map((k) => <Skel key={k} h={308} />)}
            </CardGrid>
          }
          empty={
            <Empty ill="shirt" title="Noch keine Skins">
              Füge eine PNG-Datei mit 64×64 Pixeln hinzu oder speichere den Skin, den du gerade trägst.
            </Empty>
          }
        >
          {(list) => (
            <CardGrid>
              {[...list].sort((a, b) => b.addedAt - a.addedAt).map((skin) => (
                <SkinCard key={skin.id} skin={skin} accountId={accountId} onRename={() => setRenaming(skin)} onDelete={() => setRemoving(skin)} />
              ))}
            </CardGrid>
          )}
        </QueryList>
      </div>
      {renaming && <RenameDialog key={renaming.id} skin={renaming} onClose={() => setRenaming(null)} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`„${removing?.name ?? ""}“ löschen?`}
        text="Der Skin verschwindet aus deiner Bibliothek. Was du gerade trägst, bleibt."
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id, { onSuccess: () => setRemoving(null) })}
      />
    </section>
  );
}

function SkinCard({ skin, accountId, onRename, onDelete }: { skin: LibrarySkin; accountId: string | null; onRename: () => void; onDelete: () => void }) {
  const texture = useSkinTexture(skin.id);
  const update = useUpdateSkin();
  const upload = useUploadSkin();
  const menu: MenuEntry[] = [
    { id: "rename", text: "Umbenennen", icon: "file", onSelect: onRename },
    { id: "delete", text: "Löschen", icon: "trash", bad: true, onSelect: onDelete },
  ];
  return (
    <Panel as="article" pad="m" className="skin-card" aria-label={skin.name}>
      <SkinFigure src={texture} variant={skin.variant} label={`Vorschau von ${skin.name}`} />
      <div className="skin-card-h">
        <Trunc as="b" text={skin.name} className="min-w-0 flex-1" />
        <Menu items={menu} trigger={<IconButton icon="more" size="s" label={`Weitere Aktionen für ${skin.name}`} tip="Weitere Aktionen" />} />
      </div>
      <Segmented
        size="s"
        label={`Modell von ${skin.name}`}
        value={skin.variant}
        items={VARIANTS}
        onChange={(variant) => update.mutate({ id: skin.id, name: skin.name, variant })}
      />
      <Button
        variant="primary"
        size="s"
        width="full"
        disabled={!accountId || upload.isPending}
        onClick={() => accountId && upload.mutate({ accountId, skin })}
      >
        {upload.isPending ? "Wird angezogen" : "Anziehen"}
      </Button>
    </Panel>
  );
}

function RenameDialog({ skin, onClose }: { skin: LibrarySkin; onClose: () => void }) {
  const [name, setName] = useState(skin.name);
  const update = useUpdateSkin();
  function submit(e: FormEvent) {
    e.preventDefault();
    update.mutate({ id: skin.id, name: name.trim(), variant: skin.variant }, { onSuccess: onClose });
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Skin umbenennen"
      width={480}
      footer={<DialogActions cancel="Abbrechen" confirm={{ label: update.isPending ? "Speichert" : "Speichern", width: 130, form: "skin-name", disabled: update.isPending || !name.trim() }} />}
    >
      <form id="skin-name" onSubmit={submit}>
        <Field label="Name">
          <TextField value={name} onChange={(e) => setName(e.target.value)} maxLength={64} autoFocus />
        </Field>
      </form>
    </Dialog>
  );
}
