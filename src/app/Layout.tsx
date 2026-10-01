import { createContext, useContext, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type RefObject } from "react";
import { Link, useLocation, useNavigate, useOutlet } from "react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AccountMenu } from "@/components/PlayerNames";
import { InstanceDialogs } from "@/components/instance";
import { ShareLogDialog } from "@/components/support";
import { ManualDownloads } from "@/components/ManualDownloads";
import { useUpdateCheckOnStart } from "@/hooks/useAppUpdate";
import { useCancelInstall, useGameEvents, useInstances } from "@/hooks/useInstances";
import { cancelContent } from "@/hooks/useContent";
import { useOnline } from "@/hooks/useOnline";
import { useI18n } from "@/i18n";
import { useRunningTasks } from "@/hooks/useRunningTasks";
import { api } from "@/lib/api";
import { progressLabel, progressShare } from "@/lib/modrinth";
import { platform } from "@/lib/platform";
import { newInstanceUrl } from "@/lib/routes";
import { installStepLabel } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BrandMark, BrandWordmark } from "@/branding/Brand";
import { setSceneGate } from "@/pixel/scene";
import { usePixelUnit } from "@/pixel/unit";
import { isGameActive, useGame } from "@/store/game";
import { useSettings } from "@/store/settings";
import { useTasks } from "@/store/tasks";
import { BarButton, Button, Cell, Chip, Empty, Icon, JobProgress, List, ListRow, Popover, RowTitle, SectionHeader, Tip } from "@/ui";
import type { IconName } from "@/ui/types";

/** Die scrollende Ansicht neben der Seitenleiste und unter der Fensterleiste (für den Instanzkopf, der beim Scrollen schrumpft). */
const ViewContext = createContext<RefObject<HTMLElement | null>>({ current: null });
export const useView = () => useContext(ViewContext);

type Section = { to: string; key: string; icon: IconName; match: (pathname: string) => boolean; shortcut: string };

// Hauptbereiche; `key` ist der Wörterbuchschlüssel, die Beschriftung entsteht erst beim Rendern.
const TABS: Section[] = [
  { to: "/", key: "ui.nav.home", icon: "home", match: (p) => p === "/", shortcut: "Control+1" },
  { to: "/instances", key: "ui.nav.library", icon: "box", match: (p) => p.startsWith("/instances"), shortcut: "Control+2" },
  { to: "/discover", key: "ui.nav.discover", icon: "search", match: (p) => p.startsWith("/discover"), shortcut: "Control+3" },
];

/** Offener Dialog (auch Rückfrage); Popover und Menüs zählen nicht. */
const dialogOpen = () => !!document.querySelector("[role=alertdialog][data-state=open], [role=dialog][aria-modal=true]");

/** Fokus in einem Feld, in das getippt wird (dort gehört Strg+N/Strg+, nicht uns). */
function typing(el: Element | null) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "reset", "range", "file", "color"].includes(el.type);
}

/** Befehlstaste allein (ohne Alt/Umschalt): unter macOS Cmd, sonst Strg; die jeweils andere stört. */
function commandOnly(e: KeyboardEvent) {
  const [command, other] = platform === "macos" ? [e.metaKey, e.ctrlKey] : [e.ctrlKey, e.metaKey];
  return command && !other && !e.altKey && !e.shiftKey;
}

/**
 * Strg+1…3 wechselt den Bereich, Strg+, öffnet die Einstellungen, Strg+N „Neue Instanz“ (macOS: Cmd statt Strg).
 * Bei offenem Dialog nichts (sonst gingen Eingaben verloren); in Textfeldern nur Strg+Zahl.
 */
function useShortcuts() {
  const navigate = useNavigate();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!commandOnly(e) || e.defaultPrevented) return;
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
        navigate(newInstanceUrl());
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
}

const APP = "Pumpkin Launcher";

/** Fenstertitel je Bereich; bei einer Instanz ihr Name. */
function usePageTitle(pathname: string) {
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
    if (!api.isMock) void getCurrentWindow().setTitle(document.title).catch(console.error);
  }, [page]);
}

