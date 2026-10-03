import { useState } from "react";
import { Fingerprint } from "@/components/friends/Fingerprint";
import { FriendAvatar, SelfAsserted } from "@/components/friends/FriendAvatar";
import { useDeclineInvite, useInvitePlan } from "@/hooks/useFriends";
import { useCreateInstance } from "@/hooks/useInstances";
import { useI18n } from "@/i18n";
import { FRIENDS_LIMITS, LOADER_LABELS, type InstanceCandidate, type InstanceSummary, type Invite, type JoinPlan, type ModRef } from "@/lib/types";
import { useUsableAccount } from "@/store/offline";
import { Button, Chip, Dialog, DialogActions, ErrorBox, Field, Heading, Hint, Select, Skel, StatusPanel } from "@/ui";
import { actionAllowed, chosenCandidate, inviteAction, needsMicrosoftAccount } from "./inviteModel";

const DIALOG_WIDTH_PX = 560;
/** Fest, damit der Dialog zwischen Laden, Urteil und „Erneut prüfen“ nicht wächst und schrumpft; der Körper scrollt. */
const DIALOG_HEIGHT_PX = 600;
const PRIMARY_WIDTH_PX = 200;
const PLAN_SKELETON_HEIGHT_PX = 96;

/** Minecraft-Version, Loader und Zahl der Mods der Welt: was der Gastgeber teilt (Spezifikation 5.5). */
function SummaryChips({ summary }: { summary: InstanceSummary }) {
  const { t } = useI18n();
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Chip>{summary.minecraftVersion}</Chip>
      <Chip>{LOADER_LABELS[summary.loader]}</Chip>
      {summary.modCount > 0 && <Chip>{summary.modCount === 1 ? t("friendsInvite.mods.one") : t("friendsInvite.mods.other", { n: summary.modCount })}</Chip>}
    </div>
  );
}

/** Wer einlädt: Kopf, selbst angegebener Name mit Fingerabdruck und die Welt. */
function Sender({ invite }: { invite: Invite }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3">
      <FriendAvatar friendId={invite.from} name={invite.fromName} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-baseline gap-2">
          <SelfAsserted><b className="vx-trunc">{invite.fromName}</b></SelfAsserted>
          <Fingerprint value={invite.fromFingerprint} />
        </div>
        <span className="vx-trunc block text-fg-3">{t("friendsInvite.invites", { title: invite.title })}</span>
      </div>
    </div>
  );
}

