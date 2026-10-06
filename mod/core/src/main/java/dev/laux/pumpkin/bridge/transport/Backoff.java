package dev.laux.pumpkin.bridge.transport;

import dev.laux.pumpkin.bridge.runtime.Immutable;

import java.time.Duration;
import java.util.List;

/** Wartezeiten zwischen Verbindungsversuchen zum Launcher: 1, 2, 5, 10, danach immer 30 Sekunden (SPEC 7.5). */
public final class Backoff {
	private static final List<Duration> STEPS = Immutable.list(
		Duration.ofSeconds(1), Duration.ofSeconds(2), Duration.ofSeconds(5), Duration.ofSeconds(10),
		Duration.ofSeconds(30));

	private int attempt;

	public Duration next() {
		Duration delay = STEPS.get(attempt);
		attempt = Math.min(attempt + 1, STEPS.size() - 1);
		return delay;
	}

	public void reset() {
		attempt = 0;
	}
}
