import React from "react";
import ReactDOM from "react-dom/client";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { TipProvider, Toaster } from "@/ui";
import { Layout } from "@/app/Layout";
import { BrandProvider } from "@/branding/Brand";
import { INSTALL_CANCELLED } from "@/lib/types";
import { HomePage } from "@/pages/Home";
import { InstancesPage } from "@/pages/Instances";
import { InstanceDetailPage } from "@/pages/InstanceDetail";
import { DiscoverPage } from "@/pages/Discover";
import { SettingsPage } from "@/pages/Settings";
import { NotFoundPage } from "@/pages/NotFound";
import "./index.css";

// Mutations-Fehler zentral als Toast; Mutationen mit eigenem Fehler-Toast setzen `meta.ownErrorToast`.
// Query-Fehler zeigen die Seiten inline.
const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: (err, _vars, _ctx, mutation) => {
      if (mutation.meta?.ownErrorToast) return;
      // Abbrechen war Absicht: neutral melden, nicht als Fehler.
      if (err.message === INSTALL_CANCELLED) toast(INSTALL_CANCELLED);
      else toast.error(err.message);
    },
  }),
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

// Nur Entwicklung: Layoutshift-Summe (PIXELKINO.md §4) in window.__cls
if (import.meta.env.DEV && typeof PerformanceObserver !== "undefined") {
  const w = window as Window & { __cls?: number };
  w.__cls = 0;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
        if (!e.hadRecentInput) w.__cls = (w.__cls ?? 0) + e.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {
    // layout-shift nicht unterstützt
  }
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "instances", element: <InstancesPage /> },
      { path: "instances/:id", element: <InstanceDetailPage /> },
      { path: "discover", element: <DiscoverPage /> },
      { path: "settings", element: <SettingsPage /> },
      // Alte Adressen aus früheren Versionen
      { path: "mods", element: <Navigate to="/discover?tab=mods" replace /> },
      { path: "modpacks", element: <Navigate to="/discover" replace /> },
      { path: "account", element: <Navigate to="/settings" replace /> },
      // Nur Entwicklung: Vorschau des Pixel-Kits (fällt im Build weg)
      ...(import.meta.env.DEV ? [{ path: "_kit", lazy: async () => ({ Component: (await import("@/ui/KitPage")).KitPage }) }] : []),
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TipProvider delayDuration={450}>
        <BrandProvider>
          <RouterProvider router={router} />
          <Toaster />
        </BrandProvider>
      </TipProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
