package dev.laux.pumpkin.bridge.protocol;

/** The state topics the launcher pushes as whole values (docs/bridge/README.md, "Protocol 2"). */
public enum Topic {
	ME,
	FRIENDS,
	REQUESTS,
	INVITES,
	SESSION,
	JOIN,
	GAME,
	CODES,
	BLOCKED
}