/** So lange wartet der Fokus auf die Überschrift einer Seite, die noch lädt. */
const PAGE_FOCUS_WAIT_MS = 3000;

/** Spätestens dann wird die Oberfläche sichtbar, auch wenn die Schriften noch nicht da sind. */
const FONTS_WAIT_MS = 2500;

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
    const giveUp = setTimeout(() => stop(), PAGE_FOCUS_WAIT_MS);
    const stop = () => {
      mo.disconnect();
      clearTimeout(giveUp);
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

type LiveTask = { id: string; label: string; sub: string; p: number | null; cancel?: () => void };

/** Zeilen der laufenden Aufgaben, mit „Abbrechen“, wo das Backend es kann. */
function useLiveTasks(): LiveTask[] {
  const { t } = useI18n();
  const { installs, content } = useRunningTasks();
  const cancelInstall = useCancelInstall();
  const { data: instances } = useInstances();
  const name = (id: string) => instances?.find((i) => i.id === id)?.name ?? t("common.instance");
  const loader = (id: string) => instances?.find((i) => i.id === id)?.loader ?? "vanilla";
  const live = Object.values(installs ?? {}).map((p): LiveTask => ({
    id: `i-${p.instanceId}`,
    label: t("ui.tasks.installing", { name: name(p.instanceId) }),
    sub: installStepLabel(p.step, loader(p.instanceId)),
    p: p.total > 0 ? p.done / p.total : null,
    cancel: () => cancelInstall.mutate(p.instanceId),
  }));
  if (content)
    live.push({
      id: `c-${content.active}`,
      label: content.label ?? t("ui.tasks.loadingContents"),
      sub: progressLabel(content.progress),
      p: progressShare(content.progress),
      cancel: content.cancellable ? cancelContent : undefined,
    });
  return live;
}

function TasksButton() {
  const { t } = useI18n();
  const live = useLiveTasks();
  const history = useTasks((s) => s.history);
  const clear = useTasks((s) => s.clear);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const known = live.filter((task) => task.p != null);
  const avg = known.length ? known.reduce((sum, task) => sum + (task.p ?? 0), 0) / known.length : null;
  const busy = live.length > 0;
  const runningAria = t(live.length === 1 ? "ui.tasks.ariaRunning.one" : "ui.tasks.ariaRunning.other", { count: live.length });

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={t("ui.tasks.title")}
      tip={t("ui.tasks.title")}
      width={400}
      side="right"
      trigger={
        // Feste Glyphe; Zähler und Mini-Balken liegen daneben bzw. darunter, nie darauf
        <BarButton side activity={{ count: live.length, p: avg }} aria-label={busy ? runningAria : t("ui.tasks.title")}>
          <Icon name="tasks" />
        </BarButton>
      }
    >
      {/* Ohne Fertige kein Knopf; der Kopf bleibt 32 px hoch */}
      <SectionHeader title={t("ui.tasks.title")} as="h2" size="card" actions={history.length > 0 && <Button variant="ghost" size="s" bleed="end" onClick={clear}>{t("ui.tasks.clearDone")}</Button>} />
      {live.length || history.length ? (
        <List variant="tasks" divided aria-label={t("ui.tasks.title")}>
          {live.map((job) => (
            <ListRow key={job.id}>
              <Icon name="dl" tone="acc" />
              <JobProgress label={job.label} sub={job.sub} p={job.p} onCancel={job.cancel} cancelLabel={t("ui.job.cancelAria", { label: job.label })} />
            </ListRow>
          ))}
          {history.map((done) => (
            <ListRow key={done.id}>
              <Icon name={done.state === "done" ? "check" : "warn"} tone={done.state === "done" ? "run" : "bad"} />
              <RowTitle title={done.label} sub={done.sub} />
              <Cell align="end" flex>
                {done.to && <Button size="s" onClick={() => { setOpen(false); navigate(done.to!); }}>{t("common.open")}</Button>}
              </Cell>
            </ListRow>
          ))}
        </List>
      ) : (
        <Empty size="pane" mood="sleep" title={t("ui.tasks.emptyTitle")}>{t("ui.tasks.emptyBody")}</Empty>
      )}
    </Popover>
  );
}

