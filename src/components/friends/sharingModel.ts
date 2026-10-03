// Reine Logik des Teilens (kein React), damit sharingModel.check.mjs sie ohne Bundler prüft.
import { FRIENDS_LIMITS } from "../../lib/friends-types.ts";
import type { Friend, HostSession, Invite, JoinSessionEvent, LanStatus, SessionGuest } from "../../lib/friends-types.ts";
import { canInvite, holdsSeat, visibleFriends } from "../../pages/friends/friendsModel.ts";

/** Wo das Teilen einer Instanz steht; bestimmt, was der Abschnitt „Mit Freunden teilen“ zeigt. */
export type ShareState =
  | { kind: "versionUnsupported" }
  | { kind: "notRunning" }
  | { kind: "waitingForLan" }
  | { kind: "ready"; lan: LanStatus }
  | { kind: "sharing"; session: HostSession };

/** `versionSupported` ist `undefined`, solange unbekannt: dann zählt die Version als unterstützt (das Backend lehnt sie sonst selbst ab). */
export function shareState({ instanceId, versionSupported, running, lan, session }: {
  instanceId: string; versionSupported: boolean | undefined; running: boolean; lan: LanStatus | null; session: HostSession | undefined;
}): ShareState {
  if (session?.instanceId === instanceId) return { kind: "sharing", session };
  if (versionSupported === false) return { kind: "versionUnsupported" };
  if (!running) return { kind: "notRunning" };
  return lan ? { kind: "ready", lan } : { kind: "waitingForLan" };
}

/** Der Port aus dem Eingabefeld; `null`, wenn er keine ganze Zahl im erlaubten Bereich ist. */
export function parseManualPort(text: string): number | null {
  const digits = text.trim();
  if (!/^\d{1,5}$/.test(digits)) return null;
  const port = Number(digits);
  return port >= FRIENDS_LIMITS.portMin && port <= FRIENDS_LIMITS.portMax ? port : null;
}

/** Plätze, die Gäste belegen: eingeladen, verbunden oder von selbst gegangen (5.4). */
export const seatsTaken = (session: HostSession | undefined): number =>
  session ? session.guests.filter((guest) => holdsSeat(guest.state, guest.kicked)).length : 0;

/** Wie viele Freunde noch eingeladen werden können. */
export const seatsLeft = (session: HostSession | undefined): number => FRIENDS_LIMITS.maxGuests - seatsTaken(session);

const NO_GUESTS = { guests: [] };

/** Wer jetzt eingeladen werden kann (bestätigt, online, ohne Platz), alphabetisch wie auf der Freunde-Seite. */
export function invitableFriends(friends: Friend[], labels: Map<string, string>, session: HostSession | undefined): Friend[] {
  const open = friends.filter((friend) => canInvite(friend, session ?? NO_GUESTS));
  return visibleFriends(open, labels, { query: "", onlineOnly: false });
}

export type GuestStatus = "invited" | "connected" | "declined" | "kicked" | "left";

/** Der Zustand eines Gasts in der Liste; ein entfernter Gast ist mehr als einer, der von selbst ging. */
export const guestStatus = (guest: SessionGuest): GuestStatus => (guest.state === "left" && guest.kicked ? "kicked" : guest.state);

/** Abgelehnte und entfernte Gäste haben keinen Platz mehr; nur ein neues „Einladen“ lässt sie wieder hinein (Spezifikation 5.4). */
export const canReinvite = (guest: SessionGuest): boolean => !holdsSeat(guest.state, guest.kicked);

export const canKick = (guest: SessionGuest): boolean => holdsSeat(guest.state, guest.kicked);

export const connectedGuestCount = (session: HostSession): number => session.guests.filter((guest) => guest.state === "connected").length;

/** Ein Beitritt als Anzeige: das Ereignis und der Name des Gastgebers, solange die Einladung noch bekannt war. */
export type ActiveJoin = { event: JoinSessionEvent; hostName: string | null };

export function hostNameOf(invites: Invite[] | undefined, inviteId: string): string | null {
  return invites?.find((invite) => invite.id === inviteId)?.fromName ?? null;
}

/**
 * Der Beitritt nach einem `join-session`-Ereignis. Ein neuer Beitritt beendet den alten, und dessen `ended` kann nach
 * dem `waitingForGame` des neuen kommen: es beendet nur den Beitritt, zu dem es gehört.
 */
export function nextJoin(current: ActiveJoin | null, event: JoinSessionEvent, hostName: string | null): ActiveJoin | null {
  const sameJoin = current?.event.joinId === event.joinId;
  if (event.state.type === "ended") return sameJoin ? null : current;
  const knownName = sameJoin ? current?.hostName : null;
  return { event, hostName: knownName ?? hostName };
}

export type CloseWarning = "hosting" | "joining" | "both";

/** Was das Schließen des Fensters beendet; `null`, wenn nichts läuft und es ohne Rückfrage geht. */
export function closeWarning(hosting: boolean, joining: boolean): CloseWarning | null {
  if (hosting && joining) return "both";
  if (hosting) return "hosting";
  return joining ? "joining" : null;
}
