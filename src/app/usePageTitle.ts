import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useI18n } from "@/i18n";
import { useInstances } from "@/hooks/useInstances";
import { api } from "@/lib/api";

const APP = "Pumpkin Launcher";

/** Fenstertitel je Bereich; bei einer Instanz ihr Name. */
export function usePageTitle(pathname: string) {
  const { t } = useI18n();
  const { data: instances } = useInstances();
  const id = pathname.match(/^\/instances\/([^/]+)/)?.[1];
  const name = id ? instances?.find((i) => i.id === decodeURIComponent(id))?.name : undefined;
  const page =
    pathname === "/" ? t("ui.nav.home")
    : id ? (name ?? t("ui.nav.library"))
    : pathname.startsWith("/instances") ? t("ui.nav.library")
    : pathname.startsWith("/discover") ? t("ui.nav.discover")
    : pathname.startsWith("/settings") ? t("common.settings")
    : pathname.startsWith("/skins") ? t("ui.nav.skins")
    : t("ui.pageTitle.notFound");
  useEffect(() => {
    document.title = `${page} · ${APP}`;
    if (api.capabilities.nativeWindow) void getCurrentWindow().setTitle(document.title).catch(console.error);
  }, [page]);
}
