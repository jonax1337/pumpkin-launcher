// Reine Logik der Freunde-Seite (kein React), damit friendsModel.check.mjs sie ohne Bundler prüft.
import type { Friend, FriendRequest, FriendsState, HostSession, Invite } from "../../lib/friends-types.ts";

/** Warum die Seite statt der Freundesliste einen Hinweis zeigt; die Reihenfolge ist die der Prüfung. */
export type FriendsGate = "noSecretStore" | "identityLost" | "disabled" | "noMicrosoftAccount";

export function friendsGate(state: FriendsState, hasMicrosoftAccount: boolean): FriendsGate | null {
  if (state.availability === "noSecretStore") return "noSecretStore";
  if (state.availability === "identityLost") return "identityLost";
  if (!state.enabled) return "disabled";
  return hasMicrosoftAccount ? null : "noMicrosoftAccount";
}

/** Ob Freunde laufen und ihre Listen etwas bedeuten. */
export const friendsActive = (state: FriendsState | undefined): boolean => state?.enabled === true && state.availability === "available";

/** Zahl an der Seitenleiste: offene eingehende Anfragen, Einladungen und Freunde mit Hinweis. */
export function friendsBadgeCount(requests: FriendRequest[], invites: Invite[], friends: Friend[]): number {
  const incoming = requests.filter((request) => request.direction === "incoming").length;
  return incoming + invites.length + friends.filter((friend) => friend.notice !== null).length;
}

/** Freunde, die gerade online sind oder spielen. */
export const onlineCount = (friends: Friend[]): number => friends.filter((friend) => friend.presence !== "offline").length;

/** Der Name, den man selbst vergeben hat, sonst der selbst angegebene des Freundes. */
export const friendName = (friend: Friend): string => friend.alias ?? friend.displayName;

/** Erste Vierergruppe des Fingerabdrucks: unterscheidet gleich benannte Freunde. */
export const fingerprintHead = (fingerprint: string): string => fingerprint.split(" ")[0];

/** Name je Freund; tragen mehrere denselben, steht die erste Gruppe des Fingerabdrucks dabei. */
export function friendLabels(friends: Friend[]): Map<string, string> {
  const uses = new Map<string, number>();
  for (const friend of friends) uses.set(friendName(friend), (uses.get(friendName(friend)) ?? 0) + 1);
  return new Map(
    friends.map((friend) => {
      const name = friendName(friend);
      return [friend.id, uses.get(name)! > 1 ? `${name} · ${fingerprintHead(friend.fingerprint)}` : name];
    }),
  );
}

export type FriendFilter = { query: string; onlineOnly: boolean };

const collator = new Intl.Collator(undefined, { sensitivity: "base" });

/** Alphabetisch nach angezeigtem Namen: die Reihenfolge hängt nicht an der Anwesenheit, die Zeilen springen also nicht, wenn jemand kommt oder geht. */
export function visibleFriends(friends: Friend[], labels: Map<string, string>, { query, onlineOnly }: FriendFilter): Friend[] {
  const needle = query.trim().toLowerCase();
  const matches = (friend: Friend) =>
    [labels.get(friend.id), friend.displayName, friend.alias, friend.mcName].some((text) => text?.toLowerCase().includes(needle));
  return friends
    .filter((friend) => (!onlineOnly || friend.presence !== "offline") && (needle === "" || matches(friend)))
    .sort((a, b) => collator.compare(labels.get(a.id)!, labels.get(b.id)!));
}

/** Die älteste offene Einladung dieses Freundes, falls er eine geschickt hat. */
export const inviteFrom = (invites: Invite[], friend: Friend): Invite | undefined => invites.find((invite) => invite.from === friend.id);

/** Gäste, die ihren Platz behalten: nicht abgelehnt und nicht entfernt (Spezifikation 5.4). */
const holdsSeat = (state: string, kicked: boolean) => state !== "declined" && !(state === "left" && kicked);

/** Ob „Einladen“ passt: ich teile, der Freund ist bestätigt und online und hat noch keinen Platz. */
export function canInvite(friend: Friend, session: HostSession | undefined): boolean {
  if (!session || !friend.confirmed || friend.removedByPeer || friend.presence === "offline") return false;
  const guest = session.guests.find((candidate) => candidate.friendId === friend.id);
  return !guest || !holdsSeat(guest.state, guest.kicked);
}

/** Eine Anfrage, deren Code älter als seine Gültigkeit ist: er ist eventuell abgelaufen (Spezifikation 4.3). */
export function codeMayBeExpired(request: FriendRequest, codeTtlSecs: number, nowSecs: number): boolean {
  return nowSecs - request.createdAt > codeTtlSecs;
}

/** Mehr aktive Codes sind nicht erlaubt; benutzte zählen nicht mehr. */
export const activeCodeCount = (codes: { used: boolean }[]): number => codes.filter((code) => !code.used).length;
