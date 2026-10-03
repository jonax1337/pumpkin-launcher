import { useState, type ReactNode } from "react";
import { useLeaveJoin } from "@/hooks/useFriends";
import { useI18n } from "@/i18n";
import type { HostSession, JoinState } from "@/lib/types";
import { Button, ChipButton, Heading, Hint, Popover } from "@/ui";
import { ConnectionText, pathLabel, pathTip, Rtt } from "./ConnectionText";
import { connectedGuestCount, type ActiveJoin } from "./sharingModel";
import { StopSharingDialog } from "./StopSharingDialog";
import type { SharingActivity } from "./useSharingActivity";

const CHIP_WIDTH_PX = 248;
const POPOVER_WIDTH_PX = 320;

/**
 * Chip in der Fensterleiste, solange geteilt wird oder ein Beitritt läuft („Geteilt · 2 verbunden“, „Bei Alex · Direkt · 38 ms“).
 * Feste Breite, damit wechselnde Zahlen nichts verschieben. Ein Klick öffnet die Platte mit Verbindung und „Teilen beenden“ bzw. „Verlassen“.
 */
export function SessionChip({ activity: { session, join } }: { activity: SharingActivity }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  if (!session && !join) return null;
  const stop = () => {
    setOpen(false);
    setStopping(true);
  };
  return (
    <>
      <Popover
        open={open}
        onOpenChange={setOpen}
        align="start"
        width={POPOVER_WIDTH_PX}
        label={t(session ? "friendsHost.pop.hostTitle" : "friendsHost.pop.joinTitle")}
        trigger={
          <ChipButton icon={session ? "share" : "users"} data-tone="run" style={{ width: CHIP_WIDTH_PX }}>
            {session ? <HostingText session={session} /> : join && <JoiningText join={join} />}
          </ChipButton>
        }
      >
        <div className="flex flex-col gap-4 p-1">
          {session && <HostingPanel session={session} onStop={stop} />}
          {join && <JoiningPanel join={join} onLeft={() => setOpen(false)} />}
        </div>
      </Popover>
      <StopSharingDialog session={stopping ? (session ?? null) : null} onClose={() => setStopping(false)} />
    </>
  );
}

const hostName = (join: ActiveJoin, unknown: string) => join.hostName ?? unknown;

function HostingText({ session }: { session: HostSession }) {
  const { t } = useI18n();
  return <span className="ell">{t("friendsHost.chip.hosting", { n: connectedGuestCount(session) })}</span>;
}

function JoiningText({ join }: { join: ActiveJoin }) {
  const { t } = useI18n();
  const { state } = join.event;
  return (
    <>
      <span className="ell">{t("friendsHost.chip.joinLead", { name: hostName(join, t("friendsHost.chip.unknownHost")) })}</span>
      <span className="shrink-0">
        {" · "}
        {state.type === "connected" ? <ConnectionText path={state.path} rttMs={state.rttMs} /> : <JoinProgressText type={state.type} />}
      </span>
    </>
  );
}

/** Der Stand eines Beitritts, der noch nicht verbunden ist. */
function JoinProgressText({ type }: { type: JoinState["type"] }) {
  const { t } = useI18n();
  return <>{type === "connecting" ? t("friendsHost.chip.connecting") : t("friendsHost.chip.waiting")}</>;
}

function Facts({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <Heading level="card">{title}</Heading>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[13px]">
      <span className="text-fg-3">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

function HostingPanel({ session, onStop }: { session: HostSession; onStop: () => void }) {
  const { t } = useI18n();
  const connected = session.guests.filter((guest) => guest.state === "connected");
  return (
    <Facts title={t("friendsHost.pop.hostTitle")}>
      {connected.length === 0 && <Hint>{t("friendsHost.pop.noGuests")}</Hint>}
      {connected.map((guest) => (
        <Fact key={guest.friendId} label={guest.displayName}>
          {guest.path && <ConnectionText path={guest.path} rttMs={guest.rttMs} />}
        </Fact>
      ))}
      <Button size="s" variant="ghost" tone="bad" onClick={onStop}>{t("friendsHost.share.stop")}</Button>
    </Facts>
  );
}

function JoiningPanel({ join, onLeft }: { join: ActiveJoin; onLeft: () => void }) {
  const { t } = useI18n();
  const leave = useLeaveJoin();
  const { state, joinId } = join.event;
  return (
    <Facts title={t("friendsHost.pop.joinTitle")}>
      <Fact label={t("friendsHost.pop.peer")}>{hostName(join, t("friendsHost.chip.unknownHost"))}</Fact>
      {state.type === "connected" ? (
        <>
          <Fact label={t("friendsHost.pop.path")}>{pathLabel(state.path)}</Fact>
          {state.rttMs != null && <Fact label={t("friendsHost.pop.rtt")}><Rtt ms={state.rttMs} /></Fact>}
          <Hint>{pathTip(state.path)}</Hint>
        </>
      ) : (
        <Fact label={t("friendsHost.pop.status")}><JoinProgressText type={state.type} /></Fact>
      )}
      <Button size="s" disabled={leave.isPending} onClick={() => leave.mutate(joinId, { onSuccess: onLeft })}>{t("friendsHost.pop.leave")}</Button>
    </Facts>
  );
}
