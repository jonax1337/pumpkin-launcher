import React from "react";
import ReactDOM from "react-dom/client";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/app/Layout";
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
      if (!mutation.meta?.ownErrorToast) toast.error(err.message);
    },
  }),
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
      { path: "discover", element: <DiscoverPage /> },
      { path: "settings", element: <SettingsPage /> },
      // Alte Adressen aus früheren Versionen
      { path: "mods", element: <Navigate to="/discover?tab=mods" replace /> },
      { path: "modpacks", element: <Navigate to="/discover" replace /> },
      { path: "account", element: <Navigate to="/settings" replace /> },
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