/** Fensterknöpfe des rahmenlosen Fensters (nur in der App, im Browser nicht nötig). Sonderform: volle Leistenhöhe, bündig am Rand. */
function WindowButtons() {
  const { t } = useI18n();
  if (api.isMock) return null;
  const win = getCurrentWindow();
  return (
    <div className="win">
      <button type="button" className="winbtn" aria-label={t("ui.window.minimize")} onClick={() => void win.minimize()}><Icon name="wmin" size="s" /></button>
      <button type="button" className="winbtn" aria-label={t("ui.window.maximize")} onClick={() => void win.toggleMaximize()}><Icon name="wmax" size="s" /></button>
      <button type="button" className="winbtn close" aria-label={t("common.close")} onClick={() => void win.close()}><Icon name="x" size="s" /></button>
    </div>
  );
}

/** Fensterleiste: Marke links, Konto und Fensterknöpfe rechts; die Bereiche liegen in der Seitenleiste. */
function TitleBar({ online }: { online: boolean }) {
  const { t } = useI18n();
  return (
    <header className="bar" data-tauri-drag-region>
      <Link to="/" className="wm fx" aria-label={t("ui.titlebar.homeAria")}>
        <BrandMark />
        <BrandWordmark />
      </Link>
      <div className="bar-mid" data-tauri-drag-region />
      <div className="bar-right">
        {/* Live-Region bleibt stehen (links neben der Gruppe, schiebt nichts); online leer, damit nichts vorgelesen wird */}
        <span className="pointer-events-none absolute top-1/2 right-[calc(100%+8px)] flex -translate-y-1/2" role="status">
          {!online && (
            <Chip tone="warn" icon="plug">
              {t("ui.offline.label")}<span className="sr">{t("ui.offline.detail")}</span>
            </Chip>
          )}
        </span>
        <AccountMenu />
        <WindowButtons />
      </div>
    </header>
  );
}

/**
 * Seitenleiste mit nur Symbolen: oben die Hauptbereiche (normale Links: Bereiche sind Seiten, keine Tabs),
 * unten Aufgaben und Einstellungen. Der Name steht im Tooltip und als aria-label.
 */
function Sidebar() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  return (
    <nav className="side" aria-label={t("ui.nav.mainAreas")}>
      <div className="side-grp">
        {TABS.map((tab) => (
          <Tip key={tab.to} label={t(tab.key)} side="right">
            <BarButton side to={tab.to} aria-label={t(tab.key)} aria-keyshortcuts={tab.shortcut} current={tab.match(pathname)}>
              <Icon name={tab.icon} />
            </BarButton>
          </Tip>
        ))}
      </div>
      <div className="side-grp">
        <TasksButton />
        <Tip label={t("common.settings")} side="right">
          <BarButton side to="/settings" aria-label={t("common.settings")} aria-keyshortcuts="Control+," current={pathname.startsWith("/settings")}>
            <Icon name="gear" />
          </BarButton>
        </Tip>
      </div>
    </nav>
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
  const gameActive = useGame(isGameActive);
  const [ready, setReady] = useState(false);
  usePixelUnit();
  useGameEvents();
  useUpdateCheckOnStart();
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
    const fallback = setTimeout(show, FONTS_WAIT_MS);
    return () => clearTimeout(fallback);
  }, []);

  // Neue Seite beginnt oben.
  useEffect(() => {
    if (view.current) view.current.scrollTop = 0;
  }, [pathname]);

  return (
    <ViewContext.Provider value={view}>
        <div className={cn("app", ready && "ready")} data-offline={online ? undefined : ""}>
          <TitleBar online={online} />
          <Sidebar />
          <main ref={view} className={cn("view", noscroll && "noscroll")} tabIndex={-1}>
            {outlet}
          </main>
          <ViewScrollbar view={view} />
        </div>
        <InstanceDialogs />
        <ShareLogDialog />
        <ManualDownloads />
    </ViewContext.Provider>
  );
}
