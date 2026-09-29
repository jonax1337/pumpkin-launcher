import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Blocks,
  Boxes,
  House,
  Layers,
  Package,
  Settings,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { NavLink, useLocation, useOutlet } from "react-router";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useSettings } from "@/store/settings";
import { useGameEvents } from "@/hooks/useInstances";

const NAV: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: "/", label: "Start", icon: House, end: true },
  { to: "/instances", label: "Instanzen", icon: Boxes },
  { to: "/mods", label: "Mods", icon: Blocks },
  { to: "/modpacks", label: "Modpacks", icon: Package },
  { to: "/presets", label: "Presets", icon: Layers },
];

const NAV_BOTTOM: typeof NAV = [
  { to: "/settings", label: "Einstellungen", icon: Settings },
  { to: "/account", label: "Konto", icon: UserRound },
];

function NavItem({ item }: { item: (typeof NAV)[number] }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
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
              className="absolute inset-0 rounded-lg bg-sidebar-accent ring-1 ring-white/5"
              transition={{ type: "spring", stiffness: 500, damping: 38 }}
            >
              <span className="absolute top-2 bottom-2 -left-3 w-1 rounded-r-full bg-primary shadow-[0_0_12px_var(--primary)]" />
            </motion.span>
          )}
          <Icon className={cn("relative size-4.5", isActive && "text-primary")} aria-hidden />
          <span className="relative">{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3 px-3">
      <div className="grid size-9 grid-cols-2 gap-0.5 rounded-lg bg-primary/15 p-1.5 ring-1 ring-primary/30" aria-hidden>
        <span className="rounded-[2px] bg-primary" />
        <span className="rounded-[2px] bg-primary/50" />
        <span className="rounded-[2px] bg-primary/30" />
        <span className="rounded-[2px] bg-gold" />
      </div>
      <div className="leading-tight">
        <p className="font-heading text-[15px] font-semibold tracking-tight">Laux Launcher</p>
        <p className="text-[11px] text-muted-foreground">Minecraft Java Edition</p>
      </div>
    </div>
  );
}

export function Layout() {
  const location = useLocation();
  const outlet = useOutlet();
  const reduce = useReducedMotion();
  const offlineName = useSettings((s) => s.offlineName);
  useGameEvents();
  // Nur das erste Pfadsegment als Key, damit Tabs/Unterseiten nicht doppelt animieren
  const pageKey = "/" + (location.pathname.split("/")[1] ?? "");

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar py-5">
        <Brand />
        <nav aria-label="Hauptnavigation" className="mt-8 flex flex-1 flex-col gap-1 px-3">
          {NAV.map((item) => (
            <NavItem key={item.to} item={item} />
          ))}
          <div className="mt-auto flex flex-col gap-1">
            {NAV_BOTTOM.map((item) => (
              <NavItem key={item.to} item={item} />
            ))}
          </div>
        </nav>
        <NavLink
          to="/account"
          className="mx-3 mt-4 flex items-center gap-3 rounded-xl bg-white/[0.03] p-2.5 ring-1 ring-white/5 outline-none transition-colors hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="grid size-8 place-items-center rounded-md bg-gold/15 font-mono text-xs font-semibold text-gold">
            {offlineName.slice(0, 2).toUpperCase() || "?"}
          </div>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-medium">{offlineName || "Kein Konto"}</p>
            <p className="text-[11px] text-muted-foreground">
              {offlineName ? "Offline" : "Account anlegen"}
              {api.isMock && " · Demo-Daten"}
            </p>
          </div>
        </NavLink>
      </aside>

      <main className="relative flex-1 overflow-hidden">
        {/* Hintergrund: dezentes Raster + Smaragd-Glow */}
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-grid [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-48 right-[-10%] h-[520px] w-[720px] rounded-full opacity-40 blur-3xl"
          style={{ background: "radial-gradient(closest-side, oklch(0.55 0.13 160 / 55%), transparent)" }}
        />
        <div className="relative h-full overflow-y-auto">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={pageKey}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="mx-auto max-w-6xl px-10 py-10"
            >
              {outlet}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
