import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { PageHeader } from "@/components/common";
import { formatMemory } from "@/lib/format";
import { useSettings } from "@/store/settings";

export function SettingsPage() {
  const s = useSettings();

  return (
    <>
      <PageHeader
        title="Einstellungen"
        description="Standardwerte für alle Instanzen. Werden lokal gespeichert und beim Spielstart übergeben."
        actions={
          <Button variant="ghost" onClick={s.reset}>
            <RotateCcw aria-hidden /> Zurücksetzen
          </Button>
        }
      />
      <div className="space-y-6">
        <Card className="bg-card/60">
          <CardHeader>
            <CardTitle>Java &amp; Arbeitsspeicher</CardTitle>
            <CardDescription>Leer lassen, um die passende Laufzeit automatisch von Mojang zu laden (empfohlen).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="java-path">
                Java-Pfad <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
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
                <Label htmlFor="memory">Standard-Arbeitsspeicher</Label>
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
              <p className="text-xs text-muted-foreground">Gilt für Instanzen ohne eigenen Wert und als Vorgabe für neue Instanzen.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
