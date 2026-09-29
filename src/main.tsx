import React from "react";
import ReactDOM from "react-dom/client";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { createBrowserRouter, RouterProvider } from "react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/app/Layout";
import { HomePage } from "@/pages/Home";
import { InstancesPage } from "@/pages/Instances";
import { InstanceDetailPage } from "@/pages/InstanceDetail";
import { ModsPage } from "@/pages/Mods";
import { ModpacksPage } from "@/pages/Modpacks";
import { PresetsPage } from "@/pages/Presets";
import { SettingsPage } from "@/pages/Settings";
import { AccountPage } from "@/pages/Account";
import { NotFoundPage } from "@/pages/NotFound";
import "./index.css";

// Fehler aus Backend-Aufrufen zentral als Toast
const toastError = (err: Error) => toast.error(err.message);

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: toastError }),
  mutationCache: new MutationCache({ onError: toastError }),
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "instances", element: <InstancesPage /> },
      { path: "instances/:id", element: <InstanceDetailPage /> },
      { path: "mods", element: <ModsPage /> },
      { path: "modpacks", element: <ModpacksPage /> },
      { path: "presets", element: <PresetsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "account", element: <AccountPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <RouterProvider router={router} />
        <Toaster position="bottom-right" richColors closeButton />
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
