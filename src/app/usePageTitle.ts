import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useI18n, type TKey } from "@/i18n";
import { useInstances } from "@/hooks/useInstances";
import { api } from "@/lib/api";

const APP = "Pumpkin Launcher";

/** Bereiche nach Adressanfang; die Startseite ist nur `/` selbst, alles Unbekannte ist „nicht gefunden“. */
const AREA_TITLES: [prefix: string, key: TKey][] = [
  ["/instances", "ui.nav.library"],
  ["/discover", "ui.nav.discover"],
  ["/settings", "common.settings"],
  ["/skins", "ui.nav.skins"],
  ["/friends", "ui.nav.friends"],
];

const areaTitleKey = (pathname: string): TKey =>
  pathname === "/" ? "ui.nav.home" : AREA_TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? "ui.pageTitle.notFound";

/** Fenstertitel je Bereich; bei einer Instanz ihr Name. */
export function usePageTitle(pathname: string) {
  const { t } = useI18n();
  const { data: instances } = useInstances();
  const id = pathname.match(/^\/instances\/([^/]+)/)?.[1];
  const name = id ? instances?.find((i) => i.id === decodeURIComponent(id))?.name : undefined;
  const page = name ?? t(areaTitleKey(pathname));
  useEffect(() => {
    document.title = `${page} · ${APP}`;
    if (api.capabilities.nativeWindow) void getCurrentWindow().setTitle(document.title).catch(console.error);
  }, [page]);
}
