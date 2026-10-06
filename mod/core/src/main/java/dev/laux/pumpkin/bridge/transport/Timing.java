package dev.laux.pumpkin.bridge.transport;

import java.util.Objects;

import dev.laux.pumpkin.bridge.protocol.Limits;
import java.time.Duration;

/** The times of the link; tests shorten them and replace the {@link Sleeper} that waits between connection attempts. */
public final class Timing {
	private final Duration connectTimeout;
	private final Duration pingInterval;
	private final Duration silence;
	private final Duration writeStall;
	private final Duration housekeepingPeriod;
	private final Duration rejectedRetry;
	private final Sleeper sleeper;

	public Timing(Duration connectTimeout, Duration pingInterval, Duration silence, Duration writeStall, Duration housekeepingPeriod, Duration rejectedRetry, Sleeper sleeper) {
		this.connectTimeout = connectTimeout;
		this.pingInterval = pingInterval;
		this.silence = silence;
		this.writeStall = writeStall;
		this.housekeepingPeriod = housekeepingPeriod;
		this.rejectedRetry = rejectedRetry;
		this.sleeper = sleeper;
	}

	public Duration connectTimeout() {
		return connectTimeout;
	}

	public Duration pingInterval() {
		return pingInterval;
	}

	public Duration silence() {
		return silence;
	}

	public Duration writeStall() {
		return writeStall;
	}

	public Duration housekeepingPeriod() {
		return housekeepingPeriod;
	}

	public Duration rejectedRetry() {
		return rejectedRetry;
	}

	public Sleeper sleeper() {
		return sleeper;
	}

	@Override
	public boolean equals(Object other) {
		if (this == other) {
			return true;
		}
		if (!(other instanceof Timing)) {
			return false;
		}
		Timing that = (Timing) other;
		return Objects.equals(connectTimeout, that.connectTimeout)
			&& Objects.equals(pingInterval, that.pingInterval)
			&& Objects.equals(silence, that.silence)
			&& Objects.equals(writeStall, that.writeStall)
			&& Objects.equals(housekeepingPeriod, that.housekeepingPeriod)
			&& Objects.equals(rejectedRetry, that.rejectedRetry)
			&& Objects.equals(sleeper, that.sleeper);
	}

	@Override
	public int hashCode() {
		int hash = Objects.hashCode(connectTimeout);
		hash = 31 * hash + Objects.hashCode(pingInterval);
		hash = 31 * hash + Objects.hashCode(silence);
		hash = 31 * hash + Objects.hashCode(writeStall);
		hash = 31 * hash + Objects.hashCode(housekeepingPeriod);
		hash = 31 * hash + Objects.hashCode(rejectedRetry);
		hash = 31 * hash + Objects.hashCode(sleeper);
		return hash;
	}

	@Override
	public String toString() {
		return "Timing[connectTimeout=" + connectTimeout + ", pingInterval=" + pingInterval + ", silence=" + silence + ", writeStall=" + writeStall + ", housekeepingPeriod=" + housekeepingPeriod + ", rejectedRetry=" + rejectedRetry + ", sleeper=" + sleeper + "]";
	}

	public static Timing production() {
		return new Timing(Duration.ofSeconds(2), Limits.PING_INTERVAL, Limits.SILENCE, Limits.WRITE_STALL,
			Duration.ofMillis(250), Duration.ofSeconds(60), pause -> Thread.sleep(pause.toMillis()));
	}

	@FunctionalInterface
	public interface Sleeper {
		void sleep(Duration duration) throws InterruptedException;
	}
}
