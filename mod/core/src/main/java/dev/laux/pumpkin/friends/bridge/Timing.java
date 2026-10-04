package dev.laux.pumpkin.friends.bridge;

import dev.laux.pumpkin.friends.protocol.Limits;
import java.time.Duration;

/** The times of the link; tests shorten them and replace the {@link Sleeper} that waits between connection attempts. */
public record Timing(Duration connectTimeout, Duration pingInterval, Duration silence, Duration writeStall,
		Duration housekeepingPeriod, Duration rejectedRetry, Sleeper sleeper) {
	public static Timing production() {
		return new Timing(Duration.ofSeconds(2), Limits.PING_INTERVAL, Limits.SILENCE, Limits.WRITE_STALL,
			Duration.ofMillis(250), Duration.ofSeconds(60), pause -> Thread.sleep(pause.toMillis()));
	}

	@FunctionalInterface
	public interface Sleeper {
		void sleep(Duration duration) throws InterruptedException;
	}
}
