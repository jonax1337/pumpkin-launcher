package dev.laux.pumpkin.friends.protocol;

import static dev.laux.pumpkin.friends.Fixtures.Direction.NONE;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import dev.laux.pumpkin.friends.Fixtures;
import java.time.Duration;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/** limits.jsonl: the numbers of INGAME 5.3 that concern the mod are the numbers in {@link Limits}. */
class LimitsFixtureTest {
	private static final JsonObject LIMITS = Fixtures.only("limits.jsonl", NONE).message();

	@Test
	void lineLengthsMatch() {
		assertEquals(Limits.PRE_WELCOME_LINE_BYTES, number("preWelcomeLineBytes"));
		assertEquals(Limits.MOD_LINE_BYTES, number("modLineBytes"));
		assertEquals(Limits.LAUNCHER_LINE_BYTES, number("launcherLineBytes"));
	}

	@Test
	void sendBudgetAndQueuesMatch() {
		assertEquals(Limits.MESSAGES_PER_SECOND, number("messagesPerSecond"));
		assertEquals(Duration.ofSeconds(1), Limits.MESSAGE_WINDOW);
		assertEquals(Limits.MAX_IN_FLIGHT, number("maxInFlight"));
		assertEquals(Limits.OUTGOING_QUEUE, number("outgoingQueue"));
	}

	@Test
	void timesMatch() {
		assertEquals(Limits.WRITE_STALL, millis("writeStallMs"));
		assertEquals(Limits.PING_INTERVAL, millis("pingIntervalMs"));
		assertEquals(Limits.SILENCE, millis("silenceMs"));
	}

	@Test
	void theModWaitsLongerAfterPendingThanTheLauncherDoesForADialog() {
		assertTrue(Limits.TIMEOUT_AFTER_PENDING.compareTo(millis("requestDeadlineMs")) > 0);
		assertEquals(Duration.ofSeconds(130), Limits.TIMEOUT_AFTER_PENDING);
		assertEquals(Duration.ofSeconds(15), Limits.REQUEST_TIMEOUT);
		assertEquals(Duration.ofSeconds(30), Limits.SLOW_REQUEST_TIMEOUT);
	}

	@Test
	void requestIdsFollowThePatternOfTheFixture() {
		Pattern pattern = Pattern.compile(LIMITS.get("requestIdPattern").getAsString());

		for (String id : new String[] {"a", "a1", "abcdefghij12", "0", "", "A1", "a-1", "abcdefghij123", "ä", "a b"}) {
			assertEquals(pattern.matcher(id).matches(), Protocol.isValidRequestId(id), "'" + id + "'");
		}
		assertFalse(Protocol.isValidRequestId("a\n"));
	}

	private static int number(String key) {
		return LIMITS.get(key).getAsInt();
	}

	private static Duration millis(String key) {
		return Duration.ofMillis(LIMITS.get(key).getAsLong());
	}
}
