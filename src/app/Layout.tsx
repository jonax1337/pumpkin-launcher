import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as RPointerEvent, type RefObject } from "react";
import { Link, useLocation, useNavigate, useOutlet } from "react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AccountMenu } from "@/components/PlayerNames";
import { InstanceDialogs } from "@/components/instance";
import { useCancelInstall, useGameEvents, useInstances } from "@/hooks/useInstances";
import { useContentState } from "@/hooks/useContent";
import { api } from "@/lib/api";
import { progressLabel } from "@/lib/modrinth";
import { installStepLabel } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Mark } from "@/pixel/icons";
import { setSceneGate } from "@/pixel/scene";
import { usePixelUnit } from "@/pixel/unit";
import { useGame } from "@/store/game";
import { useSettings } from "@/store/settings";
import { useTasks } from "@/store/tasks";
import { BarButton, Button, Cell, Chip, Empty, Icon, JobProgress, List, ListRow, NavTabs, Popover, RowTitle, SectionHeader, Tip } from "@/ui";

/** Die scrollende Ansicht unter der Fensterleiste (für den Instanzkopf, der beim Scrollen schrumpft). */
const ViewContext = createContext<RefObject<HTMLElement | null>>({ current: null });
export const useView = () => useContext(ViewContext);

const TABS = [
  { to: "/", label: "Start", match: (p: string) => p === "/", shortcut: "Control+1" },
  { to: "/instances", label: "Bibliothek", match: (p: string) => p.startsWith("/instances"), shortcut: "Control+2" },
  { to: "/discover", label: "Entdecken", match: (p: string) => p.startsWith("/discover"), shortcut: "Control+3" },
];

/** Offener Dialog (auch Rückfrage); Popover und Menüs zählen nicht. */
const dialogOpen = () => !!document.querySelector("[role=alertdialog][data-state=open], [role=dialog][aria-modal=true]");

/** Fokus in einem Feld, in das getippt wird (dort gehört Strg+N/Strg+, nicht uns). */
function typing(el: Element | null) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "reset", "range", "file", "color"].includes(el.type);
}

/**
 * Strg+1…3 wechselt den Bereich, Strg+, öffnet die Einstellungen, Strg+N „Neue Instanz“.
 * Bei offenem Dialog nichts (sonst gingen Eingaben verloren); in Textfeldern nur Strg+Zahl.
 */
