// Reine Logik der Freunde-Seite (kein React), damit friendsModel.check.mjs sie ohne Bundler prüft.
import { FRIENDS_LIMITS } from "../../lib/friends-types.ts";
import type { DirectoryState, Friend, FriendRequest, FriendsState, HostSession, Invite, ModOpenTarget } from "../../lib/friends-types.ts";

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
export const holdsSeat = (state: string, kicked: boolean) => state !== "declined" && !(state === "left" && kicked);

/** Ob „Einladen“ passt: ich teile, der Freund ist bestätigt und online und hat noch keinen Platz. */
export function canInvite(friend: Friend, session: Pick<HostSession, "guests"> | undefined): boolean {
  if (!session || !friend.confirmed || friend.removedByPeer || friend.presence === "offline") return false;
  const guest = session.guests.find((candidate) => candidate.friendId === friend.id);
  return !guest || !holdsSeat(guest.state, guest.kicked);
}

/** Eine Anfrage per Code, die älter als die Gültigkeit ihres Codes ist: er ist eventuell abgelaufen (Spezifikation 4.3). Eine per Name hat keinen Code, der ablaufen könnte. */
export function codeMayBeExpired(request: FriendRequest, codeTtlSecs: number, nowSecs: number): boolean {
  return request.via === "code" && nowSecs - request.createdAt > codeTtlSecs;
}

/** Übersetzungsschlüssel des Stands einer eigenen Anfrage; je Herkunft (Code oder Name) ein eigener Text. */
export type RequestLineKey =
  | "friends.requests.awaiting"
  | "friends.requests.awaitingName"
  | "friends.requests.delivering"
  | "friends.requests.deliveringName";

/** Der Stand einer eigenen Anfrage als Schlüssel mit dem Namen für seinen Platzhalter (Minecraft-Name, sonst Anzeigename). */
export function requestLine(request: FriendRequest): { key: RequestLineKey; params: { name: string } } {
  const params = { name: request.mcName ?? request.displayName ?? "?" };
  const byName = request.via === "name";
  if (request.state === "delivering") return { key: byName ? "friends.requests.deliveringName" : "friends.requests.delivering", params };
  return { key: byName ? "friends.requests.awaitingName" : "friends.requests.awaiting", params };
}

const SECONDS_PER_DAY = 86_400;

/** So lange hält das Verzeichnis eine Anfrage per Name bereit. */
export const REQUEST_TTL_DAYS = FRIENDS_LIMITS.requestTtlSecs / SECONDS_PER_DAY;

const MC_NAME_PATTERN =new RegExp("^[A-Za-z0-9_]{1," + FRIENDS_LIMITS.mcNameMax + "}$");

/** Ob der Text die Form eines Minecraft-Namens hat; ob es den Spieler gibt, sagt Mojang beim Senden. */
export const isMcName = (name: string): boolean => MC_NAME_PATTERN.test(name.trim());

/** Die Wege zum Hinzufügen: per Minecraft-Namen, mit dem Code eines Freundes oder den eigenen Code weitergeben. */
export type AddFriendTab = "name" | "enter" | "mine";

/** Ohne Verzeichnis gibt es keinen Weg per Namen. */
export const nameTabAvailable = (directory: DirectoryState): boolean => directory !== "unavailable";

/** Der Reiter, auf dem „Freund hinzufügen“ öffnet. */
export const defaultAddTab = (directory: DirectoryState): AddFriendTab => (nameTabAvailable(directory) ? "name" : "enter");

/** Der Anker des Abschnitts „Anfragen“ auf der Freunde-Seite. */
export const REQUESTS_ANCHOR = "friends-requests";

/**
 * Wohin `launcher.open` der Mod führt (INGAME 5.4): auf die Freunde-Seite, dort zu den Anfragen oder zum Dialog der ältesten
 * Einladung, oder zu den Einstellungen der Freunde.
 */
export type ModOpenDestination =
  | { page: "friends"; anchor: typeof REQUESTS_ANCHOR | null; showInvite: boolean }
  | { page: "settings" };

export function modOpenDestination(target: ModOpenTarget): ModOpenDestination {
  switch (target) {
    case "friends":
      return { page: "friends", anchor: null, showInvite: false };
    case "requests":
      return { page: "friends", anchor: REQUESTS_ANCHOR, showInvite: false };
    case "invites":
      return { page: "friends", anchor: null, showInvite: true };
    case "settings":
      return { page: "settings" };
  }
}

/** Mehr aktive Codes sind nicht erlaubt; benutzte zählen nicht mehr. */
export const activeCodeCount = (codes: { used: boolean }[]): number => codes.filter((code) => !code.used).length;
