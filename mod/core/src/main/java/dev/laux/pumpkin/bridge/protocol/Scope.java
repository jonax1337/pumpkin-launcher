package dev.laux.pumpkin.bridge.protocol;

/** What the player is asked about once per game launch in the launcher (docs/bridge/README.md, "Operations and consent"). */
public enum Scope {
	/** Share the world with chosen friends. */
	SHARE,
	/** Add friends, answer requests, accept invites, change the friends list. */
	SOCIAL
}
