import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { NameDialog } from "@/components/NameDialog";
import { QueryList } from "@/components/QueryList";
import { SkelList } from "@/components/SkelList";
import { startMsLogin } from "@/store/accountUi";
import { useConfirmTarget } from "@/hooks/useConfirmTarget";
import {
  useAddSkin, useDeleteSkin, useResetSkin, useSaveActiveSkin, useSetCape, useSkinLibrary, useSkinProfile, useSkinTexture, useUpdateSkin,
  useUploadSkin,
} from "@/hooks/useSkins";
import { api } from "@/lib/api";
import { toastError } from "@/lib/toast";
import { type Cape, type LibrarySkin, type SkinVariant } from "@/lib/types";
import { CapeFigure, SkinFigure } from "@/pixel/SkinFigure";
import { useUsableAccount } from "@/store/offline";
import type { ActiveAccount } from "@/store/settings";
import {
  Actions, Button, CardGrid, ConfirmDialog, Empty, ErrorBox, Field, Hint, IconButton, Menu, PageHeader, Panel, SectionHeader,
  Segmented, Select, Skel, StatusPanel, Trunc, type MenuEntry,
} from "@/ui";

// Radix-Auswahlen kennen keinen leeren Wert.
const NO_CAPE = "none";

type MicrosoftAccount = Extract<ActiveAccount, { kind: "microsoft" }>;

export function SkinsPage() {
  const { t } = useI18n();
  const active = useUsableAccount();
  const account = active?.kind === "microsoft" ? active : null;
  return (
    <section className="page skins">
      <PageHeader title={t("ui.nav.skins")} />
      {account ? <CurrentLook account={account} /> : <NeedsMicrosoft />}
      <Library accountId={account?.id ?? null} />
    </section>
  );
}

