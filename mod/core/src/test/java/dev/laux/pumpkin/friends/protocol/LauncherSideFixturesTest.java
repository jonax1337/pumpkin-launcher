package dev.laux.pumpkin.friends.protocol;

import static dev.laux.pumpkin.friends.Fixtures.Direction.LAUNCHER_TO_MOD;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.laux.pumpkin.friends.Fixtures;
import dev.laux.pumpkin.friends.Fixtures.Line;
import dev.laux.pumpkin.friends.protocol.LauncherFrame.Response;
import dev.laux.pumpkin.friends.protocol.LauncherFrame.State;
import dev.laux.pumpkin.friends.state.Friend;
import dev.laux.pumpkin.friends.state.TopicStore;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/**
 * The fixtures the launcher side added after the mod reader was written: errors-reasons.jsonl, topics-notice.jsonl and the
 * answer of ops-join-failed.jsonl. The mod reads what it already understands of them (the code, the parameters as text, the
 * friends of the push and the empty result); it does not act on the {@code reason}, the friend {@code notice} or the
 * {@code join.failed} operation yet.
 */
class LauncherSideFixturesTest {
	@Test
	void everyCoarseErrorKeepsItsCodeAndItsReasonAsText() {
		Map<String, OpError> byId = Fixtures.read("errors-reasons.jsonl", LAUNCHER_TO_MOD).stream()
			.collect(Collectors.toMap(Line::id, LauncherSideFixturesTest::error));

		assertEquals(ErrorCode.BAD_REQUEST, byId.get("r01").code());
		assertEquals("nameInvalid", byId.get("r01").param("reason").orElseThrow());
		assertEquals("1", byId.get("r02").param("extra").orElseThrow());
		assertEquals("3", byId.get("r04").param("max").orElseThrow());
		assertEquals("7", byId.get("r06").param("days").orElseThrow());
		assertEquals(ErrorCode.NAME_UNKNOWN, byId.get("r08").code());
		assertTrue(byId.values().stream().noneMatch(error -> error.code() == ErrorCode.UNRECOGNIZED));
	}

	@Test
	void aFriendWithANoticeIsStillAFriendOfTheTopic() {
		TopicStore store = new TopicStore();
		State push = (State) FrameCodec.decode(Fixtures.only("topics-notice.jsonl", LAUNCHER_TO_MOD).wire()).orElseThrow();

		assertTrue(store.apply(push));

		assertEquals(List.of("Alex", "Bea", "Cleo"), store.friends().stream().map(Friend::name).toList());
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
