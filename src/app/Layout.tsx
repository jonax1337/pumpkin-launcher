import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { Link, useLocation, useNavigate, useOutlet } from "react-router";
import { Popover } from "radix-ui";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Btn, Progress, Tip } from "@/components/px";
import { AccountMenu } from "@/components/PlayerNames";
import { InstanceDialogs } from "@/components/instance";
import { useCancelInstall, useGameEvents, useInstances } from "@/hooks/useInstances";
import { useContentState } from "@/hooks/useContent";
import { api } from "@/lib/api";
import { progressLabel } from "@/lib/modrinth";
import { installStepLabel } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Icon, Mark } from "@/pixel/icons";
import { setSceneGate } from "@/pixel/scene";
import { usePixelUnit } from "@/pixel/unit";
import { useGame } from "@/store/game";
import { useSettings } from "@/store/settings";
import { useTasks } from "@/store/tasks";

/** Die scrollende Ansicht unter der Fensterleiste (für den Instanzkopf, der beim Scrollen schrumpft). */
const ViewContext = createContext<RefObject<HTMLElement | null>>({ current: null });
export const useView = () => useContext(ViewContext);

const TABS = [
  { to: "/", label: "Spielen", match: (p: string) => p === "/" },
  { to: "/instances", label: "Bibliothek", match: (p: string) => p.startsWith("/instances") },
  { to: "/discover", label: "Entdecken", match: (p: string) => p.startsWith("/discover") },
];

/** Strg+1…3 wechselt den Bereich, Strg+, öffnet die Einstellungen, Strg+N „Neue Instanz“. */
function useShortcuts() {
  const navigate = useNavigate();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      const tab = TABS[Number(e.key) - 1];
      if (tab) {
        e.preventDefault();
        navigate(tab.to);
      } else if (e.key === ",") {
        e.preventDefault();
        navigate("/settings");
      } else if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        navigate("/instances?neu=1");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
}

const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};
const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine);

/** Laufende Aufgaben: Vorbereitungen der Instanzen und Katalog-Vorgänge. */
function useLiveTasks() {
  const installs = useGame((s) => s.installs);
  const content = useContentState();
  const { data: instances } = useInstances();
  const name = (id: string) => instances?.find((i) => i.id === id)?.name ?? "Instanz";
  const loader = (id: string) => instances?.find((i) => i.id === id)?.loader ?? "vanilla";
  const live = Object.values(installs).map((p) => ({
    id: `i-${p.instanceId}`,
    instanceId: p.instanceId,
    label: `${name(p.instanceId)} vorbereiten`,
    sub: installStepLabel(p.step, loader(p.instanceId)),
    p: p.total > 0 ? p.done / p.total : null,
  }));
  if (content.active)
    live.push({
      id: `c-${content.active}`,
      instanceId: "",
      label: content.label ?? "Inhalte laden",
      sub: progressLabel(content.progress),
      p: content.progress?.phase === "download" && content.progress.total ? content.progress.done / content.progress.total : null,
    });
  return live;
}

