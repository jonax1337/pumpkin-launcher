import { useI18n } from "@/i18n";
import { Button, ChipLink, Count, HeroMeta, HeroTitle, Meta } from "@/ui";
import { isGameLive, usePhase } from "@/components/play/phase";
import { lastPlayedLine, loaderLine } from "@/components/common";
import { useModUpdates } from "@/hooks/useContent";
import { usePlay } from "@/hooks/usePlay";
import { updatesLabel } from "@/lib/format";
import { instanceUrl } from "@/lib/routes";
import { quickPlayTarget, type Instance } from "@/lib/types";

/** Titel und Metazeile der ausgewählten Instanz (Infos als Text; Knöpfe nur für „Updates“ und „Weiterspielen in …“). */
export function HeroInfo({ instance }: { instance: Instance }) {
  const { t } = useI18n();
  // Update-Abfrage nur für die Hero-Instanz und nur mit Inhalten; 10 Minuten gecacht (wie im Detail).
  const updates = useModUpdates(instance.id, instance.mods.length > 0);
  const phase = usePhase(instance.id);
  const play = usePlay();
  const contentCount = instance.mods.length;
  const updateCount = updates.data?.length ?? 0;
  // Während des Spiels sagt der Knopf „Läuft seit …“; „Zuletzt gespielt in dieser Minute“ wäre doppelt.
  const playing = isGameLive(phase);
  // Der Ordnername statt des Weltnamens: den kennt nur die Weltenliste, und die liest jede Welt vom Datenträger.
  const resume = playing || phase === "preparing" ? null : instance.lastQuickPlay;
  return (
    <div className="hero-k rise">
      <HeroTitle as="h2" size="xl" title={instance.name}>{instance.name}</HeroTitle>
      <HeroMeta outline>
        <Meta
          size="l"
          onScene
          items={[
            loaderLine(instance),
            <>
              <Count value={contentCount} /> {t(contentCount === 1 ? "pages.home.contentCount.one" : "pages.home.contentCount.other")}
            </>,
            !playing && lastPlayedLine(instance),
          ]}
        />
        {updateCount > 0 && (
          // Chip-Knopf im Warnton, derselbe Aufbau wie im Instanzkopf: Pfeil, „Updates“ und Zähler
          <ChipLink to={instanceUrl(instance.id, "content")} tone="warn" icon="update">
            {updatesLabel(updateCount)}
            <Count value={updateCount} />
          </ChipLink>
        )}
        {resume && (
          <Button size="s" icon="play" onScene onClick={() => void play(instance, undefined, resume)}>
            {t("pages.home.resumeIn", { world: quickPlayTarget(resume) })}
          </Button>
        )}
      </HeroMeta>
    </div>
  );
}
