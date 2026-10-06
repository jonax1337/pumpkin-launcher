package dev.laux.pumpkin.bridge;

import static org.junit.jupiter.api.Assertions.assertEquals;

import dev.laux.pumpkin.bridge.transport.Backoff;
import java.time.Duration;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

class BackoffTest {
	@Test
	void waitsOneTwoFiveTenThenThirtySeconds() {
		Backoff backoff = new Backoff();

		List<Duration> delays = Stream.generate(backoff::next).limit(7).toList();

		assertEquals(Stream.of(1, 2, 5, 10, 30, 30, 30).map(Duration::ofSeconds).toList(), delays);
	}

	@Test
	void resetStartsAgainAtOneSecond() {
		Backoff backoff = new Backoff();
		backoff.next();
		backoff.next();

		backoff.reset();

		assertEquals(Duration.ofSeconds(1), backoff.next());
	}
}
