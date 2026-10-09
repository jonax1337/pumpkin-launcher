import { useState } from "react";
import { useNavigate } from "react-router";
import { useI18n } from "@/i18n";
import { PlayStatus } from "@/components/play/PlayStatus";
import { NewInstanceDialog } from "@/components/NewInstanceDialog";
import { Onboarding } from "@/components/Onboarding";
import { useInstanceMenu } from "@/components/instance";
import { byRecent, pickRecentInstance, useInstances } from "@/hooks/useInstances";
import { useDropPackToImport } from "@/hooks/usePackFiles";
import { PixelScene } from "@/pixel/PixelScene";
import { newInstanceUrl } from "@/lib/routes";
import type { Instance } from "@/lib/types";
import { useLook } from "@/store/look";
import { Actions, Button, ButtonLink, ContextMenu, ErrorBox, HeroMeta, HeroShade, Page, SectionHeader, Skel, type MenuEntry } from "@/ui";
import { HeroActions } from "./home/HeroActions";
import { HeroInfo } from "./home/HeroInfo";
import { Rail, RailSkeleton } from "./home/Rail";

function HomeInstancesHeader() {
  const { t } = useI18n();
  return (
    <SectionHeader
      title={t("components.detail.yourInstances")}
      id="cont-h"
      className="library-heading"
      actions={
        <Actions wrap>
          <NewInstanceDialog>
            <Button size="s" icon="plus">{t("components.newInstance.title")}</Button>
          </NewInstanceDialog>
          <ButtonLink size="s" to="/instances" iconEnd="chev-right">{t("ui.nav.library")}</ButtonLink>
        </Actions>
      }
    />
  );
}

function HomeSkeleton() {
  const { t } = useI18n();
  return (
    <section className="home" aria-busy aria-label={t("components.common.loadingAria")}>
      <h1 className="sr">{t("ui.nav.home")}</h1>
      <div className="hero">
        <div className="hero-k">
          <div className="titlebox"><Skel h={72} w="min(520px, 80%)" /></div>
          <HeroMeta><Skel h={16} w={320} /></HeroMeta>
        </div>
        <Actions gap={12}><Skel h="var(--vx-h-l)" w={272} /><Skel h="var(--vx-h-l)" w="var(--vx-h-l)" /></Actions>
        {/* Statuszeile unter den Knöpfen: auch im echten Hero reserviert (PlayStatus), damit sich die Höhe nicht ändert */}
        <div className="pstat" />
      </div>
      <div className="cont">
        <HomeInstancesHeader />
        <div className="railwrap"><RailSkeleton n={4} /></div>
      </div>
    </section>
  );
}

export function HomePage() {
  const { t } = useI18n();
  const { data: instances, isLoading, error, refetch } = useInstances();
  useDropPackToImport();
  const [selected, setSelected] = useState<string | null>(null);
  const current = instances?.find((i) => i.id === selected) ?? pickRecentInstance(instances);

  if (isLoading) return <HomeSkeleton />;
  if (error)
    return (
      <Page>
        <h1 className="sr">{t("ui.nav.home")}</h1>
        <ErrorBox title={t("pages.home.loadErrorTitle")} error={error} onRetry={() => void refetch()} />
      </Page>
    );
  if (!instances?.length || !current) return <Onboarding />;

  return <HomeContent instances={instances} current={current} onPick={setSelected} />;
}

function HomeContent({ instances, current, onPick }: {
  instances: Instance[]; current: Instance; onPick: (id: string) => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const look = useLook(current.id);
  const instanceItems = useInstanceMenu(current);
  const items: MenuEntry[] = [
    { label: current.name },
    ...instanceItems,
    "-",
    { id: "new-instance", text: t("components.newInstance.title"), icon: "plus", onSelect: () => navigate(newInstanceUrl()) },
    { id: "library", text: t("pages.home.allInLibrary"), icon: "grid", onSelect: () => navigate("/instances") },
  ];

  return (
    <ContextMenu items={items}>
    <section className="home">
      <PixelScene bio={look.bio} seed={look.seed} mode="hero" className="scene" />
      <HeroShade />
      <h1 className="sr">{t("ui.nav.home")}</h1>
      <div className="hero">
        <HeroInfo key={`info-${current.id}`} instance={current} />
        <HeroActions instance={current} />
        <PlayStatus key={`stat-${current.id}`} instance={current} showLast={false} onScene />
      </div>
      <div className="cont">
        <HomeInstancesHeader />
        <Rail instances={[...instances].sort(byRecent)} current={current.id} onPick={onPick} />
      </div>
    </section>
    </ContextMenu>
  );
}
