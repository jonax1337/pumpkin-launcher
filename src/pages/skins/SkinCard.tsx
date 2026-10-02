import { useI18n } from "@/i18n";
import { SkinViewer } from "@/components/SkinViewer";
import { NameDialog } from "@/components/NameDialog";
import { useSkinSignature, useSkinTexture, useUpdateSkin, useUploadSkin } from "@/hooks/useSkins";
import type { LibrarySkin, SkinVariant } from "@/lib/types";
import { Button, Chip, IconButton, Menu, Panel, Segmented, Tip, Trunc, type MenuEntry } from "@/ui";

const SKIN_VARIANTS: SkinVariant[] = ["classic", "slim"];

/** Was das Konto gerade trägt, als Fingerabdruck seiner Textur samt Modell; damit erkennt eine Karte, ob es ihr Skin ist. */
export type WornLook = { signature: string; variant: SkinVariant };

/** Ein Skin der Bibliothek: drehbare Vorschau (mit dem gewählten Umhang), Modell wählen, anziehen, umbenennen, löschen. */
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
    { id: "rename", text: t("common.rename"), icon: "file", onSelect: onRename },
    { id: "delete", text: t("common.delete"), icon: "trash", bad: true, onSelect: onDelete },
  ];
  return (
    <Panel as="article" pad="m" className="skin-card" aria-label={skin.name}>
      {isWorn && <Chip className="absolute -top-[11px] left-3 z-[1]" tone="acc" icon="check" size="s">{t("pages.skins.wornBadge")}</Chip>}
      <SkinViewer src={texture} variant={skin.variant} capeSrc={capeUrl} label={t("pages.skins.previewLabel", { name: skin.name })} />
      <div className="skin-card-h">
        <Trunc as="b" text={skin.name} className="min-w-0 flex-1" />
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
      <Tip label={accountId ? null : t("pages.skins.wearNeedsAccount")} describe>
        <Button
          variant="primary"
          size="s"
          width="full"
          disabled={upload.isPending}
          aria-disabled={accountId ? undefined : true}
          onClick={() => accountId && upload.mutate({ accountId, skin })}
        >
          {upload.isPending ? t("pages.skins.wearing") : t("pages.skins.wear")}
        </Button>
      </Tip>
    </Panel>
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
