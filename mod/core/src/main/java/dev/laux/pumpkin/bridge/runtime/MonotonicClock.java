package dev.laux.pumpkin.bridge.runtime;

/** Time that only moves forward; tests replace it to make timeouts instant. */
@FunctionalInterface
public interface MonotonicClock {
	MonotonicClock SYSTEM = System::nanoTime;

	long nanos();
}
