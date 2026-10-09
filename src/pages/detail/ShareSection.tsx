import { useState, type FormEvent } from "react";
import { invitableFriends, parseManualPort, seatsLeft, seatsTaken, shareState, type ShareState } from "@/components/friends/sharingModel";
import { StopSharingDialog } from "@/components/friends/StopSharingDialog";
import { usePhase } from "@/components/play/phase";
import { useFriendsList, useFriendsState, useHostSessions, useLanStatus } from "@/hooks/useFriends";
import { useWorldQuickPlay } from "@/hooks/useWorlds";
import { useI18n } from "@/i18n";
import { FRIENDS_LIMITS } from "@/lib/friends-types";
import type { HostSession, Instance, LanStatus } from "@/lib/types";
import { friendLabels, friendsActive } from "@/pages/friends/friendsModel";
import { Button, Field, Input, SectionHeader, StatusPanel } from "@/ui";
import { FriendsModRow } from "./FriendsModRow";
import { GuardedButton } from "./guards";
import { ShareDialog } from "./ShareDialog";
import { ShareGuests } from "./ShareGuests";

const PORT_FIELD_CLASS = "w-[160px]";

/** Der Port, mit dem der Dialog teilt: `null` = der vom Backend geprüfte. */
type ShareRequest = { port: number | null };

/**
 * Welt für Freunde teilen, über der Weltenliste: erst die Voraussetzungen (Version, laufendes Spiel, LAN-Port), dann der Dialog,
 * danach die Gäste der Sitzung. Nur bei eingeschalteten Freunden; darunter die Zeile zur Mod.
 */
export function ShareSection({ instance, busy }: { instance: Instance; busy: string | null }) {
  const active = friendsActive(useFriendsState().data);
  return active ? <ShareBody instance={instance} busy={busy} /> : null;
}

function ShareBody({ instance, busy }: { instance: Instance; busy: string | null }) {
  const { t } = useI18n();
  const running = usePhase(instance.id) === "running";
  const versionSupported = useWorldQuickPlay(instance);
  const lan = useLanStatus(instance.id).data ?? null;
  const session = useHostSessions().data?.[0];
  const state = shareState({ instanceId: instance.id, versionSupported, running, lan, session });
  const [request, setRequest] = useState<ShareRequest | null>(null);
  return (
    <section aria-labelledby="share-h">
      <SectionHeader id="share-h" title={t("friendsHost.share.title")} />
      <div className="sh-share-body">
        <ShareStatus state={state} onShare={(port) => setRequest({ port })} />
        <FriendsModRow instance={instance} busy={busy} />
      </div>
      {request && <ShareDialog instance={instance} port={request.port} onClose={() => setRequest(null)} />}
    </section>
  );
}

function ShareStatus({ state, onShare }: { state: ShareState; onShare: (port: number | null) => void }) {
  const { t } = useI18n();
  switch (state.kind) {
    case "versionUnsupported":
      return <StatusPanel title={t("friendsHost.share.versionUnsupported", { version: FRIENDS_LIMITS.minMcLabel })} />;
    case "notRunning":
      return <StatusPanel title={t("friendsHost.share.notRunning")} />;
    case "waitingForLan":
      return <WaitingForLan onShare={onShare} />;
    case "ready":
      return <VerifiedPort lan={state.lan} onShare={() => onShare(null)} />;
    case "sharing":
      return <Sharing session={state.session} onInviteMore={() => onShare(null)} />;
  }
}

function VerifiedPort({ lan, onShare }: { lan: LanStatus; onShare: () => void }) {
  const { t } = useI18n();
  return (
    <StatusPanel
      icon="check"
      title={t("friendsHost.share.port", { port: lan.port, pid: lan.pid })}
      actions={<Button size="s" icon="share" variant="primary" onClick={onShare}>{t("friendsHost.share.start")}</Button>}
    />
  );
}

/** Kein geprüfter Port da: warten, oder den Port von Hand nennen, wenn das Spiel ihn nicht preisgibt. */
function WaitingForLan({ onShare }: { onShare: (port: number) => void }) {
  const { t } = useI18n();
  const [typing, setTyping] = useState(false);
  return (
    <>
      <StatusPanel
        icon="clock"
        title={t("friendsHost.share.waiting")}
        actions={
          <Button size="s" variant="ghost" aria-expanded={typing} onClick={() => setTyping((open) => !open)}>
            {t("friendsHost.share.manualPort")}
          </Button>
        }
      />
      {typing && <ManualPortForm onContinue={onShare} />}
    </>
  );
}

function ManualPortForm({ onContinue }: { onContinue: (port: number) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const port = parseManualPort(text);
  const range = { min: FRIENDS_LIMITS.portMin, max: FRIENDS_LIMITS.portMax };

  function submit(e: FormEvent) {
    e.preventDefault();
    if (port !== null) onContinue(port);
  }

  return (
    <form onSubmit={submit}>
      <Field
        label={t("friendsHost.share.portLabel")}
        help={t("friendsHost.share.portHelp", range)}
        error={text.trim() !== "" && port === null && t("friendsHost.share.portInvalid", range)}
        reserveLines={1}
      >
        <div className="sh-port">
          <Input className={PORT_FIELD_CLASS} inputMode="numeric" maxLength={5} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          <Button type="submit" disabled={port === null}>{t("friendsHost.share.portContinue")}</Button>
        </div>
      </Field>
    </form>
  );
}

/** Die laufende Sitzung: Zahl der Gäste, „Weitere einladen“, „Teilen beenden“ (mit Rückfrage) und die Gästeliste. */
function Sharing({ session, onInviteMore }: { session: HostSession; onInviteMore: () => void }) {
  const { t } = useI18n();
  const friends = useFriendsList().data ?? [];
  const [stopping, setStopping] = useState(false);
  const guests = seatsTaken(session);
  const noOneToInvite = invitableFriends(friends, friendLabels(friends), session).length === 0;
  const inviteBlock = seatsLeft(session) === 0
    ? t("friendsHost.share.seatsFull", { max: FRIENDS_LIMITS.maxGuests })
    : noOneToInvite ? t("friendsHost.share.noOneToInvite") : null;
  return (
    <div>
      <StatusPanel
        tone="run"
        icon="share"
        role="status"
        title={t(guests === 1 ? "friendsHost.share.sharing.one" : "friendsHost.share.sharing.other", { n: guests })}
        actions={
          <>
            <GuardedButton size="s" icon="plus" blocked={inviteBlock} onClick={onInviteMore}>{t("friendsHost.share.inviteMore")}</GuardedButton>
            <Button size="s" variant="ghost" tone="bad" onClick={() => setStopping(true)}>{t("friendsHost.share.stop")}</Button>
          </>
        }
      />
      <ShareGuests session={session} />
      <StopSharingDialog session={stopping ? session : null} onClose={() => setStopping(false)} />
    </div>
  );
}
