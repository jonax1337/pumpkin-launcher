import { createContext, useContext, useEffect, useRef, useState, type RefObject } from "react";
import { useLocation, useOutlet } from "react-router";
import { ShareLogDialog } from "@/components/support";
import { InstanceDialogs } from "@/components/instance";
import { ManualDownloads } from "@/components/ManualDownloads";
import { ShortcutsDialog } from "@/components/ShortcutsDialog";
import { useUpdateCheckOnStart } from "@/hooks/useAppUpdate";
import { useGameEvents } from "@/hooks/useGameEvents";
import { useMigrateLooks } from "@/hooks/useMigrateLooks";
import { useOnline } from "@/hooks/useOnline";
import { useOpenedPack } from "@/hooks/usePackFiles";
import { cn } from "@/lib/utils";
import { setSceneGate } from "@/pixel/scene";
import { usePixelUnit } from "@/pixel/unit";
import { isGameActive, useGame } from "@/store/game";
import { useSettings } from "@/store/settings";
import { useI18n } from "@/i18n";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";
import { useAppearance } from "./useAppearance";
import { useFits } from "./useFits";
import { usePageFocus } from "./usePageFocus";
import { usePageTitle } from "./usePageTitle";
import { useShortcuts } from "./useShortcuts";
import { ViewScrollbar } from "./ViewScrollbar";

/** Die scrollende Ansicht neben der Seitenleiste und unter der Fensterleiste (für den Instanzkopf, der beim Scrollen schrumpft). */
const ViewContext = createContext<RefObject<HTMLElement | null>>({ current: null });
export const useView = () => useContext(ViewContext);

/** Spätestens dann wird die Oberfläche sichtbar, auch wenn die Schriften noch nicht da sind. */
const FONTS_WAIT_MS = 2500;

/** Erst sichtbar, wenn die Schriften da sind: kein Nachrutschen beim Start. */
function useFontsReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let done = false;
    const show = () => !done && ((done = true), setReady(true));
    void document.fonts.ready.then(show);
    const fallback = setTimeout(show, FONTS_WAIT_MS);
    return () => clearTimeout(fallback);
  }, []);
  return ready;
}

export function Layout() {
  const { t } = useI18n();
  const outlet = useOutlet();
  const { pathname } = useLocation();
  const view = useRef<HTMLElement>(null);
  const online = useOnline();
  const motion = useSettings((s) => s.motion);
  const gameActive = useGame(isGameActive);
  const ready = useFontsReady();
  usePixelUnit();
  useAppearance();
  useGameEvents();
  useOpenedPack();
  useMigrateLooks();
  useUpdateCheckOnStart();
  useShortcuts();
  usePageTitle(pathname);
  usePageFocus(pathname, view);
  const noscroll = useFits(view, pathname === "/");

  // Szenen stehen still, solange Minecraft startet oder läuft, oder wenn Bewegung aus ist.
  useEffect(() => setSceneGate({ motion, game: gameActive }), [motion, gameActive]);

  // Neue Seite beginnt oben.
  useEffect(() => {
    if (view.current) view.current.scrollTop = 0;
  }, [pathname]);

  return (
    <ViewContext.Provider value={view}>
      <div className={cn("app", ready && "ready")} data-offline={online ? undefined : ""}>
        <button type="button" className="skip" onClick={() => view.current?.focus()}>
          {t("ui.skipToContent")}
        </button>
        <TitleBar online={online} />
        <Sidebar />
        <main ref={view} className={cn("view", noscroll && "noscroll")} tabIndex={-1}>
          {outlet}
        </main>
        <ViewScrollbar view={view} />
      </div>
      <InstanceDialogs />
      <ShareLogDialog />
      <ShortcutsDialog />
      <ManualDownloads />
    </ViewContext.Provider>
  );
}
