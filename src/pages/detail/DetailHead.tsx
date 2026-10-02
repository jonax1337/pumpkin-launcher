import type { RefObject } from "react";
import { useNavigate } from "react-router";
import { useI18n } from "@/i18n";
import { Actions, BackLink, Button, Count, IconButton, Meta, Tip } from "@/ui";
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
  const version = <>{LOADER_LABELS[instance.loader]} <Count value={instance.minecraftVersion} size={20} /></>;

  return (
    <header ref={headRef} className={cn("dhead", compact && "compact")}>
      <PixelScene bio={look.bio} seed={look.seed} mode="live" className="scene" />
      <div className="shade-head" />
      <div className="dh-full" aria-hidden={compact || undefined}>
        <div className="dh-info">
          <div className="flex"><BackLink to="/instances" onScene>{t("ui.nav.library")}</BackLink></div>
          <h1 title={instance.name}>{instance.name}</h1>
          {/* Infos als ruhiger Text, Updates als Knopf: was klickbar ist, sieht so aus. Einen Absturz melden Spielen-Knopf, Protokoll und Hinweis. */}
          <div className="dh-meta">
            <Meta
              size="l"
              onScene
              items={[
                version,
                !narrow && instance.loaderVersion && (
                  <>{t("components.common.loader")} <Count value={instance.loaderVersion} size={20} /></>
                ),
                !narrow && playtimeLine(instance),
              ]}
            />
            {updateCount > 0 && (
              <Button size="s" icon="up" count={updateCount} onScene onClick={onShowUpdates} tabIndex={compact ? -1 : undefined}>
                {updatesLabel(updateCount)}
              </Button>
            )}
            {pack?.latest && (
              <Tip label={t("detail.pack.headUpdateTip", { name: pack.name ?? instance.name, version: pack.latest.version_number })}>
                <Button size="s" icon="box" compactBelow={WIDTH.sm} onScene onClick={onShowPack} tabIndex={compact ? -1 : undefined}>
                  {t("detail.pack.headUpdate")}
                </Button>
              </Tip>
            )}
          </div>
        </div>
        <div className="dh-act">
          <Actions>
            <PlayButton instance={instance} onLaunched={onLaunched} tabIndex={compact ? -1 : undefined} main />
            <InstanceMenuButton instance={instance} showOpen={false} />
          </Actions>
          <PlayStatus instance={instance} />
        </div>
      </div>
      <div className="dh-compact" aria-hidden={!compact}>
        <IconButton
          size="s"
          icon="back"
          label={t("pages.detail.toLibraryLabel")}
          onScene
          tabIndex={compact ? 0 : -1}
          onClick={() => navigate("/instances")}
        />
        <h2 title={instance.name}>{instance.name}</h2>
        {!narrow && <Meta onScene className="flex-none" items={[version]} />}
        <PlayButton instance={instance} size="m" onLaunched={onLaunched} tabIndex={compact ? 0 : -1} main />
      </div>
    </header>
  );
}