function NeedsMicrosoft() {
  const { t } = useI18n();
  const qc = useQueryClient();
  return (
    <StatusPanel
      className="mt-4"
      icon="user"
      title={t("pages.skins.needsMsTitle")}
      actions={<Button icon="user" onClick={() => void startMsLogin(qc)}>{t("components.account.msLogin")}</Button>}
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

  if (profile.error) return <ErrorBox className="mt-4" title={t("pages.skins.loadErrorTitle")} error={profile.error} onRetry={() => void profile.refetch()} />;
  if (!profile.data) return <Skel className="mt-4" h={336} />;
  const { skin, capes } = profile.data;
  const cape = capes.find((c) => c.active);

  return (
    <Panel pad="l" className="skin-now mt-4">
      <SkinFigure src={skin?.url} variant={skin?.variant ?? "classic"} zoom={3} label={t("pages.skins.currentSkinLabel", { name: account.username })} />
      {cape && <CapeFigure src={cape.url} zoom={3} label={t("pages.skins.capeFigureLabel", { name: cape.alias })} />}
      <div className="skin-now-t">
        <SectionHeader title={account.username} size="sub" />
        <Hint>{skin ? t("pages.skins.modelLine", { model: t(`pages.skins.variant.${skin.variant}`) }) : t("pages.skins.defaultSkin")}</Hint>
        <CapeChoice accountId={account.id} capes={capes} />
        <Actions wrap>
          <Button icon="save" disabled={!skin || save.isPending} onClick={() => save.mutate({ accountId: account.id, name: account.username })}>
            {t("pages.skins.saveToLibrary")}
          </Button>
          <Button variant="ghost" icon="redo" onClick={() => resetConfirm.ask(account)}>{t("pages.skins.wearDefault")}</Button>
        </Actions>
      </div>
      <ConfirmDialog
        {...resetConfirm.dialogProps({
          title: () => t("pages.skins.wearDefaultTitle"),
          text: () => t("pages.skins.wearDefaultText"),
          confirmLabel: t("pages.settings.resetLabel"),
          pending: reset.isPending,
          onConfirm: ({ id }, close) => reset.mutate({ accountId: id }, { onSuccess: close }),
        })}
      />
    </Panel>
  );
}

function CapeChoice({ accountId, capes }: { accountId: string; capes: Cape[] }) {
  const { t } = useI18n();
  const setCape = useSetCape();
  if (!capes.length) return <Hint>{t("pages.skins.noCapesHint")}</Hint>;
  const options = [{ value: NO_CAPE, label: t("pages.skins.noCapeOption") }, ...capes.map((c) => ({ value: c.id, label: c.alias }))];
  return (
    <Field label={t("pages.skins.capeField")} htmlFor="skin-cape">
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
  const { t } = useI18n();
  const library = useSkinLibrary();
  const add = useAddSkin();
  const remove = useDeleteSkin();
  const [renaming, setRenaming] = useState<LibrarySkin | null>(null);
  const removal = useConfirmTarget<LibrarySkin>();

  async function pickFile() {
    const [path] = await api.pickPaths({ filters: [{ name: t("pages.skins.fileDialogSkin"), extensions: ["png"] }] });
    if (path) add.mutate(path);
  }

  return (
    <section className="mt-6" aria-labelledby="skin-lib">
      <SectionHeader
        id="skin-lib"
        title={t("ui.nav.library")}
        actions={
          api.capabilities.pickPaths && (
            <Button icon="plus" disabled={add.isPending} onClick={() => void pickFile().catch(toastError)}>
              {t("pages.skins.addSkin")}
            </Button>
          )
        }
      />
      <div className="mt-3">
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
              {[...list].sort((a, b) => b.addedAt - a.addedAt).map((skin) => (
                <SkinCard key={skin.id} skin={skin} accountId={accountId} onRename={() => setRenaming(skin)} onDelete={() => removal.ask(skin)} />
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
    </section>
  );
}

function SkinCard({ skin, accountId, onRename, onDelete }: { skin: LibrarySkin; accountId: string | null; onRename: () => void; onDelete: () => void }) {
  const { t } = useI18n();
  const texture = useSkinTexture(skin.id);
  const update = useUpdateSkin();
  const upload = useUploadSkin();
  const menu: MenuEntry[] = [
    { id: "rename", text: t("common.rename"), icon: "file", onSelect: onRename },
    { id: "delete", text: t("common.delete"), icon: "trash", bad: true, onSelect: onDelete },
  ];
  return (
    <Panel as="article" pad="m" className="skin-card" aria-label={skin.name}>
      <SkinFigure src={texture} variant={skin.variant} label={t("pages.skins.previewLabel", { name: skin.name })} />
      <div className="skin-card-h">
        <Trunc as="b" text={skin.name} className="min-w-0 flex-1" />
        <Menu items={menu} trigger={<IconButton icon="more" size="s" label={t("components.instance.moreActionsFor", { name: skin.name })} tip={t("components.instance.moreActions")} />} />
      </div>
      <Segmented
        size="s"
        label={t("pages.skins.modelOf", { name: skin.name })}
        value={skin.variant}
        items={(["classic", "slim"] as SkinVariant[]).map((value) => ({ value, label: t(`pages.skins.variant.${value}`) }))}
        onChange={(variant) => update.mutate({ id: skin.id, name: skin.name, variant })}
      />
      <Button
        variant="primary"
        size="s"
        width="full"
        disabled={!accountId || upload.isPending}
        onClick={() => accountId && upload.mutate({ accountId, skin })}
      >
        {upload.isPending ? t("pages.skins.wearing") : t("pages.skins.wear")}
      </Button>
    </Panel>
  );
}

function RenameDialog({ skin, onClose }: { skin: LibrarySkin; onClose: () => void }) {
  const { t } = useI18n();
  const update = useUpdateSkin();
  return (
    <NameDialog
      title={t("pages.skins.renameTitle")}
      label={t("common.name")}
      initial={skin.name}
      maxLength={64}
      pending={update.isPending}
      onSubmit={(name) => update.mutate({ id: skin.id, name, variant: skin.variant }, { onSuccess: onClose })}
      onClose={onClose}
    />
  );
}
