import type { RefObject } from "react";
import { useNavigate } from "react-router";
import { useI18n } from "@/i18n";
import { Actions, BackLink, Chip, ChipButton, Count, Heading, HeroMeta, HeroShade, HeroTitle, IconButton, Meta, Tip } from "@/ui";
import { playtimeLine } from "@/components/common";
import { InstanceMenuButton } from "@/components/instance";
import { PlayButton } from "@/components/play/PlayButton";
import { PlayStatus } from "@/components/play/PlayStatus";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { usePackStatus } from "@/hooks/usePackUpdate";
import { WIDTH } from "@/lib/breakpoints";
import { updatesLabel } from "@/lib/format";
import { LOADER_LABELS, type Instance } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PixelScene } from "@/pixel/PixelScene";
import { useLook } from "@/store/look";

/** Schmales Fenster: Loader-Version und Kurzinfo im kompakten Kopf entfallen. */
const useNarrow = () => useMediaQuery(`(max-width: ${WIDTH.sm}px)`);

/** Kopf der Instanzseite: Szene mit Name, Infos und Spielen; beim Scrollen wird er zur schmalen Leiste (`compact`). */
export function DetailHead({ instance, headRef, compact, updateCount, onShowUpdates, onShowPack, onLaunched }: {
  instance: Instance; headRef: RefObject<HTMLElement | null>; compact: boolean;
  updateCount: number; onShowUpdates: () => void; onShowPack: () => void; onLaunched: () => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const narrow = useNarrow();
  const look = useLook(instance.id);
  const pack = usePackStatus(instance);
  const loaderName = instance.loader === "vanilla" ? null : LOADER_LABELS[instance.loader];
  const minecraft = <>Minecraft <Count value={instance.minecraftVersion} size={20} /></>;

  return (
    <header ref={headRef} className={cn("dhead", compact && "compact")}>
      <PixelScene bio={look.bio} seed={look.seed} mode="live" className="scene" />
      <HeroShade />
      <div className="dh-full" aria-hidden={compact || undefined}>
        <div className="dh-info">
          <div className="dh-back"><BackLink to="/instances" onScene>{t("ui.nav.library")}</BackLink></div>
          <HeroTitle className="truncate" title={instance.name}>{instance.name}</HeroTitle>
          {/* Infos als ruhiger Text, Updates als Knopf: was klickbar ist, sieht so aus. Einen Absturz melden Spielen-Knopf, Protokoll und Hinweis. */}
          <HeroMeta>
            <Chip className="self-center">{minecraft}</Chip>
            <Meta
              size="l"
              onScene
              items={[
                !narrow && loaderName && (
                  <>{loaderName} {instance.loaderVersion && <Count value={instance.loaderVersion} size={20} />}</>
                ),
                !narrow && playtimeLine(instance),
              ]}
            />
            {updateCount > 0 && (
              <ChipButton icon="update" tone="warn" onClick={onShowUpdates} tabIndex={compact ? -1 : undefined}>
                {updatesLabel(updateCount)}
                <Count value={updateCount} />
              </ChipButton>
            )}
            {pack?.latest && (
              <Tip label={t("detail.pack.headUpdateTip", { name: pack.name ?? instance.name, version: pack.latest.version_number })}>
                <ChipButton icon="modpack" tone="acc" onClick={onShowPack} tabIndex={compact ? -1 : undefined}>
                  {t("detail.pack.headUpdate")}
                </ChipButton>
              </Tip>
            )}
          </HeroMeta>
        </div>
        <div className="dh-act">
          <Actions gap={12}>
            <PlayButton instance={instance} onLaunched={onLaunched} tabIndex={compact ? -1 : undefined} main />
            <InstanceMenuButton instance={instance} showOpen={false} />
          </Actions>
          <PlayStatus instance={instance} className="max-w-[360px] justify-end le-720:w-auto le-720:justify-start" />
        </div>
      </div>
      <div className="dh-compact" aria-hidden={!compact}>
        <IconButton
          size="s"
          icon="arrow-left"
          label={t("pages.detail.toLibraryLabel")}
          onScene
          tabIndex={compact ? 0 : -1}
          onClick={() => navigate("/instances")}
        />
        <Heading level="section" as="h2" size="bar" plain className="flex-1 truncate" title={instance.name}>{instance.name}</Heading>
        {!narrow && <Meta onScene className="flex-none" items={[loaderName, minecraft]} />}
        <PlayButton instance={instance} size="m" onLaunched={onLaunched} tabIndex={compact ? 0 : -1} main />
      </div>
    </header>
  );
}