/** Mods mit Titel und Dateiname; der Dateiname steht nur dazu, wenn er mehr sagt als der Titel. */
function ModList({ title, mods }: { title: string; mods: ModRef[] }) {
  if (mods.length === 0) return null;
  return (
    <section className="mt-3">
      <Heading level="card" className="mb-1">{title}</Heading>
      <ul className="flex flex-col gap-1">
        {mods.map((mod) => (
          <li key={mod.fileName} className="min-w-0">
            <b className="vx-trunc block">{mod.title}</b>
            {mod.title !== mod.fileName && <span className="vx-trunc block text-fg-3">{mod.fileName}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Die eigene Instanz passt nicht: was ihr fehlt und was sie zu viel hat, mit dem Weg, es zu ändern. */
function MissingContent({ candidate }: { candidate: InstanceCandidate }) {
  const { t } = useI18n();
  return (
    <>
      <StatusPanel tone="warn" title={t("friendsInvite.missing.title", { name: candidate.name })}>{t("friendsInvite.missing.body")}</StatusPanel>
      <ModList title={t("friendsInvite.missing.listMissing")} mods={candidate.missing} />
      <ModList title={t("friendsInvite.missing.listExtra")} mods={candidate.extra} />
      <Hint className="mt-3" icon="info">{t("friendsInvite.missing.hint")}</Hint>
    </>
  );
}

/**
 * Mit einer Instanz steht sie fest (nur wenn sie passt, nennt der Dialog sie; sonst sagt es das Urteil darunter);
 * bei mehreren wählt der Nutzer, welche er prüft oder nimmt.
 */
function InstancePicker({ plan, candidate, onPick }: { plan: JoinPlan; candidate: InstanceCandidate; onPick: (instanceId: string) => void }) {
  const { t } = useI18n();
  if (plan.candidates.length === 1) {
    return candidate.matches && <p className="mb-3"><b>{t("friendsInvite.instance.single", { name: candidate.name })}</b></p>;
  }
  return (
    <Field label={t("friendsInvite.instance.label")} className="mb-3">
      <Select
        value={candidate.instanceId}
        onChange={onPick}
        options={plan.candidates.map(({ instanceId, name }) => ({ value: instanceId, label: name }))}
        ariaLabel={t("friendsInvite.instance.pick")}
      />
    </Field>
  );
}

/** Das Urteil des Abgleichs: passende Instanz, Unterschiede, keine Instanz oder zu alte Version. */
function PlanView({ plan, candidate, onPick }: { plan: JoinPlan; candidate: InstanceCandidate | undefined; onPick: (instanceId: string) => void }) {
  const { t } = useI18n();
  const { summary } = plan;
  return (
    <>
      {plan.lookupFailed && <Hint className="mb-3" icon="info">{t("friendsInvite.lookupFailed")}</Hint>}
      {plan.verdict === "versionUnsupported" && (
        <StatusPanel tone="bad" title={t("friendsInvite.unsupported.title", { min: FRIENDS_LIMITS.minMcLabel })}>
          {t("friendsInvite.unsupported.body", { version: summary.minecraftVersion, min: FRIENDS_LIMITS.minMcLabel })}
        </StatusPanel>
      )}
      {plan.verdict === "noInstance" && <p>{t("friendsInvite.none", { version: summary.minecraftVersion, loader: LOADER_LABELS[summary.loader] })}</p>}
      {candidate && (plan.verdict === "ready" || plan.verdict === "missingContent") && (
        <>
          <InstancePicker plan={plan} candidate={candidate} onPick={onPick} />
          {plan.verdict === "missingContent" && <MissingContent candidate={candidate} />}
        </>
      )}
    </>
  );
}

/**
 * Einladung eines Freundes: wer lädt wozu ein und was der Abgleich mit den eigenen Instanzen ergibt (Spezifikation 10.4).
 * `onJoin` übernimmt den Beitritt samt Installation; der Aufrufer schließt den Dialog danach selbst.
 */
export function InviteDialog({ invite, onJoin, onClose }: { invite: Invite; onJoin: (instanceId: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const plan = useInvitePlan(invite.id);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const decline = useDeclineInvite();
  const createVanilla = useCreateInstance();
  const hasMicrosoftAccount = useUsableAccount()?.kind === "microsoft";

  const verdict = plan.data && !plan.isFetching ? plan.data : null;
  const candidate = verdict ? chosenCandidate(verdict, pickedId) : undefined;
  const action = verdict ? inviteAction(verdict, candidate) : "none";
  const busy = decline.isPending || createVanilla.isPending;

  function makeVanillaInstance() {
    const { minecraftVersion } = invite.instance;
    createVanilla.mutate(
      { name: invite.title, minecraftVersion, loader: "vanilla", loaderVersion: null, memoryMb: null },
      { onSuccess: () => void plan.refetch() },
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("friendsInvite.title")}
      width={DIALOG_WIDTH_PX}
      height={DIALOG_HEIGHT_PX}
      busy={busy}
      footLeft={<Button variant="ghost" tone="bad" disabled={busy} onClick={() => decline.mutate(invite.id, { onSuccess: onClose })}>{t("friendsInvite.decline")}</Button>}
      footer={
        <>
          {plan.data?.verdict === "missingContent" && (
            <Button disabled={plan.isFetching} onClick={() => void plan.refetch()}>{t("friendsInvite.missing.recheck")}</Button>
          )}
          <DialogActions cancel={{ label: t("friendsInvite.later"), autoFocus: true, disabled: busy }} />
          {action === "join" && (
            <Button variant="primary" icon="play" width={PRIMARY_WIDTH_PX} disabled={!actionAllowed(action, hasMicrosoftAccount)} onClick={() => candidate && onJoin(candidate.instanceId)}>
              {t("friendsInvite.join")}
            </Button>
          )}
          {action === "createVanilla" && (
            <Button variant="primary" width={PRIMARY_WIDTH_PX} disabled={busy} onClick={makeVanillaInstance}>
              {createVanilla.isPending ? t("friendsInvite.creating") : t("friendsInvite.createVanilla")}
            </Button>
          )}
        </>
      }
    >
      <Sender invite={invite} />
      <SummaryChips summary={invite.instance} />
      {!invite.hostOnline && <Hint className="mt-3" tone="warn">{t("friendsInvite.hostOffline")}</Hint>}
      <div className="mt-4">
        {plan.isFetching ? (
          <Skel h={PLAN_SKELETON_HEIGHT_PX} />
        ) : plan.error ? (
          <ErrorBox title={t("friendsInvite.planFailed")} error={plan.error} onRetry={() => void plan.refetch()} />
        ) : (
          verdict && <PlanView plan={verdict} candidate={candidate} onPick={setPickedId} />
        )}
      </div>
      {needsMicrosoftAccount(action, hasMicrosoftAccount) && <Hint className="mt-3" tone="warn" live>{t("friendsInvite.offlineAccount")}</Hint>}
    </Dialog>
  );
}
