import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { BlockTile, LoaderBadge, PageHeader } from "@/components/common";
import { MOCK_MODPACKS } from "@/lib/mock";

export function ModpacksPage() {
  return (
    <>
      <PageHeader title="Modpacks" description="Fertige Zusammenstellungen mit einem Klick installieren." />
      <div className="grid gap-4 md:grid-cols-2">
        {MOCK_MODPACKS.map((pack) => (
          <Card key={pack.id} className="bg-card/60 transition-colors hover:bg-card">
            <CardHeader className="flex items-start gap-4">
              <BlockTile seed={pack.id} />
              <div className="min-w-0">
                <CardTitle className="font-heading text-base">{pack.name}</CardTitle>
                <CardDescription className="mt-1">{pack.description}</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="flex items-center gap-3 text-sm text-muted-foreground">
              <LoaderBadge loader={pack.loader} />
              <span className="font-mono">{pack.minecraftVersion}</span>
              <span>· {pack.mods.length} Mods</span>
            </CardContent>
            <CardFooter className="justify-end border-t bg-transparent">
              <Button variant="outline" size="sm" disabled>
                <Download aria-hidden /> Installieren (folgt)
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </>
  );
}
