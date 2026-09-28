import { LogIn, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/common";
import { useSettings } from "@/store/settings";

export function AccountPage() {
  const offlineName = useSettings((s) => s.offlineName);
  const set = useSettings((s) => s.set);
  const valid = /^[A-Za-z0-9_]{3,16}$/.test(offlineName);

  return (
    <>
      <PageHeader title="Konto" description="Anmelden, um auf Server mit Online-Modus zu spielen." />
      <Card className="max-w-xl bg-card/60">
        <CardHeader>
          <CardTitle>Microsoft-Konto</CardTitle>
          <CardDescription>Die Anmeldung über Microsoft wird in einer späteren Version verfügbar.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Button disabled className="w-full">
            <LogIn aria-hidden /> Mit Microsoft anmelden
          </Button>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Separator className="flex-1" /> oder <Separator className="flex-1" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="offline-name">Offline-Name</Label>
            <div className="relative">
              <UserRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                id="offline-name"
                value={offlineName}
                onChange={(e) => set({ offlineName: e.target.value })}
                aria-invalid={!valid}
                aria-describedby="offline-name-hint"
                className="pl-9"
                maxLength={16}
              />
            </div>
            <p id="offline-name-hint" className={valid ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
              3–16 Zeichen, nur Buchstaben, Ziffern und Unterstrich. Nur für Einzelspieler und Offline-Server.
            </p>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
