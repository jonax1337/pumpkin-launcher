import { useI18n } from "@/i18n";
import { SkinViewer } from "@/components/SkinViewer";
import { NameDialog } from "@/components/NameDialog";
import { useAddPlayerSkin, useSkinSignature, useSkinTexture, useUpdateSkin, useUploadSkin } from "@/hooks/useSkins";
import type { LibrarySkin, SkinVariant } from "@/lib/types";
import { Button, Chip, IconButton, Menu, Panel, Segmented, Tip, Trunc, type MenuEntry } from "@/ui";

const SKIN_VARIANTS: SkinVariant[] = ["classic", "slim"];

/** Was das Konto gerade trägt, als Fingerabdruck seiner Textur samt Modell; damit erkennt eine Karte, ob es ihr Skin ist. */
export type WornLook = { signature: string; variant: SkinVariant };

/** Ein Skin der Bibliothek: drehbare Vorschau (mit dem gewählten Umhang), Modell wählen, verwenden, umbenennen, löschen. */
export function SkinCard({ skin, accountId, capeUrl, worn, onRename, onDelete }: {
  skin: LibrarySkin;
  accountId: string | null;
  /** Umhang in der Vorschau; nichts, wenn keiner gewählt ist. */
  capeUrl?: string;
  worn: WornLook | null;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const texture = useSkinTexture(skin.id);
  const signature = useSkinSignature(skin.id, texture);
  const update = useUpdateSkin();
  const upload = useUploadSkin();
  const isWorn = signature != null && signature === worn?.signature && skin.variant === worn.variant;
  const menu: MenuEntry[] = [
    { id: "rename", text: t("common.rename"), icon: "tag", onSelect: onRename },
    { id: "delete", text: t("common.delete"), icon: "trash", bad: true, onSelect: onDelete },
  ];
  return (
    <Panel as="article" level="raised" pad="s" className="skin-card" data-active={isWorn ? "" : undefined} aria-label={skin.name}>
      {isWorn && <Chip className="skin-card-flag" tone="acc" icon="check" size="s">{t("pages.skins.inUseBadge")}</Chip>}
      <SkinViewer src={texture} variant={skin.variant} capeSrc={capeUrl} label={t("pages.skins.previewLabel", { name: skin.name })} />
      <div className="skin-card-h">
        <Trunc as="b" text={skin.name} className="skin-card-name" />
        <Menu
          items={menu}
          trigger={
            <IconButton
              icon="more"
              size="s"
              label={t("components.instance.moreActionsFor", { name: skin.name })}
              tip={t("components.instance.moreActions")}
            />
          }
        />
      </div>
      <Segmented
        size="s"
        label={t("pages.skins.modelOf", { name: skin.name })}
        value={skin.variant}
        items={SKIN_VARIANTS.map((value) => ({ value, label: t(`pages.skins.variant.${value}`), tip: t(`pages.skins.variant.${value}.tip`) }))}
        onChange={(variant) => update.mutate({ id: skin.id, name: skin.name, variant })}
      />
      {/* Ohne Konto bleibt der Knopf erreichbar und nennt den Grund, statt wortlos grau zu sein. */}
      <Tip label={accountId ? null : t("pages.skins.useNeedsAccount")} describe>
        <Button
          icon={isWorn ? "check" : undefined}
          width="full"
          disabled={upload.isPending || isWorn}
          aria-disabled={accountId ? undefined : true}
          onClick={() => accountId && upload.mutate({ accountId, skin })}
        >
          {upload.isPending ? t("pages.skins.using") : t(isWorn ? "pages.skins.used" : "pages.skins.use")}
        </Button>
      </Tip>
    </Panel>
  );
}

/** Minecraft-Spielernamen sind höchstens 16 Zeichen lang. */
const MAX_PLAYER_NAME_LEN = 16;

/** Fragt nach einem Spielernamen und legt den Skin, den dieser Spieler trägt, in der Bibliothek ab. */
export function PlayerSkinDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const add = useAddPlayerSkin();
  return (
    <NameDialog
      title={t("pages.skins.playerDialogTitle")}
      label={t("pages.skins.playerField")}
      help={t("pages.skins.playerHelp")}
      initial=""
      maxLength={MAX_PLAYER_NAME_LEN}
      pending={add.isPending}
      confirm={{ label: t("pages.skins.playerLoad"), pending: t("pages.skins.playerLoading") }}
      onSubmit={(name) => add.mutate(name, { onSuccess: onClose })}
      onClose={onClose}
    />
  );
}

export function RenameDialog({ skin, onClose }: { skin: LibrarySkin; onClose: () => void }) {
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
