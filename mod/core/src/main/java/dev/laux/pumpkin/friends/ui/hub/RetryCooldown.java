package dev.laux.pumpkin.friends.ui.hub;

/**
 * The pause between two "Jetzt zustellen" presses of the Anfragen tab. The requests topic carries no cooldown field, so
 * the mod keeps this local clock: the launcher's {@code friends_retry_now} re-selects an attempt only once it is older
 * than ten seconds, and a faster press would buy nothing while still counting against the op's rate limit.
 */
public final class RetryCooldown {
	public static final long COOLDOWN_MILLIS = 10_000;

	private long lastSentMillis = Long.MIN_VALUE;

	public boolean canSend(long nowMillis) {
		return remainingMillis(nowMillis) == 0;
	}

	public void markSent(long nowMillis) {
		lastSentMillis = nowMillis;
	}

	/** The time until the next press is worth sending; zero when it is. */
	public long remainingMillis(long nowMillis) {
		return Math.max(0, lastSentMillis + COOLDOWN_MILLIS - nowMillis);
	}
}
