package dev.laux.pumpkin.friends.bridge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.laux.pumpkin.friends.protocol.Limits;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

class SendBudgetTest {
	private static final long WINDOW = TimeUnit.SECONDS.toNanos(1);

	private final SendBudget budget = new SendBudget(Limits.MESSAGES_PER_SECOND, WINDOW);

	@Test
	void theFirstTwentyMessagesGoAtOnce() {
		for (int count = 0; count < Limits.MESSAGES_PER_SECOND; count++) {
			assertEquals(0, budget.reserve(0), "message " + count);
		}
	}

	@Test
	void theTwentyFirstWaitsUntilTheFirstIsAWindowOld() {
		bookTwentyAt(0);

		assertEquals(WINDOW, budget.reserve(0));
	}

	@Test
	void aMessageThatArrivesLaterWaitsOnlyForTheRest() {
		bookTwentyAt(0);

		assertEquals(WINDOW - TimeUnit.MILLISECONDS.toNanos(300), budget.reserve(TimeUnit.MILLISECONDS.toNanos(300)));
	}

	@Test
	void afterAQuietWindowTheBudgetIsFullAgain() {
		bookTwentyAt(0);

		assertEquals(0, budget.reserve(WINDOW));
	}

	@Test
	void noWindowOfTheSendTimesHoldsMoreThanTwentyMessages() {
		List<Long> sendTimes = new ArrayList<>();
		long now = 0;
		for (int count = 0; count < 200; count++) {
			// A burst of 3 messages every 40 ms is 75 per second offered.
			now += (count % 3 == 0) ? TimeUnit.MILLISECONDS.toNanos(40) : 0;
			sendTimes.add(now + budget.reserve(now));
		}

		for (int first = 0; first + Limits.MESSAGES_PER_SECOND < sendTimes.size(); first++) {
			long span = sendTimes.get(first + Limits.MESSAGES_PER_SECOND) - sendTimes.get(first);
			assertTrue(span >= WINDOW, "21 messages within " + Duration.ofNanos(span) + " from message " + first);
		}
	}

	private void bookTwentyAt(long now) {
		for (int count = 0; count < Limits.MESSAGES_PER_SECOND; count++) {
			budget.reserve(now);
		}
	}
}