function useShortcuts() {
  const navigate = useNavigate();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
      if (dialogOpen()) return;
      const tab = TABS[Number(e.key) - 1];
      if (tab) {
        e.preventDefault();
        navigate(tab.to);
        return;
      }
      if (typing(document.activeElement)) return;
      if (e.key === ",") {
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

const APP = "Voxlet";

/** Fenstertitel je Bereich; bei einer Instanz ihr Name. */
function usePageTitle(pathname: string) {
  const { data: instances } = useInstances();
  const id = pathname.match(/^\/instances\/([^/]+)/)?.[1];
  const name = id ? instances?.find((i) => i.id === decodeURIComponent(id))?.name : undefined;
  const page =
    pathname === "/" ? "Start"
    : id ? (name ?? "Bibliothek")
    : pathname.startsWith("/instances") ? "Bibliothek"
    : pathname.startsWith("/discover") ? "Entdecken"
    : pathname.startsWith("/settings") ? "Einstellungen"
    : "Seite nicht gefunden";
  useEffect(() => {
    document.title = `${page} · ${APP}`;
  }, [page]);
}

/**
 * Nach einem Seitenwechsel (nicht beim ersten Laden) Fokus auf die Seitenüberschrift, damit Tastatur und
 * Screenreader auf der neuen Seite beginnen. Die Seite kann später rendern (Laden), deshalb kurz auf das h1 warten.
 * Hat die Seite selbst schon fokussiert (Suchfeld, Dialog), bleibt es dabei.
 */
function usePageFocus(pathname: string, view: RefObject<HTMLElement | null>) {
  // Vorige Adresse statt „erster Lauf“: StrictMode führt Effekte beim Laden doppelt aus.
  const prev = useRef(pathname);
  useEffect(() => {
    if (prev.current === pathname) return;
    prev.current = pathname;
    const main = view.current;
    if (!main) return;
    const tryFocus = () => {
      const h1 = main.querySelector<HTMLElement>("h1");
      if (!h1) return false;
      const a = document.activeElement;
      const pageOwns = a instanceof HTMLElement && a !== main && main.contains(a);
      if (!pageOwns && !dialogOpen()) {
        if (!h1.hasAttribute("tabindex")) h1.tabIndex = -1;
        h1.focus({ preventScroll: true });
      }
      return true;
    };
    if (tryFocus()) return;
    const mo = new MutationObserver(() => tryFocus() && stop());
    const t = setTimeout(() => stop(), 3000);
    const stop = () => {
      mo.disconnect();
      clearTimeout(t);
    };
    mo.observe(main, { childList: true, subtree: true });
    return stop;
  }, [pathname, view]);
}

/**
 * Start scrollt nicht, solange die Seite in die Ansicht passt (Szene bis an den Rand). Passt sie nicht
 * (Zoom, kleines Fenster), wird sie normal scrollbar statt abgeschnitten. Beobachtet Ansicht und Inhalt.
 */
function useFits(view: RefObject<HTMLElement | null>, active: boolean) {
  const [fits, setFits] = useState(true);
  useEffect(() => {
    const el = view.current;
    if (!active || !el) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      setFits(el.scrollHeight <= el.clientHeight + 1);
    };
    const schedule = () => void (frame ||= requestAnimationFrame(check));
    const ro = new ResizeObserver(schedule);
    const watch = () => {
      ro.disconnect();
      ro.observe(el);
      for (const c of el.children) ro.observe(c);
      schedule();
    };
    const mo = new MutationObserver(watch);
    mo.observe(el, { childList: true });
    watch();
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
    };
  }, [view, active]);
  return active && fits;
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
    label: `${name(p.instanceId)} wird installiert`,
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
    <Popover
      open={open}
      onOpenChange={setOpen}
      label="Aufgaben"
      tip="Aufgaben"
      width={400}
      trigger={
        // Feste Glyphe; Zähler und Mini-Balken liegen daneben bzw. darunter, nie darauf
        <BarButton activity={{ count: live.length, p: avg }} aria-label={busy ? `Aufgaben, ${live.length} ${live.length === 1 ? "läuft" : "laufen"}` : "Aufgaben"}>
          <Icon name="tasks" />
        </BarButton>
      }
    >
      {/* Ohne Fertige kein Knopf; der Kopf bleibt 32 px hoch */}
      <SectionHeader title="Aufgaben" as="h2" size="card" actions={history.length > 0 && <Button variant="ghost" size="s" bleed="end" onClick={clear}>Fertige entfernen</Button>} />
      {live.length || history.length ? (
        <List variant="tasks" divided aria-label="Aufgaben">
          {live.map((t) => (
            <ListRow key={t.id}>
              <Icon name="dl" tone="acc" />
              <JobProgress label={t.label} sub={t.sub} p={t.p} onCancel={t.instanceId ? () => cancel.mutate(t.instanceId) : undefined} cancelLabel={`${t.label} abbrechen`} />
            </ListRow>
          ))}
          {history.map((t) => (
            <ListRow key={t.id}>
              <Icon name={t.state === "done" ? "check" : "warn"} tone={t.state === "done" ? "run" : "bad"} />
              <RowTitle title={t.label} sub={t.sub} />
              <Cell align="end" flex>
                {t.to && <Button size="s" onClick={() => { setOpen(false); navigate(t.to!); }}>Öffnen</Button>}
              </Cell>
            </ListRow>
          ))}
        </List>
      ) : (
        <Empty size="pane" ill="tasks" title="Keine Aufgaben">Downloads und Installationen erscheinen hier.</Empty>
      )}
    </Popover>
  );
}

/** Fensterknöpfe des rahmenlosen Fensters (nur in der App, im Browser nicht nötig). Sonderform: volle Leistenhöhe, bündig am Rand. */
function WindowButtons() {
  if (api.isMock) return null;
  const win = getCurrentWindow();
  return (
    <div className="win">
      <button type="button" className="winbtn" aria-label="Minimieren" onClick={() => void win.minimize()}><Icon name="wmin" size="s" /></button>
      <button type="button" className="winbtn" aria-label="Maximieren" onClick={() => void win.toggleMaximize()}><Icon name="wmax" size="s" /></button>
      <button type="button" className="winbtn close" aria-label="Schließen" onClick={() => void win.close()}><Icon name="x" size="s" /></button>
    </div>
  );
}

