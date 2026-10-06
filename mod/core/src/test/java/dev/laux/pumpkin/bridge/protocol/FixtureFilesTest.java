package dev.laux.pumpkin.bridge.protocol;

import static org.junit.jupiter.api.Assertions.assertEquals;

import dev.laux.pumpkin.bridge.Fixtures;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Guards the guard: a fixture file that is added without a test reading it fails here. Which test reads which file:
 * handshake-ok and reject-* by {@link HandshakeFixturesTest}; ops, request-response and pending by
 * {@code OpsFixturesTest} and {@code RequestManagerTest}; errors by {@link ErrorFixturesTest}; events by
 * {@link EventFixturesTest}; hints by {@link HintsFixturesTest}; limits by {@link LimitsFixtureTest}; topics by
 * {@code TopicFixturesTest}; topics-me-directory and topics-notice by {@code TopicFixturesTest} as well; errors-reasons by
 * {@link LauncherSideFixturesTest}; ops-join-failed by {@code OpsFixturesTest} (its request) and {@link LauncherSideFixturesTest}
 * (its answer).
 */
class FixtureFilesTest {
	@Test
	void theFixtureDirectoryHoldsExactlyTheFilesTheTestsKnow() {
		List<String> known = List.of("errors-reasons.jsonl", "errors.jsonl", "events.jsonl", "handshake-ok.jsonl", "hints.jsonl",
			"limits.jsonl", "ops-join-failed.jsonl", "ops.jsonl", "pending.jsonl", "reject-build.jsonl", "reject-duplicate.jsonl",
			"reject-owner.jsonl", "reject-protocol.jsonl", "reject-retry.jsonl", "reject-token.jsonl", "request-response.jsonl",
			"topics-me-directory.jsonl", "topics-notice.jsonl", "topics.jsonl");

		assertEquals(known, Fixtures.fileNames());
	}
}
