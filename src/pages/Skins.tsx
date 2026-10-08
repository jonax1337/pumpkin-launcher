import { useState } from "react";
import { useI18n } from "@/i18n";
import { QueryList } from "@/components/QueryList";
import { SkelList } from "@/components/SkelList";
import { SkinViewer } from "@/components/SkinViewer";
import { startMsLogin } from "@/store/accountUi";
import { useConfirmTarget } from "@/hooks/useConfirmTarget";
import { useFileDrop } from "@/hooks/useFileDrop";
import {
  useAddSkin, useDeleteSkin, useResetSkin, useSaveActiveSkin, useSkinLibrary, useSkinProfile, useSkinSignature,
} from "@/hooks/useSkins";
import { api } from "@/lib/api";
import { toastError } from "@/lib/toast";
import { type LibrarySkin } from "@/lib/types";
import { useUsableAccount } from "@/store/offline";
import type { ActiveAccount } from "@/store/settings";
import {
  Actions, Button, CardGrid, ConfirmDialog, ContextMenu, Count, Empty, ErrorBox, Hint, IconButton, Menu, Page, PageHeader, SectionHeader, Skel, StatusPanel, Tip, Workspace, WorkspaceContent, WorkspaceRail,
  type MenuEntry,
} from "@/ui";
import { DropHint, rejectedFileToast } from "./detail/dropFiles";
import { CapesPanel } from "./skins/CapesPanel";
import { PlayerSkinDialog, RenameDialog, SkinCard, type WornLook } from "./skins/SkinCard";
import "./skins/skins.css";

const newestFirst = (a: LibrarySkin, b: LibrarySkin) => b.addedAt - a.addedAt;

type MicrosoftAccount = Extract<ActiveAccount, { kind: "microsoft" }>;

const isPng = (path: string) => path.toLowerCase().endsWith(".png");

export function SkinsPage() {
  const { t } = useI18n();
  const active = useUsableAccount();
  const account = active?.kind === "microsoft" ? active : null;
  const add = useAddSkin();
  const library = useSkinLibrary();
  const [loadingPlayer, setLoadingPlayer] = useState(false);
  const [picking, setPicking] = useState(false);
  const adding = add.isPending || picking || loadingPlayer;

  async function pickFile() {
    if (!api.capabilities.pickPaths || adding) return;
    setPicking(true);
    try {
      const [path] = await api.pickPaths({ filters: [{ name: t("pages.skins.fileDialogSkin"), extensions: ["png"] }] });
      if (path) add.mutate(path);
    } finally {
      setPicking(false);
    }
  }

  const addMenu: MenuEntry[] = [
    {
      id: "file", text: t("pages.skins.addFromFile"), icon: "file", disabled: !api.capabilities.pickPaths || adding,
      onSelect: () => void pickFile().catch(toastError),
    },
    { id: "player", text: t("pages.skins.addByName"), icon: "user", disabled: adding, onSelect: () => setLoadingPlayer(true) },
  ];
  const menu: MenuEntry[] = [
    ...addMenu,
    "-",
    { id: "refresh", text: t("ui.context.refresh"), disabled: library.isFetching || adding, onSelect: () => void library.refetch() },
  ];
  // PNG-Dateien aufs Fenster ziehen nimmt sie in die Bibliothek auf (nur in der App, der Browser kennt keine Pfade).
  const dragging = useFileDrop(true, (paths) => {
    for (const path of paths) (isPng(path) ? add.mutate(path) : rejectedFileToast(path, t("pages.skins.dropAllowed")));
  });
  return (
    <ContextMenu items={menu}>
    <Page className="skins">
      <PageHeader title={t("ui.nav.skins")}>
        <Menu
          items={addMenu}
          trigger={<Button variant="primary" icon="plus" iconEnd="chev-down" disabled={adding}>{t("pages.skins.addSkin")}</Button>}
        />
      </PageHeader>
      {!account && <NeedsMicrosoft />}
      <Workspace rail={account ? (
          <WorkspaceRail aria-label={t("pages.skins.currentSkinLabel", { name: account.username })}>
            <CurrentLook account={account} />
          </WorkspaceRail>
        ) : undefined}>
        <Library account={account} />
      </Workspace>
      {account && <CapesPanel accountId={account.id} />}
      {dragging && (
        <div className="drop over skins-drop" aria-hidden>
          <div className="skins-drop-hint">
            <DropHint>{t("pages.skins.dropAllowed")}</DropHint>
          </div>
        </div>
      )}
      {loadingPlayer && <PlayerSkinDialog onClose={() => setLoadingPlayer(false)} />}
    </Page>
    </ContextMenu>
  );
}

function NeedsMicrosoft() {
  const { t } = useI18n();
  return (
    <StatusPanel
      icon="user"
      title={t("pages.skins.needsMsTitle")}
      actions={<Button icon="microsoft" onClick={() => void startMsLogin()}>{t("components.account.msLogin")}</Button>}
    >
      {t("pages.skins.needsMsBody")}
    </StatusPanel>
  );
}

