import type { ComponentProps } from "react";
import { create } from "zustand";
import { Actions, Button, ConfirmDialog, FormRow } from "@/ui";
import { openPage, useCopyDebugInfo, useShareLog } from "@/hooks/useSupport";
import type { ExitPayload, LogKind } from "@/lib/types";

const REPO_URL = "https://github.com/jonax1337/pumpkin-launcher";

type ShareRequest = { instanceId: string; kind: LogKind };

/** Offene Rückfrage „Log öffentlich teilen?“ (ShareLogDialog, einmal im Layout). */
const useShareAsk = create<{ request: ShareRequest | null }>(() => ({ request: null }));

/** „Log teilen“: erst die Rückfrage, dort lädt „Hochladen“ hoch und kopiert den Link. */
export const askShareLog = (instanceId: string, kind: LogKind) => useShareAsk.setState({ request: { instanceId, kind } });

/** Nach einem Absturz mit Bericht ist der Bericht das aufschlussreichere Log, sonst das des letzten Starts. */
export const shareKindAfter = (crash: ExitPayload | undefined): LogKind => (crash?.crashReport ? "crashReport" : "latest");

/** Rückfrage vor dem Hochladen: was öffentlich wird und was vorher entfernt wird. Einmal im Layout. */
export function ShareLogDialog() {
  const request = useShareAsk((s) => s.request);
  const share = useShareLog();
  const close = () => useShareAsk.setState({ request: null });
  const what = request?.kind === "crashReport" ? "den Absturzbericht" : "das Protokoll des letzten Starts";
  return (
    <ConfirmDialog
      open={!!request}
      // Beim Hochladen nicht schließbar: Abbrechen hielte die Veröffentlichung nicht mehr auf.
      onOpenChange={(o) => !o && !share.isPending && close()}
      danger={false}
      title="Log öffentlich teilen?"
      text={`Pumpkin Launcher lädt ${what} zu mclo.gs hoch. Jeder mit dem Link kann es lesen. Zugangsdaten, dein Benutzername und E-Mail-Adressen werden vorher entfernt.`}
      confirmLabel="Hochladen"
      pendingLabel="Lädt hoch"
      pending={share.isPending}
      onConfirm={() => request && share.mutate(request, { onSettled: close })}
    />
  );
}

/** „Debug-Info kopieren“ im Aussehen des Aufrufers (Größe, Symbol, kompakt). */
export function DebugInfoButton(look: Omit<ComponentProps<typeof Button>, "onClick" | "children">) {
  const copy = useCopyDebugInfo();
  return <Button {...look} disabled={copy.isPending} onClick={() => copy.mutate()}>Debug-Info kopieren</Button>;
}

/** Einstellungen › Support: Fehler melden mit Debug-Info, Fragen in den Diskussionen. */
export function SupportSection() {
  return (
    <>
      <FormRow
        label="Fehler melden"
        hint="Als Issue auf GitHub"
        aside="Die Debug-Info nennt Version, System und Instanzen, ohne Namen, Konten oder Pfade. Nach einem Absturz hilft zusätzlich „Log teilen“ im Protokoll der Instanz."
      >
        <Actions wrap>
          <Button icon="ext" onClick={() => openPage(`${REPO_URL}/issues/new/choose`)}>Fehler melden</Button>
          <DebugInfoButton icon="info" />
        </Actions>
      </FormRow>
      <FormRow label="Fragen und Ideen" hint="In den GitHub-Diskussionen">
        <Actions>
          <Button icon="ext" onClick={() => openPage(`${REPO_URL}/discussions`)}>Diskussionen öffnen</Button>
        </Actions>
      </FormRow>
    </>
  );
}
