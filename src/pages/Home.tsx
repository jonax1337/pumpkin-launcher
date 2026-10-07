import { useState } from "react";
import { useNavigate } from "react-router";
import { useI18n } from "@/i18n";
import { PlayStatus } from "@/components/play/PlayStatus";
import { NewInstanceDialog } from "@/components/NewInstanceDialog";
import { SkelList } from "@/components/SkelList";
import { Onboarding } from "@/components/Onboarding";
import { useInstanceMenu } from "@/components/instance";
import { byRecent, pickRecentInstance, useInstances } from "@/hooks/useInstances";
import { useDropPackToImport } from "@/hooks/usePackFiles";
import { PixelScene } from "@/pixel/PixelScene";
import { newInstanceUrl } from "@/lib/routes";
import type { Instance } from "@/lib/types";
import { useLook } from "@/store/look";
import { Actions, Button, ButtonLink, ContextMenu, ErrorBox, PageHeader, SectionHeader, Skel, type MenuEntry } from "@/ui";
import { HeroActions } from "./home/HeroActions";
import { HeroInfo } from "./home/HeroInfo";
import { Rail, TILE_H, TILE_W } from "./home/Rail";

function HomeHeader() {
  const { t } = useI18n();
  return (
    <PageHeader title={t("ui.nav.home")} className="home-header">
      <Actions wrap>
        <NewInstanceDialog>
          <Button icon="plus">{t("components.newInstance.title")}</Button>
        </NewInstanceDialog>
        <ButtonLink to="/instances" variant="ghost" iconEnd="chev">{t("ui.nav.library")}</ButtonLink>
      </Actions>
    </PageHeader>
  );
}

function HomeSkeleton() {
  const { t } = useI18n();
  return (
    <section className="home" aria-busy aria-label={t("components.common.loadingAria")}>
      <HomeHeader />
      <div className="hero">
        <div className="hero-k">
          <div className="titlebox"><Skel h={72} w="min(520px, 80%)" /></div>
          <div className="hmeta"><Skel h={16} w={320} /></div>
        </div>
        <div className="acts"><Skel h={56} w={272} /><Skel h={56} w={56} /></div>
        <div className="pstat" />
      </div>
      <div className="cont">
        <div className="library-heading"><Skel h={22} w={150} /></div>
        <div className="railwrap"><div className="rail"><SkelList n={4} w={TILE_W} h={TILE_H} className="flex-none" /></div></div>
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
      <section className="page">
        <PageHeader title={t("ui.nav.home")} />
        <ErrorBox title={t("pages.home.loadErrorTitle")} error={error} onRetry={() => void refetch()} />
      </section>
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
      <div className="shade-home" />
      <HomeHeader />
      <div className="hero">
        <HeroInfo key={`info-${current.id}`} instance={current} />
        <HeroActions instance={current} />
        <PlayStatus key={`stat-${current.id}`} instance={current} showLast={false} onScene />
      </div>
      <div className="cont">
        <div className="library-heading">
          <SectionHeader
            title={t("components.detail.yourInstances")}
            id="cont-h"
          />
        </div>
        <Rail instances={[...instances].sort(byRecent)} current={current.id} onPick={onPick} />
      </div>
    </section>
    </ContextMenu>
  );
}
