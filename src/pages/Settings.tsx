import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/common";
import { formatMemory } from "@/lib/format";
import { useSettings } from "@/store/settings";

export function SettingsPage() {
  const s = useSettings();

  return (
    <>
      <PageHeader
        title="Einstellungen"
        description="Standardwerte für alle Instanzen. Werden lokal gespeichert."
        actions={
          <Button variant="ghost" onClick={s.reset}>
            <RotateCcw aria-hidden /> Zurücksetzen
          </Button>
        }
      />
      <div className="space-y-6">
        <Card className="bg-card/60">
          <CardHeader>
            <CardTitle>Java</CardTitle>
            <CardDescription>Leer lassen, um die mitgelieferte Laufzeit zu verwenden.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="java-path">Java-Pfad</Label>
              <Input
                id="java-path"
                value={s.javaPath}
                onChange={(e) => s.set({ javaPath: e.target.value })}
                placeholder="C:\Program Files\Java\jdk-21\bin\javaw.exe"
                className="font-mono text-xs"
              />
            </div>
            <Separator />
            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="memory">Arbeitsspeicher</Label>
                <span className="font-mono text-sm text-primary">{formatMemory(s.memoryMb)}</span>
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
              <div className="flex justify-between font-mono text-[11px] text-muted-foreground">
                <span>1 GB</span>
                <span>16 GB</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/60">
          <CardHeader>
            <CardTitle>Pfade</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="game-dir">Spielverzeichnis</Label>
              <Input id="game-dir" value={s.gameDir} onChange={(e) => s.set({ gameDir: e.target.value })} className="font-mono text-xs" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="instances-dir">Instanzen-Verzeichnis</Label>
              <Input id="instances-dir" value={s.instancesDir} onChange={(e) => s.set({ instancesDir: e.target.value })} className="font-mono text-xs" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/60">
          <CardHeader>
            <CardTitle>Verhalten</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="close-on-launch">Launcher beim Spielstart schließen</Label>
                <p className="mt-1 text-xs text-muted-foreground">Spart Ressourcen während des Spielens.</p>
              </div>
              <Switch id="close-on-launch" checked={s.closeOnLaunch} onCheckedChange={(v) => s.set({ closeOnLaunch: v })} />
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
