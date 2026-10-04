package dev.laux.pumpkin.friends.protocol;

/** Why the launcher is about to close the link. */
public enum ClosingReason {
	/** The game has ended. */
	LAUNCH_ENDED,
	BRIDGE_STOPPED,
	/** A new start of the instance replaced this launch's token. */
	REPLACED;

	/** Whether coming back is pointless: the token of this game will never be accepted again. */
	public boolean isFinal() {
		return this != BRIDGE_STOPPED;
	}
}
