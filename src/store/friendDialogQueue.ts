// Reine Warteschlange der globalen Freunde-Dialoge (kein React), damit friendDialogQueue.check.mjs sie ohne Bundler prüft.
import type { ModConfirmEvent } from "../lib/friends-types.ts";

/** Was ein globaler Freunde-Dialog zeigt: eine Einladung (per ID, der Inhalt kommt aus der Abfrage) oder die Bitte der Mod. */
export type FriendDialog = { kind: "invite"; inviteId: string } | { kind: "modConfirm"; confirm: ModConfirmEvent };

/** `active` ist der eine offene Dialog; alle weiteren warten, bis er zu ist. */
export interface DialogQueue {
  active: FriendDialog | null;
  waiting: FriendDialog[];
}

/** So lange wartet die Mod auf die Antwort (CONFIRM_WAIT im Backend); danach kennt das Backend die Bitte nicht mehr. */
export const MOD_CONFIRM_TTL_MS = 120_000;

export const emptyDialogQueue: DialogQueue = { active: null, waiting: [] };

const same = (a: FriendDialog, b: FriendDialog) =>
  a.kind === "invite" ? b.kind === "invite" && a.inviteId === b.inviteId : b.kind === "modConfirm" && a.confirm.requestId === b.confirm.requestId;

const isShownOrWaiting = (queue: DialogQueue, dialog: FriendDialog) =>
  [queue.active, ...queue.waiting].some((other) => other !== null && same(other, dialog));

/** Reiht einen Dialog hinten ein; was schon offen ist oder wartet, kommt nicht noch einmal. */
export const enqueue = (queue: DialogQueue, dialog: FriendDialog): DialogQueue =>
  isShownOrWaiting(queue, dialog) ? queue : { ...queue, waiting: [...queue.waiting, dialog] };

/** Die Bitte der Mod verfällt nach `MOD_CONFIRM_TTL_MS`, eine Einladung nicht: sie geht vor. */
const nextWaiting = (waiting: FriendDialog[]) => waiting.find((dialog) => dialog.kind === "modConfirm") ?? waiting[0];

/** Öffnet den nächsten wartenden Dialog, sofern keiner offen ist. */
export function promote(queue: DialogQueue): DialogQueue {
  const next = queue.active === null ? nextWaiting(queue.waiting) : undefined;
  return next ? { active: next, waiting: queue.waiting.filter((dialog) => dialog !== next) } : queue;
}

export const closeActive = (queue: DialogQueue): DialogQueue => ({ ...queue, active: null });

/** Eine verfallene Bitte der Mod verschwindet, ob sie offen ist oder wartet: das Backend nähme keine Antwort mehr an. */
export const dropModConfirm = (queue: DialogQueue, requestId: string): DialogQueue => {
  const isRequest = (dialog: FriendDialog | null) => dialog?.kind === "modConfirm" && dialog.confirm.requestId === requestId;
  return { active: isRequest(queue.active) ? null : queue.active, waiting: queue.waiting.filter((dialog) => !isRequest(dialog)) };
};

/** Eine widerrufene Einladung verschwindet, ob sie offen ist oder wartet. */
export const dropInvite = (queue: DialogQueue, inviteId: string): DialogQueue => {
  const isInvite = (dialog: FriendDialog | null) => dialog?.kind === "invite" && dialog.inviteId === inviteId;
  return { active: isInvite(queue.active) ? null : queue.active, waiting: queue.waiting.filter((dialog) => !isInvite(dialog)) };
};
