package dev.laux.pumpkin.bridge.protocol;

/** Why the launcher refused the {@code hello}. */
public enum RejectReason {
	TOKEN,
	PROTOCOL,
	OWNER,
	BUILD,
	DUPLICATE,
	/** The launcher does not know the game process yet; trying again shortly works. */
	RETRY;

	public boolean isTerminal() {
		return this != RETRY;
	}
}
