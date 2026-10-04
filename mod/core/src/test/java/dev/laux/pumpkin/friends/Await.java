package dev.laux.pumpkin.friends;

import static org.junit.jupiter.api.Assertions.fail;

import java.time.Duration;
import java.util.concurrent.locks.LockSupport;
import java.util.function.BooleanSupplier;

/** Waits for something that happens on another thread. */
public final class Await {
	private static final Duration LIMIT = Duration.ofSeconds(5);
	private static final Duration POLL_INTERVAL = Duration.ofMillis(5);

	private Await() {
	}

	public static void until(String what, BooleanSupplier condition) {
		long deadline = System.nanoTime() + LIMIT.toNanos();
		while (!condition.getAsBoolean()) {
			if (System.nanoTime() > deadline) {
				fail("Not within " + LIMIT + ": " + what);
			}
			LockSupport.parkNanos(POLL_INTERVAL.toNanos());
		}
	}
}