function TasksButton() {
  const live = useLiveTasks();
  const history = useTasks((s) => s.history);
  const clear = useTasks((s) => s.clear);
  const cancel = useCancelInstall();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const known = live.filter((t) => t.p != null);
  const avg = known.length ? known.reduce((s, t) => s + (t.p ?? 0), 0) / known.length : null;
  const busy = live.length > 0;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tip label="Aufgaben">
        <Popover.Trigger asChild>
          <button type="button" className={cn("barbtn tasksbtn fx", busy && "busy")} aria-label={busy ? `Aufgaben, ${live.length} laufen` : "Aufgaben"}>
            <Icon name="dl" />
            <span className="badge">{live.length}</span>
            <Progress thin p={avg} className="tmini" />
          </button>
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Content className="rpop tasks" align="end" sideOffset={6} collisionPadding={8} aria-label="Aufgaben">
          <div className="tasks-h">
            <b>Aufgaben</b>
            <Btn variant="g" size="s" disabled={!history.length} onClick={clear}>Fertige entfernen</Btn>
          </div>
          {live.map((t) => (
            <div key={t.id} className="task">
              <span className="ti"><Icon name="dl" /></span>
              <div className="tt">
                <b>{t.label}</b>
                <Progress thin p={t.p} />
                <span>{t.sub}</span>
              </div>
              <span className="tp num">{t.p != null ? `${Math.floor(t.p * 100)} %` : ""}</span>
              {t.instanceId ? (
                <Tip label="Abbrechen">
                  <Btn variant="g" size="s" iconOnly className="tx" aria-label={`${t.label} abbrechen`} onClick={() => cancel.mutate(t.instanceId)}>
                    <Icon name="x5" small />
                  </Btn>
                </Tip>
              ) : <span />}
            </div>
          ))}
          {history.map((t) => (
            <div key={t.id} className={cn("task", t.state)}>
              <span className="ti"><Icon name={t.state === "done" ? "check" : "warn"} /></span>
              <div className="tt">
                <b>{t.label}</b>
                <span>{t.sub}</span>
              </div>
              <div className="tact">
                {t.to && (
                  <Btn size="s" onClick={() => { setOpen(false); navigate(t.to!); }}>Öffnen</Btn>
                )}
              </div>
            </div>
          ))}
          {!live.length && !history.length && <div className="none">Keine Aufgaben. Downloads und Installationen erscheinen hier.</div>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Fensterknöpfe des rahmenlosen Fensters (nur in der App, im Browser nicht nötig). */
function WindowButtons() {
  if (api.isMock) return null;
  const win = getCurrentWindow();
  return (
    <div className="win">
      <button type="button" className="winbtn" aria-label="Minimieren" onClick={() => void win.minimize()}><Icon name="wmin" small /></button>
      <button type="button" className="winbtn" aria-label="Maximieren" onClick={() => void win.toggleMaximize()}><Icon name="wmax" small /></button>
      <button type="button" className="winbtn close" aria-label="Schließen" onClick={() => void win.close()}><Icon name="x5" small /></button>
    </div>
  );
}

function TitleBar() {
  const { pathname } = useLocation();
  return (
    <header className="bar" data-tauri-drag-region>
      <Link to="/" className="wm fx" aria-label="Voxlet, zum Start">
        <span className="mark"><Mark /></span>
        <span className="word">VOXLET</span>
      </Link>
      <nav className="navtabs" role="tablist" aria-label="Hauptbereiche">
        {TABS.map((t, i) => (
          <Link key={t.to} to={t.to} role="tab" className="ptab fx" aria-selected={t.match(pathname)} aria-keyshortcuts={`Control+${i + 1}`}>
            {t.label}
            <i className="tick" />
          </Link>
        ))}
      </nav>
      <div className="bar-mid" data-tauri-drag-region />
      <div className="bar-right">
        <span className="netchip" role="status"><Icon name="plug" small />Offline</span>
        <TasksButton />
        <AccountMenu />
        <Tip label="Einstellungen">
          <Link to="/settings" className="barbtn fx" aria-label="Einstellungen" aria-current={pathname === "/settings" ? "page" : undefined}>
            <Icon name="gear" />
          </Link>
        </Tip>
        <WindowButtons />
      </div>
    </header>
  );
}

export function Layout() {
  const outlet = useOutlet();
  const { pathname } = useLocation();
  const view = useRef<HTMLElement>(null);
  const online = useOnline();
  const motion = useSettings((s) => s.motion);
  const gameActive = useGame((s) => Object.keys(s.launching).length > 0 || Object.keys(s.started).length > 0);
  const [ready, setReady] = useState(false);
  usePixelUnit();
  useGameEvents();
  useShortcuts();

  // Szenen stehen still, solange Minecraft startet oder läuft, oder wenn Bewegung aus ist.
  useEffect(() => setSceneGate({ motion, game: gameActive }), [motion, gameActive]);

  // Erst sichtbar, wenn die Schriften da sind: kein Nachrutschen beim Start.
  useEffect(() => {
    let done = false;
    const show = () => !done && ((done = true), setReady(true));
    void document.fonts.ready.then(show);
    const t = setTimeout(show, 2500);
    return () => clearTimeout(t);
  }, []);

  // Neue Seite beginnt oben.
  useEffect(() => {
    if (view.current) view.current.scrollTop = 0;
  }, [pathname]);

  return (
    <ViewContext.Provider value={view}>
      <div className={cn("app", ready && "ready")} data-offline={online ? undefined : ""}>
        <TitleBar />
        <main ref={view} className={cn("view", pathname === "/" && "noscroll")} tabIndex={-1}>
          {outlet}
        </main>
      </div>
      <InstanceDialogs />
    </ViewContext.Provider>
  );
}
