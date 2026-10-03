import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { TipProvider, Toaster } from "@/ui";
import { LanguageProvider } from "@/i18n";
import { Layout } from "@/app/Layout";
import { BrandProvider } from "@/branding/Brand";
import { trackLayoutShift } from "@/dev/layoutShift";
import { queryClient } from "@/lib/queryClient";
import { discoverUrl } from "@/lib/routes";
import { HomePage } from "@/pages/Home";
import { InstancesPage } from "@/pages/Instances";
import { InstanceDetailPage } from "@/pages/InstanceDetail";
import { DiscoverPage } from "@/pages/Discover";
import { SettingsPage } from "@/pages/Settings";
import { SkinsPage } from "@/pages/Skins";
import { FriendsPage } from "@/pages/Friends";
import { NotFoundPage } from "@/pages/NotFound";
import "./index.css";

if (import.meta.env.DEV) trackLayoutShift();

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
      { path: "skins", element: <SkinsPage /> },
      { path: "friends", element: <FriendsPage /> },
      // Alte Adressen aus früheren Versionen
      { path: "mods", element: <Navigate to={discoverUrl({ tab: "mod" })} replace /> },
      { path: "modpacks", element: <Navigate to={discoverUrl()} replace /> },
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
      <LanguageProvider>
        <TipProvider delayDuration={450}>
          <BrandProvider>
            <RouterProvider router={router} />
            <Toaster />
          </BrandProvider>
        </TipProvider>
      </LanguageProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