/** Was das Konto bei Minecraft gerade trägt: Skin und Umhang, dazu Speichern und Zurücksetzen. */
function CurrentLook({ account }: { account: MicrosoftAccount }) {
  const { t } = useI18n();
  const profile = useSkinProfile(account.id);
  const save = useSaveActiveSkin();
  const reset = useResetSkin();
  const resetConfirm = useConfirmTarget<MicrosoftAccount>();

  if (profile.error) {
    const retry = () => void profile.refetch();
    return <ErrorBox title={t("pages.skins.loadErrorTitle")} error={profile.error} onRetry={retry} />;
  }
  if (!profile.data) return <Skel h={336} />;
  const { skin, capes } = profile.data;
  const cape = capes.find((c) => c.active);

  return (
    <div className="skins-current">
      <SkinViewer
        src={skin?.url}
        variant={skin?.variant ?? "classic"}
        capeSrc={cape?.url}
        zoom={2}
        label={t("pages.skins.currentSkinLabel", { name: account.username })}
      />
      <div className="skins-current-details">
        <SectionHeader title={account.username} size="sub" as="h2" />
        <Hint>{skin ? t("pages.skins.modelLine", { model: t(`pages.skins.variant.${skin.variant}`) }) : t("pages.skins.defaultSkin")}</Hint>
        <Actions wrap>
          <Button
            icon="save"
            disabled={!skin || save.isPending}
            onClick={() => save.mutate({ accountId: account.id, name: account.username })}
          >
            {t("pages.skins.saveToLibrary")}
          </Button>
          <Button variant="ghost" icon="undo" onClick={() => resetConfirm.ask(account)}>{t("pages.skins.useDefault")}</Button>
        </Actions>
      </div>
      <ConfirmDialog
        {...resetConfirm.dialogProps({
          title: () => t("pages.skins.useDefaultTitle"),
          text: () => t("pages.skins.useDefaultText"),
          confirmLabel: t("pages.settings.resetLabel"),
          pending: reset.isPending,
          onConfirm: ({ id }, close) => reset.mutate({ accountId: id }, { onSuccess: close }),
        })}
      />
    </div>
  );
}

/** Der Fingerabdruck des getragenen Skins, sobald sein Bild gelesen ist. */
function useWornLook(skin: { url: string; variant: WornLook["variant"] } | null | undefined): WornLook | null {
  const signature = useSkinSignature(skin?.url, skin?.url);
  return skin && signature ? { signature, variant: skin.variant } : null;
}

/** Lokale Skins: hinzufügen, umbenennen, Modell wählen, löschen und mit einem Microsoft-Konto verwenden. */
function Library({ account }: { account: MicrosoftAccount | null }) {
  const { t } = useI18n();
  const library = useSkinLibrary();
  const profile = useSkinProfile(account?.id ?? null);
  const worn = useWornLook(profile.data?.skin);
  const remove = useDeleteSkin();
  const [renaming, setRenaming] = useState<LibrarySkin | null>(null);
  const removal = useConfirmTarget<LibrarySkin>();
  // Umhang der Vorschau: der, den das Konto trägt.
  const previewCape = profile.data?.capes.find((c) => c.active);

  return (
    <WorkspaceContent role="region" className="skins-library" aria-labelledby="skin-lib">
      <SectionHeader
        id="skin-lib"
        title={<>{t("pages.skins.libraryTitle")}{library.data && <Count value={library.data.length} muted />}</>}
        info={
          <Tip label={t("pages.skins.libraryHelp")} describe>
            <IconButton icon="info" size="s" label={t("pages.skins.libraryTitle")} />
          </Tip>
        }
      />
      <div className="skins-grid">
        <QueryList
          query={library}
          error={t("pages.instances.loadErrorTitle")}
          loading={
            <CardGrid aria-busy aria-label={t("components.common.loadingAria")}>
              <SkelList n={3} h={308} />
            </CardGrid>
          }
          empty={
            <Empty title={t("pages.skins.emptyTitle")}>
              {t("pages.skins.emptyBody")}
            </Empty>
          }
        >
          {(list) => (
            <CardGrid>
              {[...list].sort(newestFirst).map((skin) => (
                <SkinCard
                  key={skin.id}
                  skin={skin}
                  accountId={account?.id ?? null}
                  capeUrl={previewCape?.url}
                  worn={worn}
                  onRename={() => setRenaming(skin)}
                  onDelete={() => removal.ask(skin)}
                />
              ))}
            </CardGrid>
          )}
        </QueryList>
      </div>
      {renaming && <RenameDialog key={renaming.id} skin={renaming} onClose={() => setRenaming(null)} />}
      <ConfirmDialog
        {...removal.dialogProps({
          title: (skin) => t("components.instance.deleteQuotedTitle", { name: skin.name }),
          text: () => t("pages.skins.deleteText"),
          pending: remove.isPending,
          onConfirm: (skin, close) => remove.mutate(skin.id, { onSuccess: close }),
        })}
      />
    </WorkspaceContent>
  );
}
