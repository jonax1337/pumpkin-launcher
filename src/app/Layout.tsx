import { useEffect, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Compass, LibraryBig, PanelLeftClose, PanelLeftOpen, Play, Settings, type LucideIcon } from "lucide-react";
import { NavLink, useLocation, useMatch, useNavigate, useOutlet } from "react-router";
import { Tip } from "@/components/common";
import { AccountSwitcher } from "@/components/PlayerNames";
import { cn } from "@/lib/utils";
import { useSettings } from "@/store/settings";
import { useGameEvents } from "@/hooks/useInstances";

const NAV: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: "/", label: "Spielen", icon: Play, end: true },
  { to: "/instances", label: "Bibliothek", icon: LibraryBig },
  { to: "/discover", label: "Entdecken", icon: Compass },
  { to: "/settings", label: "Einstellungen", icon: Settings },
];

// Unter 1024 px Breite wird die Seitenleiste zur Icon-Leiste, solange der Nutzer nichts anderes gewählt hat.
const narrowQuery = "(max-width: 1023px)";
const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(narrowQuery);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const useNarrow = () => useSyncExternalStore(subscribe, () => window.matchMedia(narrowQuery).matches);

const itemClass = "flex h-10 items-center gap-3 rounded-lg text-sm font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring";

function NavItem({ item, index, collapsed }: { item: (typeof NAV)[number]; index: number; collapsed: boolean }) {
  const Icon = item.icon;
  // Aktiv-Zustand selbst bestimmen: der Tooltip-Slot verträgt keine className-Funktion von NavLink.
  const isActive = !!useMatch({ path: item.to, end: !!item.end });
  return (
    <Tip show={collapsed} label={`${item.label} (Strg+${index + 1})`}>
      <NavLink
        to={item.to}
        end={item.end}
        aria-keyshortcuts={`Control+${index + 1}`}
        className={cn(
          itemClass,
          collapsed ? "justify-center" : "px-3",
          isActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
        )}
      >
        <Icon className={cn("size-[1.125rem] shrink-0", isActive && "text-primary")} aria-hidden />
        <span className={cn("truncate", collapsed && "sr-only")}>{item.label}</span>
      </NavLink>
    </Tip>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={cn("flex h-10 items-center gap-3", collapsed ? "justify-center" : "px-3")}>
      <div className="grid size-7 shrink-0 grid-cols-2 gap-0.5" aria-hidden>
        <span className="rounded-[3px] bg-primary" />
        <span className="rounded-[3px] bg-primary/55" />
        <span className="rounded-[3px] bg-primary/30" />
        <span className="rounded-[3px] bg-gold" />
      </div>
      <p className={cn("font-heading text-lg font-semibold tracking-tight", collapsed && "sr-only")}>Voxlet</p>
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
  const preference = useSettings((s) => s.sidebarCollapsed);
  const set = useSettings((s) => s.set);
  const narrow = useNarrow();
  const collapsed = preference ?? narrow;
  useGameEvents();
  useShortcuts();
  // Nur das erste Pfadsegment als Key, damit Tabs/Unterseiten nicht doppelt animieren
  const pageKey = "/" + (location.pathname.split("/")[1] ?? "");
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const toggleLabel = collapsed ? "Seitenleiste ausklappen" : "Seitenleiste einklappen";

  return (
    <div className="flex h-full">
      <aside
        className={cn(
          "flex shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar px-3 py-4 transition-[width] duration-200 ease-out",
          collapsed ? "w-16 px-2.5" : "w-56",
        )}
      >
        <Brand collapsed={collapsed} />
        <nav aria-label="Hauptnavigation" className="flex flex-1 flex-col gap-1">
          {NAV.slice(0, 3).map((item, i) => (
            <NavItem key={item.to} item={item} index={i} collapsed={collapsed} />
          ))}
          <div className="mt-auto flex flex-col gap-1">
            <NavItem item={NAV[3]} index={3} collapsed={collapsed} />
            <Tip show={collapsed} label={toggleLabel}>
              <button
                type="button"
                onClick={() => set({ sidebarCollapsed: !collapsed })}
                aria-label={toggleLabel}
                aria-expanded={!collapsed}
                className={cn(itemClass, "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground", collapsed ? "justify-center" : "px-3")}
              >
                <ToggleIcon className="size-[1.125rem] shrink-0" aria-hidden />
                <span className={cn(collapsed && "sr-only")}>Einklappen</span>
              </button>
            </Tip>
          </div>
        </nav>
        <AccountSwitcher collapsed={collapsed} />
      </aside>

      <main className="relative min-w-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={pageKey}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.12, ease: "easeOut" }}
            className="px-6 py-6 xl:px-8 xl:py-8 3xl:px-10"
          >
            <div className="mx-auto w-full wide:max-w-[75rem] 3xl:max-w-[90rem] 4xl:max-w-[100rem]">{outlet}</div>
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
