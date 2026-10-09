import { CapePreview } from "@/components/CapePreview";
import { useRovingItems } from "@/hooks/useRovingItems";
import { useSetCape, useSkinProfile } from "@/hooks/useSkins";
import { useI18n } from "@/i18n";
import type { Cape } from "@/lib/types";
import { CardGrid, Count, Hint, Icon, PickCard, SectionHeader, WorkspaceContent } from "@/ui";

/** Umhänge des Kontos als Auswahlkarten (radiogroup): „Keiner“ zuerst, dann jeder Umhang; Klick, Enter oder Leertaste setzt ihn. */
export function CapesPanel({ accountId }: { accountId: string }) {
  const { t } = useI18n();
  const profile = useSkinProfile(accountId);
  const setCape = useSetCape();
  const roving = useRovingItems<HTMLDivElement>({ item: "[data-kit-item=pick]", primary: "[data-kit-item=pick]" });
  const capes = profile.data?.capes;
  if (!capes) return null;

  const wearing = capes.find((c) => c.active);
  const pick = (cape: Cape | null) => {
    if ((cape?.id ?? null) !== (wearing?.id ?? null)) setCape.mutate({ accountId, cape });
  };

  return (
    <WorkspaceContent role="region" aria-labelledby="skin-capes">
      <SectionHeader
        id="skin-capes"
        title={<>{t("pages.skins.capesTitle")}<Count value={capes.length} muted /></>}
        actions={<Hint icon={false}>{t("pages.skins.capesSync")}</Hint>}
      />
      {capes.length === 0 ? (
        <Hint>{t("pages.skins.noCapesHint")}</Hint>
      ) : (
        <CardGrid variant="pick" className="mt-3 grid-cols-[repeat(auto-fill,minmax(min(188px,100%),1fr))] gap-4" role="radiogroup" aria-label={t("pages.skins.capeField")} {...roving}>
          <PickCard
            media={<Icon name="close" size="l" />}
            title={t("pages.skins.capeNone")}
            sub={t("pages.skins.noCapeOption")}
            flag={t("pages.skins.inUseBadge")}
            selected={!wearing}
            disabled={setCape.isPending}
            onClick={() => pick(null)}
          />
          {capes.map((cape) => (
            <PickCard
              key={cape.id}
              media={<CapePreview src={cape.url} />}
              title={cape.alias}
              flag={t("pages.skins.inUseBadge")}
              selected={cape.active}
              disabled={setCape.isPending}
              onClick={() => pick(cape)}
            />
          ))}
        </CardGrid>
      )}
    </WorkspaceContent>
  );
}
