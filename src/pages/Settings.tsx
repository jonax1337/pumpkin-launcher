import { ChevronRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { PageHeader } from "@/components/common";
import { PlayerNamesCard } from "@/components/PlayerNames";
import { formatMemory } from "@/lib/format";
import { useSettings } from "@/store/settings";

export function SettingsPage() {
  const s = useSettings();

  return (
    <>
      <PageHeader title="Einstellungen" description="Gilt für alle Instanzen, solange eine Instanz nichts Eigenes festlegt." />
      <div className="max-w-3xl space-y-6">
        <PlayerNamesCard />
        <Card className="bg-card">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1.5">
              <CardTitle>Leistung</CardTitle>
              <CardDescription>Wie viel Arbeitsspeicher Minecraft bekommt.</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={s.reset}>
              <RotateCcw aria-hidden /> Standard
            </Button>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="memory">Arbeitsspeicher</Label>
                <span className="text-sm font-medium text-primary tabular-nums">{formatMemory(s.memoryMb)}</span>
              </div>
              <Slider
                id="memory"
                aria-label="Arbeitsspeicher in MB"
                min={1024}
                max={16384}
                step={512}
                value={[s.memoryMb]}
                onValueChange={([v]) => s.set({ memoryMb: v })}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>1 GB</span>
                <span>16 GB</span>
              </div>
            </div>
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden /> Erweitert
              </summary>
              <div className="mt-4 space-y-2">
                <Label htmlFor="java-path">
                  Eigenes Java <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="java-path"
                  value={s.javaPath}
                  onChange={(e) => s.set({ javaPath: e.target.value })}
                  placeholder="C:\Program Files\Java\jdk-21\bin\javaw.exe"
                />
                <p className="text-xs text-muted-foreground">Leer lassen: Voxlet lädt das passende Java selbst (empfohlen).</p>
              </div>
            </details>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
