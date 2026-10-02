import { useState } from "react";
import { useI18n } from "@/i18n";
import { QueryList } from "@/components/QueryList";
import { SkelList } from "@/components/SkelList";
import { SkinViewer } from "@/components/SkinViewer";
import { startMsLogin } from "@/store/accountUi";
import { useConfirmTarget } from "@/hooks/useConfirmTarget";
import { useFileDrop } from "@/hooks/useFileDrop";
import {
  useAddSkin, useDeleteSkin, useResetSkin, useSaveActiveSkin, useSetCape, useSkinLibrary, useSkinProfile, useSkinSignature,
} from "@/hooks/useSkins";
import { api } from "@/lib/api";
import { toastError } from "@/lib/toast";
import { type Cape, type LibrarySkin } from "@/lib/types";
import { useUsableAccount } from "@/store/offline";
import type { ActiveAccount } from "@/store/settings";
import {
  Actions, Button, CardGrid, ConfirmDialog, Empty, ErrorBox, Field, Hint, PageHeader, Panel, SectionHeader, Select, Skel, StatusPanel,
} from "@/ui";
import { DropHint, rejectedFileToast } from "./detail/dropFiles";
import { RenameDialog, SkinCard, type WornLook } from "./skins/SkinCard";

// Radix-Auswahlen kennen keinen leeren Wert.
const NO_CAPE = "none";

const newestFirst = (a: LibrarySkin, b: LibrarySkin) => b.addedAt - a.addedAt;

type MicrosoftAccount = Extract<ActiveAccount, { kind: "microsoft" }>;

const isPng = (path: string) => path.toLowerCase().endsWith(".png");

export function SkinsPage() {
  const { t } = useI18n();
  const active = useUsableAccount();
  const account = active?.kind === "microsoft" ? active : null;
  const add = useAddSkin();
  // PNG-Dateien aufs Fenster ziehen nimmt sie in die Bibliothek auf (nur in der App, der Browser kennt keine Pfade).
  const dragging = useFileDrop(true, (paths) => {
    for (const path of paths) (isPng(path) ? add.mutate(path) : rejectedFileToast(path, t("pages.skins.dropAllowed")));
  });
  return (
    <section className="page skins relative">
      <PageHeader title={t("ui.nav.skins")} />
      {account ? <CurrentLook account={account} /> : <NeedsMicrosoft />}
      <Library account={account} />
      {dragging && (
        <div className="drop over absolute inset-0 z-10 h-auto justify-start" aria-hidden>
          <div className="sticky top-[30vh] flex flex-col items-center gap-2 py-10">
            <DropHint>{t("pages.skins.dropAllowed")}</DropHint>
          </div>
        </div>
      )}
    </section>
  );
}

function NeedsMicrosoft() {
  const { t } = useI18n();
  return (
    <StatusPanel
      className="mt-4"
      icon="user"
      title={t("pages.skins.needsMsTitle")}
      actions={<Button icon="user" onClick={() => void startMsLogin()}>{t("components.account.msLogin")}</Button>}
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
    return <ErrorBox className="mt-4" title={t("pages.skins.loadErrorTitle")} error={profile.error} onRetry={retry} />;
  }
  if (!profile.data) return <Skel className="mt-4" h={336} />;
  const { skin, capes } = profile.data;
  const cape = capes.find((c) => c.active);

  return (
    <Panel pad="l" className="skin-now mt-4">
      <SkinViewer
        src={skin?.url}
        variant={skin?.variant ?? "classic"}
        capeSrc={cape?.url}
        zoom={3}
        label={t("pages.skins.currentSkinLabel", { name: account.username })}
      />
      <div className="skin-now-t">
        <SectionHeader title={account.username} size="sub" as="h2" />
        <Hint>{skin ? t("pages.skins.modelLine", { model: t(`pages.skins.variant.${skin.variant}`) }) : t("pages.skins.defaultSkin")}</Hint>
        <CapeChoice accountId={account.id} capes={capes} />
        <Actions wrap>
          <Button
            icon="save"
            disabled={!skin || save.isPending}
            onClick={() => save.mutate({ accountId: account.id, name: account.username })}
          >
            {t("pages.skins.saveToLibrary")}
          </Button>
          <Button variant="ghost" icon="redo" onClick={() => resetConfirm.ask(account)}>{t("pages.skins.useDefault")}</Button>
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
    </Panel>
  );
}

const capeOptions = (capes: Cape[], noneLabel: string) => [{ value: NO_CAPE, label: noneLabel }, ...capes.map((c) => ({ value: c.id, label: c.alias }))];

function CapeChoice({ accountId, capes }: { accountId: string; capes: Cape[] }) {
  const { t } = useI18n();
  const setCape = useSetCape();
  if (!capes.length) return <Hint>{t("pages.skins.noCapesHint")}</Hint>;
  return (
    <Field label={t("pages.skins.capeField")} htmlFor="skin-cape">
      <Select
        id="skin-cape"
        value={capes.find((c) => c.active)?.id ?? NO_CAPE}
        options={capeOptions(capes, t("pages.skins.noCapeOption"))}
        disabled={setCape.isPending}
        onChange={(id) => setCape.mutate({ accountId, cape: capes.find((c) => c.id === id) ?? null })}
      />
    </Field>
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
  const add = useAddSkin();
  const remove = useDeleteSkin();
  const [renaming, setRenaming] = useState<LibrarySkin | null>(null);
  const removal = useConfirmTarget<LibrarySkin>();
  // Umhang der Vorschau: ohne Wahl der, den das Konto trägt.
  const [chosenCape, setChosenCape] = useState<string>();
  const capes = profile.data?.capes ?? [];
  const previewCapeId = chosenCape ?? capes.find((c) => c.active)?.id ?? NO_CAPE;
  const previewCape = capes.find((c) => c.id === previewCapeId);

  async function pickFile() {
    const [path] = await api.pickPaths({ filters: [{ name: t("pages.skins.fileDialogSkin"), extensions: ["png"] }] });
    if (path) add.mutate(path);
  }

  return (
    <section className="mt-6" aria-labelledby="skin-lib">
      <SectionHeader
        id="skin-lib"
        title={t("pages.skins.libraryTitle")}
        actions={
          <Button icon="plus" disabled={add.isPending} onClick={() => void pickFile().catch(toastError)}>
            {t("pages.skins.addSkin")}
          </Button>
        }
      />
      <Hint className="mt-1">{t("pages.skins.libraryHelp")}</Hint>
      {capes.length > 0 && (
        <Field label={t("pages.skins.capePreviewField")} htmlFor="skin-cape-preview" className="mt-3 max-w-[360px]">
          <Select id="skin-cape-preview" value={previewCapeId} options={capeOptions(capes, t("pages.skins.noCapeOption"))} onChange={setChosenCape} />
        </Field>
      )}
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
    </section>
  );
}
