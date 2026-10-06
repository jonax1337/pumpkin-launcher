// Reine Logik der Aktivität im Spiel (docs/bridge/README.md, "Operations and consent", kein React), damit activityModel.check.mjs sie ohne Bundler prüft.
import type { ModActivityEntry, ModConfirmEvent, ModScope } from "../../lib/friends-types.ts";

/** So viele Vorgänge zeigt die Liste und hält der Launcher (`MOD_ACTIVITY_LIMIT`). */
export const ACTIVITY_LIMIT = 100;

/**
 * Die Vorgänge der Bereiche `share` und `social` (docs/bridge/README.md, "Operations and consent") mit ihren Wörterbuchschlüsseln: `activity` ist der Satz für einen
 * ausgeführten Vorgang („Anna als Freund hinzugefügt“), `operation` benennt den Vorgang, bevor er läuft oder wenn er nicht lief.
 */
export const SCOPED_OPS = {
  "host.invite": { activity: "friends.activity.hostInvite", operation: "friends.op.hostInvite" },
  "request.answer": { activity: "friends.activity.requestAnswer", operation: "friends.op.requestAnswer" },
  "friend.addByName": { activity: "friends.activity.friendAddByName", operation: "friends.op.friendAddByName" },
  "invite.joinHere": { activity: "friends.activity.inviteJoinHere", operation: "friends.op.inviteJoinHere" },
  "friend.addByCode": { activity: "friends.activity.friendAddByCode", operation: "friends.op.friendAddByCode" },
  "code.create": { activity: "friends.activity.codeCreate", operation: "friends.op.codeCreate" },
  "code.revoke": { activity: "friends.activity.codeRevoke", operation: "friends.op.codeRevoke" },
  "friend.rename": { activity: "friends.activity.friendRename", operation: "friends.op.friendRename" },
  "friend.remove": { activity: "friends.activity.friendRemove", operation: "friends.op.friendRemove" },
  "friend.block": { activity: "friends.activity.friendBlock", operation: "friends.op.friendBlock" },
  "blocked.unblock": { activity: "friends.activity.blockedUnblock", operation: "friends.op.blockedUnblock" },
  "friend.acknowledge": { activity: "friends.activity.friendAcknowledge", operation: "friends.op.friendAcknowledge" },
} as const;

type KnownOp = keyof typeof SCOPED_OPS;
export type ActivityKey = (typeof SCOPED_OPS)[KnownOp]["activity"];
export type OperationKey = (typeof SCOPED_OPS)[KnownOp]["operation"];

/** Der Text eines Vorgangs als Daten: Schlüssel und, was die Platzhalter füllt (`name` fehlt, wenn die Mod keine Person nannte). */
export interface OpLine<K> {
  key: K | "friends.activity.unknown" | "friends.op.unknown";
  name: string | null;
  op: string;
}

const isKnown = (op: string): op is KnownOp => Object.hasOwn(SCOPED_OPS, op);

/** Der Satz zu einem ausgeführten Vorgang; ein Vorgang, den diese Version nicht kennt, erscheint unter seinem Namen. */
export const activityLine = ({ op, targetName }: Pick<ModActivityEntry, "op" | "targetName">): OpLine<ActivityKey> =>
  ({ key: isKnown(op) ? SCOPED_OPS[op].activity : "friends.activity.unknown", name: targetName, op });

/** Die Benennung des Vorgangs vor der Ausführung oder wenn er nicht lief. */
export const operationLine = ({ op, targetName }: { op: string; targetName: string | null }): OpLine<OperationKey> =>
  ({ key: isKnown(op) ? SCOPED_OPS[op].operation : "friends.op.unknown", name: targetName, op });

/**
 * Der Vorgang in der Rückfrage. Beim Teilen stehen alle Freunde darin, die die Mod einlädt: `summary.targetName` kürzt der
 * Launcher auf 64 Zeichen, und mit bis zu sieben Gästen fehlten dann Namen, ohne dass die Person es sähe, die erlaubt.
 */
export const confirmOperationLine = ({ scope, friends, summary }: Pick<ModConfirmEvent, "scope" | "friends" | "summary">): OpLine<OperationKey> =>
  scope === "share"
    ? operationLine({ op: summary.op, targetName: friends.map((friend) => friend.displayName).join(", ") || null })
    : operationLine(summary);

/** Ein Vorgang, der lief, heißt „erledigt“; sonst wurde er abgelehnt oder scheiterte, und die Liste nennt den Versuch, nicht die Tat. */
export const activityText = (entry: ModActivityEntry): OpLine<ActivityKey | OperationKey> =>
  entry.ok ? activityLine(entry) : operationLine(entry);

/** Der Schlüssel des Satzes über die Rückfrage: ein Satz je Bereich (docs/bridge/README.md, "Operations and consent"). */
export const scopeSentenceKey = (scope: ModScope) => (scope === "share" ? "friendsInvite.mod.scope.share" : "friendsInvite.mod.scope.social");

const sameEntry = (a: ModActivityEntry, b: ModActivityEntry) =>
  a.at === b.at && a.instanceId === b.instanceId && a.op === b.op && a.targetName === b.targetName && a.ok === b.ok;

/**
 * Nimmt einen Vorgang vorn in die Liste auf. Ein Vorgang, der schon darin steht, kommt nicht noch einmal: die Abfrage und das
 * Ereignis können denselben melden. Die Liste bleibt bei `ACTIVITY_LIMIT`; die ältesten fallen heraus.
 */
export const withActivity = (list: ModActivityEntry[], entry: ModActivityEntry): ModActivityEntry[] =>
  [entry, ...list.filter((known) => !sameEntry(known, entry))].slice(0, ACTIVITY_LIMIT);
