package dev.laux.pumpkin.friends.ui.hub;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.laux.pumpkin.friends.protocol.ErrorCode;
import dev.laux.pumpkin.friends.protocol.OpError;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The inline line of a failed {@code friend.addByName} (INGAME 6.2): the five own texts, the hints, the numbers, and the
 * generic fallback — the shapes the launcher produces are the golden lines of {@code errors-reasons.jsonl}.
 */
class AddFriendFailureTest {
	private static final String NAME = "Notch";

	private static AddFriendFailure of(ErrorCode code, String reason, Map<String, String> params) {
		Map<String, String> all = new HashMap<>(params);
		if (!reason.isEmpty()) {
			all.put("reason", reason);
		}
		return AddFriendFailure.of(new OpError(code, all), NAME);
	}

	@Test
	void anUnknownNameIsAnErrorNamingTheTypedName() {
		AddFriendFailure failure = of(ErrorCode.NAME_UNKNOWN, "", Map.of());

		assertEquals("pumpkin_friends.add.error.nameUnknown", failure.key());
		assertEquals(List.of(NAME), failure.arguments());
		assertFalse(failure.hint());
	}

	@Test
	void aNameThatIsNotFindableIsAHintNotAnError() {
		AddFriendFailure failure = of(ErrorCode.NAME_UNKNOWN, "nameNotFindable", Map.of());

		assertEquals("pumpkin_friends.add.error.nameNotFindable", failure.key());
		assertEquals(List.of(NAME), failure.arguments());
		assertTrue(failure.hint());
	}

	@Test
	void anUnreachableDirectoryNamesNoReasonButNotAllowedDoes() {
		assertEquals("pumpkin_friends.add.error.directoryUnavailable", of(ErrorCode.DIRECTORY_UNAVAILABLE, "", Map.of()).key());
		assertEquals("pumpkin_friends.add.error.directoryNotAllowed",
			of(ErrorCode.DIRECTORY_UNAVAILABLE, "directoryNotAllowed", Map.of()).key());
	}

	@Test
	void aNameCooldownCarriesItsDaysAndRateLimitingDoesNot() {
		AddFriendFailure cooldown = of(ErrorCode.RATE_LIMITED, "nameCooldown", Map.of("days", "7"));
		AddFriendFailure rateLimited = of(ErrorCode.RATE_LIMITED, "", Map.of());

		assertEquals("pumpkin_friends.add.error.nameCooldown", cooldown.key());
		assertEquals(List.of(NAME, "7"), cooldown.arguments());
		assertEquals("pumpkin_friends.error.rateLimited", rateLimited.key(), "the plain rate limit keeps the shared text");
	}

	@Test
	void aMissingDaysNumberFallsBackToTheKnownCooldown() {
		AddFriendFailure failure = of(ErrorCode.RATE_LIMITED, "nameCooldown", Map.of());

		assertEquals(List.of(NAME, "7"), failure.arguments());
	}

	@Test
	void anInvalidNameShapeIsCaughtBeforeSendingButStillMaps() {
		assertEquals("pumpkin_friends.add.error.nameInvalid", of(ErrorCode.BAD_REQUEST, "nameInvalid", Map.of()).key());
	}

	@Test
	void everythingElseKeepsTheGenericTextOfItsCode() {
		assertEquals("pumpkin_friends.error.busy", of(ErrorCode.BUSY, "", Map.of()).key());
		assertEquals("pumpkin_friends.error.timeout", of(ErrorCode.TIMEOUT, "", Map.of()).key());
		assertEquals("pumpkin_friends.error.disconnected", of(ErrorCode.DISCONNECTED, "", Map.of()).key());
	}

	@Test
	void anUnknownCodeReadsLikeAnInternalOne() {
		AddFriendFailure failure = of(ErrorCode.UNRECOGNIZED, "", Map.of());

		assertEquals("pumpkin_friends.error.internal", failure.key());
		assertEquals(List.of(), failure.arguments());
	}
}
