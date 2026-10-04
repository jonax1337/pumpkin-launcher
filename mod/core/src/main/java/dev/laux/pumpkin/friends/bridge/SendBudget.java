package dev.laux.pumpkin.friends.bridge;

import java.util.ArrayDeque;
import java.util.Deque;

/**
 * Keeps the mod under the launcher's message limit (INGAME 5.3: 20 per second, more closes the link). Each message gets
 * a send time; the {@code max + 1}-th message after a given one is never earlier than {@code window} later. The window
 * is a little longer than the launcher's second, so scheduling jitter on either side cannot squeeze 21 into one of its seconds.
 */
final class SendBudget {
	private final int max;
	private final long windowNanos;
	private final Deque<Long> sendTimes = new ArrayDeque<>();

	SendBudget(int max, long windowNanos) {
		this.max = max;
		this.windowNanos = windowNanos;
	}

	/** Books a message and returns how long to wait before sending it. */
	long reserve(long nowNanos) {
		long sendAt = nowNanos;
		if (sendTimes.size() == max) {
			sendAt = Math.max(nowNanos, sendTimes.pollFirst() + windowNanos);
		}
		sendTimes.addLast(sendAt);
		return sendAt - nowNanos;
	}
}
