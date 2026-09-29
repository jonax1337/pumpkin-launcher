import { useSearchParams } from "react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/common";
import { ContentCatalog } from "@/components/ContentCatalog";

/** Stöbern ohne Instanz: Modpacks werden zu neuen Instanzen, Mods landen in einer bestehenden. */
export function DiscoverPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "mods" ? "mods" : "modpacks";
  return (
    <>
      <PageHeader title="Entdecken" description="Modpacks und Mods von Modrinth." />
      <Tabs value={tab} onValueChange={(t) => setParams({ tab: t }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="modpacks">Modpacks</TabsTrigger>
          <TabsTrigger value="mods">Mods</TabsTrigger>
        </TabsList>
        <TabsContent value="modpacks" className="mt-6">
          <ContentCatalog type="modpack" />
        </TabsContent>
        <TabsContent value="mods" className="mt-6">
          <ContentCatalog type="mod" />
        </TabsContent>
      </Tabs>
    </>
  );
}
