package dev.laux.pumpkin.bridge;

import dev.laux.pumpkin.bridge.runtime.MonotonicClock;
import java.time.Duration;

/** A clock that moves only when the test advances it. */
public final class FakeClock implements MonotonicClock {
	private long nanos;

	@Override
	public long nanos() {
		return nanos;
	}

	public void advance(Duration time) {
		nanos += time.toNanos();
	}
}
