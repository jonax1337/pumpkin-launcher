package dev.laux.pumpkin.friends.protocol;

import static dev.laux.pumpkin.friends.Fixtures.Direction.LAUNCHER_TO_MOD;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.laux.pumpkin.friends.Fixtures;
import dev.laux.pumpkin.friends.Fixtures.Line;
import dev.laux.pumpkin.friends.protocol.LauncherFrame.Response;
import java.util.Map;
import java.util.OptionalInt;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/**
 * errors-reasons.jsonl and the answer of ops-join-failed.jsonl: the errors whose code is coarse or carries numbers, read
 * through the error object the UI uses. The friend notices of topics-notice.jsonl are read by {@code TopicFixturesTest}.
 */
class LauncherSideFixturesTest {
	private final Map<String, OpError> byId = Fixtures.read("errors-reasons.jsonl", LAUNCHER_TO_MOD).stream()
		.collect(Collectors.toMap(Line::id, LauncherSideFixturesTest::error));

	@Test
	void aCoarseErrorNamesItsCauseAsTheReason() {
		assertEquals(ErrorCode.BAD_REQUEST, byId.get("r01").code());
		assertEquals("nameInvalid", byId.get("r01").reason().orElseThrow());
		assertEquals(ErrorCode.NOT_FOUND, byId.get("r07").code());
		assertEquals("notRenamed", byId.get("r07").reason().orElseThrow());
		assertEquals(ErrorCode.NAME_UNKNOWN, byId.get("r08").code());
		assertEquals("nameNotFindable", byId.get("r08").reason().orElseThrow());
	}

	@Test
	void numbersArriveAsNumbersOnDemand() {
		assertEquals(OptionalInt.of(3), byId.get("r04").intParam("max"));
		assertEquals(OptionalInt.of(7), byId.get("r06").intParam("days"));
		assertEquals(OptionalInt.empty(), byId.get("r04").intParam("days"), "absent");
		assertEquals(OptionalInt.empty(), byId.get("r01").intParam("reason"), "not a number");
	}

	@Test
	void aRunningGameThatDoesNotFitGetsInstanceMismatchWithThePlanVerdictAndTheCounts() {
		OpError mismatch = byId.get("r02");

		assertEquals(ErrorCode.INSTANCE_MISMATCH, mismatch.code());
		assertEquals("missingContent", mismatch.param("verdict").orElseThrow());
		assertEquals(OptionalInt.of(0), mismatch.intParam("missing"));
		assertEquals(OptionalInt.of(1), mismatch.intParam("extra"));
		assertTrue(mismatch.reason().isEmpty(), "the code is no longer coarse");
	}

	@Test
	void everyReasonFixtureIsAKnownCode() {
		assertTrue(byId.values().stream().noneMatch(error -> error.code() == ErrorCode.UNRECOGNIZED));
	}

	@Test
	void theAnswerToJoinFailedIsAnEmptyResult() {
		Response response = (Response) FrameCodec.decode(Fixtures.only("ops-join-failed.jsonl", LAUNCHER_TO_MOD).wire()).orElseThrow();

		assertTrue(response.error().isEmpty());
		assertTrue(response.result().isPresent());
	}

	private static OpError error(Line line) {
		return ((Response) FrameCodec.decode(line.wire()).orElseThrow()).error().orElseThrow();
	}
}
