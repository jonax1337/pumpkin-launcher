import { friendsInvite as deFriendsInvite } from "../de/friendsInvite.ts";

/** Gleiche Schlüssel wie das deutsche Wörterbuch; tsc erzwingt die Vollständigkeit. */
export const friendsInvite: typeof deFriendsInvite = {
  // ---------- Notifications ----------
  "friendsInvite.toast": "{name} invites you: {title}",
  "friendsInvite.view": "View",
  "friendsInvite.revoked": "{name} stopped sharing",
  "friendsInvite.ended": "Joining ended: {reason}",
  "friendsInvite.end.stopped": "The host stopped sharing.",
  "friendsInvite.end.kicked": "The host removed you from the world.",
  "friendsInvite.end.lanClosed": "The host closed the world to LAN.",
  "friendsInvite.end.hostOffline": "The host went offline.",
  "friendsInvite.end.gameExited": "Minecraft was closed.",
  "friendsInvite.end.left": "You left the world.",
  "friendsInvite.end.disabled": "Friends was turned off.",
  "friendsInvite.end.error": "The connection to the world failed.",

  // ---------- Invite dialog ----------
  "friendsInvite.title": "Invitation",
  "friendsInvite.invites": "invites you to “{title}”",
  "friendsInvite.mods.one": "1 mod",
  "friendsInvite.mods.other": "{n} mods",
  "friendsInvite.hostOffline": "The host is offline right now.",
  "friendsInvite.planFailed": "Checking your instances failed",
  "friendsInvite.offlineAccount": "Joining needs a Microsoft account, but this instance starts without one. Pick a Microsoft account in the instance settings or at the top.",
  "friendsInvite.lookupFailed": "Modrinth is unreachable; client-only mods are counted",
  "friendsInvite.unsupported.title": "Only from Minecraft {min}",
  "friendsInvite.unsupported.body": "This world runs on Minecraft {version}. Joining works from Minecraft {min} on.",

  // Matching instance
  "friendsInvite.instance.single": "Matching instance: {name}",
  "friendsInvite.instance.label": "Instance",
  "friendsInvite.instance.pick": "Choose instance",

  // Instance does not match
  "friendsInvite.missing.title": "Your instance {name} doesn't match",
  "friendsInvite.missing.body": "It doesn't have the same mods as the world.",
  "friendsInvite.missing.listMissing": "Missing",
  "friendsInvite.missing.listExtra": "Extra on your side",
  "friendsInvite.missing.hint": "Add the missing mods or remove the extra ones, then check again.",
  "friendsInvite.missing.recheck": "Check again",

  // No instance
  "friendsInvite.none": "You have no instance with Minecraft {version} and {loader}.",
  "friendsInvite.createVanilla": "Create vanilla instance",
  "friendsInvite.creating": "Creating …",

  // Actions
  "friendsInvite.join": "Join",
  "friendsInvite.decline": "Decline",
  "friendsInvite.later": "Later",

  // ---------- Mod request ----------
  "friendsInvite.mod.title": "Request from the game",
  "friendsInvite.mod.scope.share": "This game wants to share your world with selected friends.",
  "friendsInvite.mod.scope.social": "This game wants to add friends, answer requests and accept invites.",
  "friendsInvite.mod.game": "Game",
  "friendsInvite.mod.operation": "Action",
  "friendsInvite.mod.allow": "Allow (until the game ends)",
  "friendsInvite.mod.deny": "Decline",
  "friendsInvite.mod.wait": "Allow unlocks in a moment so that no click agrees by accident.",
};
