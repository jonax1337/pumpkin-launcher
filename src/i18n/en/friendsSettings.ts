import { friendsSettings as deFriendsSettings } from "../de/friendsSettings.ts";

/** Gleiche Schlüssel wie das deutsche Wörterbuch; tsc erzwingt die Vollständigkeit. */
export const friendsSettings: typeof deFriendsSettings = {
  // Tab and sections
  "friendsSettings.tab": "Friends",
  "friendsSettings.sectionGeneral": "General",
  "friendsSettings.sectionBlocked": "Blocked",
  "friendsSettings.sectionDanger": "Danger zone",

  // Unavailable
  "friendsSettings.noSecretStore": "This system has no keyring (Secret Service), so Friends is not available here.",
  "friendsSettings.identityLostTitle": "Identity lost",
  "friendsSettings.identityLostText": "Your Friends identity is missing from the keyring, for example after a reinstall or a change of user account. Reset it to start over. Your previous friends are deleted in the process.",
  "friendsSettings.loadFailed": "The Friends settings could not be loaded",

  // Switching on and off
  "friendsSettings.enableLabel": "Friends",
  "friendsSettings.enableHint": "Friend codes, online status and playing together",
  "friendsSettings.enableAside": "Off by default. Switching it on shows a dialog about what friends and relay servers can see. Switching it off keeps your friends.",

  // Display name
  "friendsSettings.nameLabel": "Display name",
  "friendsSettings.nameHint": "How your friends see you: {min} to {max} characters",
  "friendsSettings.nameAside": "You choose this name yourself. Friends see it together with your fingerprint.",

  // Always relay
  "friendsSettings.relayLabel": "Always connect through a relay",
  "friendsSettings.relayHint": "Friends do not see your IP addresses. Slightly higher latency.",
  "friendsSettings.relayAside": "The relay operator sees who is connected to whom, but never any content.",
  "friendsSettings.relayConfirmTitle": "Reconnect?",
  "friendsSettings.relayConfirmText": "Switching this makes the launcher reconnect.",
  "friendsSettings.relayConfirmHosting": "The world you are sharing right now will end.",
  "friendsSettings.relayConfirmJoin": "Your connection to {name}'s world will end.",
  "friendsSettings.relayConfirmJoinUnnamed": "Your connection to a shared world will end.",
  "friendsSettings.relayConfirmButton": "Switch",

  // Fingerprint
  "friendsSettings.fingerprintLabel": "My fingerprint",
  "friendsSettings.fingerprintHint": "Tied permanently to your key",
  "friendsSettings.fingerprintAside": "You choose your name yourself, but not your fingerprint. If in doubt, friends can compare it with yours. For a report to the relay operator, copy the full ID.",
  "friendsSettings.copyPeerId": "Copy full ID",
  "friendsSettings.peerIdCopied": "ID copied",

  // Network
  "friendsSettings.networkLabel": "Network",
  "friendsSettings.networkOnline": "Connected through {relayHost}",
  "friendsSettings.networkStarting": "Connecting …",
  "friendsSettings.networkOff": "Not connected",
  "friendsSettings.networkDegraded": "Disconnected: {reason}",
  "friendsSettings.degraded.relayUnreachable": "the relay server is unreachable",
  "friendsSettings.degraded.bindFailed": "the network port could not be opened",

  // Blocked
  "friendsSettings.blockedHint": "Blocked people cannot reach you: no requests, no online status.",
  "friendsSettings.blockedNone": "Nobody is blocked.",
  "friendsSettings.blockedSince": "Blocked on {date}",
  "friendsSettings.unblock": "Unblock",

  // Renewing and resetting the identity
  "friendsSettings.rotateLabel": "Renew identity",
  "friendsSettings.rotateHint": "A new key, your friends stay",
  "friendsSettings.rotateButton": "Renew",
  "friendsSettings.rotateTitle": "Renew identity?",
  "friendsSettings.rotateText": "Your friends receive the new identity automatically as soon as they are online (up to 14 days). Your open friend codes are revoked, and requests still waiting for confirmation are deleted. If a shared world or a join is running, it ends.",
  "friendsSettings.rotated": "Identity renewed",
  "friendsSettings.resetLabel": "Reset identity and delete all friends",
  "friendsSettings.resetHint": "Deletes friends, requests, codes and blocked people, and creates a new identity",
  "friendsSettings.resetButton": "Reset",
  "friendsSettings.resetTitle": "Reset identity?",
  "friendsSettings.resetText": "All friends, requests, codes and blocked people are deleted, and you get a new identity. Your previous friends find out as soon as they are online. This cannot be undone.",
  "friendsSettings.resetDone": "Identity reset",

  // Opt-in
  "friendsSettings.optIn.title": "Turn on Friends",
  "friendsSettings.optIn.codes": "Friends only through codes you exchange yourselves. Whoever has your code can send you a request; that does not show them your IP address.",
  "friendsSettings.optIn.addresses": "Encrypted connections between launchers. On a direct connection your friends see your public IP address and the addresses of your networks (home network, VPN). So does anyone who redeems your code, or whose code you redeem, as long as “Always relay” is off. “Always relay” prevents that.",
  "friendsSettings.optIn.relays": "Relay servers: {relays}. They forward encrypted data and see who is connected to whom, but never any content.",
  "friendsSettings.optIn.presence": "Friends see whether you are online or playing, and your Minecraft name with your skin (as stated by you).",
  "friendsSettings.optIn.noTracking": "No chat, no tracking, no public lists. You can turn it off at any time.",
  "friendsSettings.optIn.nameLabel": "Display name",
  "friendsSettings.optIn.alwaysRelay": "Always connect through a relay",
  "friendsSettings.optIn.thirdParty": "I agree that {operator} ({hosts}) is used as a relay",
  "friendsSettings.optIn.understood": "Understood",
  "friendsSettings.optIn.firewall": "Windows may ask for a firewall permission (UDP). Allowing it on private networks makes direct connections work better.",
  "friendsSettings.optIn.confirm": "Turn on Friends",
  "friendsSettings.optIn.pending": "Turning on",

  // Relay operators
  "friendsSettings.operator.pumpkin": "Pumpkin Launcher",
  "friendsSettings.operator.n0": "n0",

  // Privacy notice (About)
  "friendsSettings.privacy.relayName": "Friends relay: {operator}",
  "friendsSettings.privacy.relay": "Friends: encrypted forwarding, no content. Only if you turn Friends on.",
  "friendsSettings.privacy.sessionserverName": "Mojang (Friends)",
  "friendsSettings.privacy.sessionserver": "Your friends’ skins: the launcher fetches them by player UUID from the session server and stores them locally. The interface itself never contacts Mojang. Only if you turn Friends on.",

  // Settings > Java & Start
  "friendsSettings.onPlayAside": "With Friends turned on, the launcher is only minimized.",
};
