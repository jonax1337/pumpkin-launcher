import { useState } from "react";
import { useSearchParams } from "react-router";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/common";
import { AddToInstanceMenu, ContentDetail, ContentResults, KIND_LABELS, PackActions, PackInstallButton } from "@/components/ContentBrowser";
import { packReason, type CatalogType } from "@/lib/modrinth";
import { cn } from "@/lib/utils";

const TABS: CatalogType[] = ["modpack", "mod", "shader", "resourcepack"];
const LABELS: Record<CatalogType, string> = { modpack: "Modpacks", ...KIND_LABELS };

/** Stöbern ohne Instanz: Modpacks werden zu neuen Instanzen, alles andere landet in einer bestehenden. */
export function DiscoverPage() {
  const [params, setParams] = useSearchParams();
  const type = TABS.find((t) => t === params.get("tab")) ?? "modpack";
  // ?projekt= öffnet direkt die Details (aus dem Dialog „Neu“).
  const [projectId, setProjectId] = useState<string | null>(params.get("projekt"));

  return (
    <div>
      <PageHeader title="Entdecken" description="Modpacks, Mods, Shader und Ressourcenpakete von Modrinth." />
      {projectId ? (
        <div className="max-w-5xl">
          <ContentDetail
            projectId={projectId}
            type={type}
            onBack={() => setProjectId(null)}
            action={(p) =>
              type === "modpack" ? <PackActions projectId={p.id} title={p.title} /> : <AddToInstanceMenu projectId={p.id} title={p.title} type={type} large />
            }
          />
        </div>
      ) : (
        <Tabs value={type} onValueChange={(t) => setParams({ tab: t }, { replace: true })} className="mb-4">
          <TabsList variant="line" className="h-10 w-full justify-start gap-5 overflow-x-auto rounded-none border-b p-0">
            {TABS.map((t) => (
              <TabsTrigger key={t} value={t} className="flex-none px-0.5">
                {LABELS[t]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      {/* Bleibt beim Öffnen von Details erhalten, damit Suche und geladene Seiten nicht verloren gehen. */}
      <div className={cn(projectId && "hidden")}>
        <ContentResults
          key={type}
          type={type}
          grid
          barClassName="bg-background"
          onOpen={setProjectId}
          action={(hit) =>
            type === "modpack" ? (
              <PackInstallButton projectId={hit.project_id} title={hit.title} reason={packReason(hit.categories)} />
            ) : (
              <AddToInstanceMenu projectId={hit.project_id} title={hit.title} type={type} />
            )
          }
        />
      </div>
    </div>
  );
}