function TitleBar({ online }: { online: boolean }) {
  const { pathname } = useLocation();
  return (
    <header className="bar" data-tauri-drag-region>
      <Link to="/" className="wm fx" aria-label="Voxlet, zum Start">
        <span className="mark"><Mark /></span>
        <span className="word">VOXLET</span>
      </Link>
      {/* Normale Links: Bereiche sind Seiten, keine Tabs. `navtabs` nur für den Abstand zur Marke (Leistengerüst) */}
      <NavTabs items={TABS} className="navtabs" />
      <div className="bar-mid" data-tauri-drag-region />
      <div className="bar-right">
        {/* Live-Region bleibt stehen (links neben der Gruppe, schiebt nichts); online leer, damit nichts vorgelesen wird */}
        <span className="pointer-events-none absolute top-1/2 right-[calc(100%+8px)] flex -translate-y-1/2" role="status">
          {!online && (
            <Chip tone="warn" icon="plug">
              Offline<span className="sr">: keine Internetverbindung, Katalog und Downloads sind nicht verfügbar</span>
            </Chip>
          )}
        </span>
        <TasksButton />
        <AccountMenu />
        <Tip label="Einstellungen">
          <BarButton to="/settings" aria-label="Einstellungen" current={pathname.startsWith("/settings")}>
            <Icon name="gear" />
          </BarButton>
        </Tip>
        <WindowButtons />
      </div>
    </header>
  );
}

/**
 * Schmale Pixel-Scrollbar über der Ansicht statt der nativen Spur: nichts wird reserviert,
 * Szenen (Start, Instanzkopf) reichen bis an den Fensterrand. Ziehen und Klick in die Bahn wie gewohnt.
 */
function ViewScrollbar({ view }: { view: RefObject<HTMLElement | null> }) {
  const track = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; top: number; k: number } | null>(null);

  useEffect(() => {
    const el = view.current;
    const tr = track.current;
    const th = thumb.current;
    if (!el || !tr || !th) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const { scrollHeight: sh, clientHeight: ch, scrollTop: st } = el;
      const on = sh > ch + 1 && getComputedStyle(el).overflowY !== "hidden";
      tr.toggleAttribute("data-on", on);
      if (!on) return;
      const h = Math.max(40, Math.round((ch * ch) / sh));
      th.style.height = `${h}px`;
      th.style.transform = `translateY(${Math.round((st / (sh - ch)) * (ch - h))}px)`;
    };
    const schedule = () => void (frame ||= requestAnimationFrame(update));
    // Inhaltshöhe: Größe der Seite beobachten; wechselt die Seite, das neue Kind anmelden.
    const ro = new ResizeObserver(schedule);
    const watch = () => {
      ro.disconnect();
      ro.observe(el);
      for (const c of el.children) ro.observe(c);
      schedule();
    };
    const mo = new MutationObserver(watch);
    mo.observe(el, { childList: true, attributes: true, attributeFilter: ["class"] });
    el.addEventListener("scroll", schedule, { passive: true });
    watch();
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener("scroll", schedule);
    };
  }, [view]);

  function onThumbDown(e: RPointerEvent<HTMLDivElement>) {
    const el = view.current;
    if (!el || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const h = e.currentTarget.offsetHeight;
    drag.current = { y: e.clientY, top: el.scrollTop, k: (el.scrollHeight - el.clientHeight) / Math.max(1, el.clientHeight - h) };
    track.current?.setAttribute("data-drag", "");
  }
  function onThumbMove(e: RPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (d && view.current) view.current.scrollTop = d.top + (e.clientY - d.y) * d.k;
  }
  function onThumbUp() {
    drag.current = null;
    track.current?.removeAttribute("data-drag");
  }
  // Klick in die Bahn blättert eine Seite in Richtung des Klicks.
  function onTrackDown(e: RPointerEvent<HTMLDivElement>) {
    const el = view.current;
    const th = thumb.current;
    if (!el || !th || e.button !== 0) return;
    const above = e.clientY < th.getBoundingClientRect().top;
    el.scrollBy({ top: (above ? -1 : 1) * el.clientHeight * 0.9 });
  }

  return (
    <div ref={track} className="vbar" aria-hidden onPointerDown={onTrackDown}>
      <div ref={thumb} className="vthumb" onPointerDown={onThumbDown} onPointerMove={onThumbMove} onPointerUp={onThumbUp} onPointerCancel={onThumbUp} />
    </div>
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
  usePageTitle(pathname);
  usePageFocus(pathname, view);
  const noscroll = useFits(view, pathname === "/");

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
        <TitleBar online={online} />
        <main ref={view} className={cn("view", noscroll && "noscroll")} tabIndex={-1}>
          {outlet}
        </main>
        <ViewScrollbar view={view} />
      </div>
      <InstanceDialogs />
    </ViewContext.Provider>
  );
}
