import { useI18n } from "@/i18n";
import { usePersistedState } from "@/hooks/usePersistedState";
import type { CatalogType } from "@/lib/content-types";
import { Icon, IconButton, Panel } from "@/ui";

/** Ein Satz, was dieser Reiter ist; wer ihn kennt, blendet ihn aus, und das gilt für diesen Reiter beim nächsten Start weiter. */
export function DiscoverIntro({ type }: { type: CatalogType }) {
  const { t } = useI18n();
  const [state, setState] = usePersistedState(`discover-intro-${type}`, ["shown", "hidden"]);
  if (state === "hidden") return null;
  return (
    <Panel level="sunk" pad="s" className="mb-3.5 flex items-center gap-3">
      <Icon name="info" tone="muted" />
      <p className="min-w-0 flex-1 text-fg-2">{t(`pages.discover.intro.${type}`)}</p>
      <IconButton icon="x" size="s" label={t("pages.discover.introDismiss")} onClick={() => setState("hidden")} />
    </Panel>
  );
}
