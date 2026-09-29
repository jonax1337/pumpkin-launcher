import { useEffect, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Compass, LibraryBig, PanelLeftClose, PanelLeftOpen, Play, Settings, type LucideIcon } from "lucide-react";
import { NavLink, useLocation, useNavigate, useOutlet } from "react-router";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useSettings } from "@/store/settings";
import { useGameEvents } from "@/hooks/useInstances";

const NAV: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: "/", label: "Spielen", icon: Play, end: true },
  { to: "/instances", label: "Bibliothek", icon: LibraryBig },
  { to: "/discover", label: "Entdecken", icon: Compass },
  { to: "/settings", label: "Einstellungen", icon: Settings },
];

// Unter 1000 px Breite klappt die Seitenleiste automatisch ein, solange der Nutzer nichts anderes gewählt hat.
const narrowQuery = "(max-width: 999px)";
const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(narrowQuery);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const useNarrow = () => useSyncExternalStore(subscribe, () => window.matchMedia(narrowQuery).matches);

/** Tooltip nur im eingeklappten Zustand, dann ist das Label unsichtbar. */
function Tip({ show, label, children }: { show: boolean; label: string; children: React.ReactElement }) {
  if (!show) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function NavItem({ item, index, collapsed }: { item: (typeof NAV)[number]; index: number; collapsed: boolean }) {
  const Icon = item.icon;
  return (
    <Tip show={collapsed} label={`${item.label} (Strg+${index + 1})`}>
      <NavLink
        to={item.to}
        end={item.end}
        aria-keyshortcuts={`Control+${index + 1}`}
        className={({ isActive }) =>
          cn(
            "group relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium outline-none transition-colors",
            "focus-visible:ring-2 focus-visible:ring-ring",
            isActive ? "text-sidebar-accent-foreground" : "text-muted-foreground hover:text-foreground",
          )
        }
      >
        {({ isActive }) => (
          <>
            {isActive && (
              <motion.span
                layoutId="nav-active"
                className="absolute inset-0 rounded-lg bg-sidebar-accent"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            )}
            <Icon className={cn("relative size-4.5 shrink-0", isActive && "text-primary")} aria-hidden />
            <span className={cn("relative", collapsed && "sr-only")}>{item.label}</span>
          </>
        )}
      </NavLink>
    </Tip>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="flex items-center gap-3 px-3">
      <div className="grid size-9 shrink-0 grid-cols-2 gap-0.5 rounded-lg bg-primary/15 p-1.5 ring-1 ring-primary/30" aria-hidden>
        <span className="rounded-[2px] bg-primary" />
        <span className="rounded-[2px] bg-primary/50" />
        <span className="rounded-[2px] bg-primary/30" />
        <span className="rounded-[2px] bg-gold" />
      </div>
      <div className={cn("leading-tight", collapsed && "sr-only")}>
        <p className="font-heading text-[15px] font-semibold tracking-tight">Voxlet</p>
        <p className="text-xs text-muted-foreground">Jede Welt. Ein Klick.</p>
      </div>
    </div>
  );
}

/** Strg+1…4 wechselt den Bereich, Strg+N öffnet „Neu“ in der Bibliothek. */
function useShortcuts() {
  const navigate = useNavigate();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      const index = Number(e.key) - 1;
      if (NAV[index]) {
        e.preventDefault();
        navigate(NAV[index].to);
      } else if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        navigate("/instances?neu=1");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
}

export function Layout() {
  const location = useLocation();
  const outlet = useOutlet();
  const reduce = useReducedMotion();
  const offlineName = useSettings((s) => s.offlineName);
  const preference = useSettings((s) => s.sidebarCollapsed);
  const set = useSettings((s) => s.set);
  const narrow = useNarrow();
  const collapsed = preference ?? narrow;
  useGameEvents();
  useShortcuts();
  // Nur das erste Pfadsegment als Key, damit Tabs/Unterseiten nicht doppelt animieren
  const pageKey = "/" + (location.pathname.split("/")[1] ?? "");
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <div className="flex h-full">
      <aside
        className={cn(
          "flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar py-5 transition-[width] duration-200",
          collapsed ? "w-[4.25rem]" : "w-60",
        )}
      >
        <Brand collapsed={collapsed} />
        <nav aria-label="Hauptnavigation" className="mt-8 flex flex-1 flex-col gap-1 px-3">
          {NAV.slice(0, 3).map((item, i) => (
            <NavItem key={item.to} item={item} index={i} collapsed={collapsed} />
          ))}
          <div className="mt-auto flex flex-col gap-1">
            <NavItem item={NAV[3]} index={3} collapsed={collapsed} />
            <Tip show={collapsed} label="Seitenleiste ausklappen">
              <button
                type="button"
                onClick={() => set({ sidebarCollapsed: !collapsed })}
                aria-label={collapsed ? "Seitenleiste ausklappen" : "Seitenleiste einklappen"}
                aria-expanded={!collapsed}
                className="flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ToggleIcon className="size-4.5 shrink-0" aria-hidden />
                <span className={cn(collapsed && "sr-only")}>Einklappen</span>
              </button>
            </Tip>
          </div>
        </nav>
        <Tip show={collapsed} label={offlineName || "Spielername festlegen"}>
          <NavLink
            to="/settings#spielername"
            aria-label={offlineName ? `Spielername ${offlineName} – wechseln` : "Spielername festlegen"}
            className={cn(
              "mx-3 mt-4 flex items-center gap-3 rounded-xl bg-white/[0.03] ring-1 ring-white/5 outline-none transition-colors hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-ring",
              collapsed ? "justify-center p-1.5" : "p-2.5",
            )}
          >
            <div className="grid size-8 shrink-0 place-items-center rounded-md bg-gold/15 text-xs font-semibold text-gold">
              {offlineName.slice(0, 2).toUpperCase() || "?"}
            </div>
            <div className={cn("min-w-0 leading-tight", collapsed && "sr-only")}>
              <p className="truncate text-sm font-medium">{offlineName || "Kein Spielername"}</p>
              <p className="text-xs text-muted-foreground">{offlineName ? "Wechseln" : "Jetzt festlegen"}</p>
            </div>
          </NavLink>
        </Tip>
      </aside>

      <main className="relative flex-1 overflow-y-auto">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={pageKey}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="mx-auto max-w-[88rem] px-6 py-6 lg:px-10 lg:py-8"
          >
            {outlet}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
