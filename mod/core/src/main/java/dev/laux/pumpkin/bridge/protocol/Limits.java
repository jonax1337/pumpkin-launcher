package dev.laux.pumpkin.bridge.protocol;

import java.time.Duration;

/** The numbers of docs/friends/INGAME.md, 5.3; {@code mod/fixtures/protocol/limits.jsonl} holds the same values for the launcher side. */
public final class Limits {
	/** The longest line the launcher accepts before it has sent {@code welcome}; the {@code hello} must fit. */
	public static final int PRE_WELCOME_LINE_BYTES = 1024;
	/** The longest line, line ending included, that the mod may send after {@code welcome}. */
	public static final int MOD_LINE_BYTES = 16 * 1024;
	/** The longest line, line ending included, that the launcher sends. */
	public static final int LAUNCHER_LINE_BYTES = 64 * 1024;
	public static final int MESSAGES_PER_SECOND = 20;
	public static final Duration MESSAGE_WINDOW = Duration.ofSeconds(1);
	public static final int MAX_IN_FLIGHT = 8;
	public static final int OUTGOING_QUEUE = 64;
	public static final Duration WRITE_STALL = Duration.ofSeconds(5);
	public static final Duration PING_INTERVAL = Duration.ofSeconds(10);
	public static final Duration SILENCE = Duration.ofSeconds(30);

	public static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(15);
	public static final Duration SLOW_REQUEST_TIMEOUT = Duration.ofSeconds(30);
	/** The launcher waits up to 125 s for an operation that shows a dialog; the mod waits a little longer after {@code pending}. */
	public static final Duration TIMEOUT_AFTER_PENDING = Duration.ofSeconds(130);

	private Limits() {
	}
}
