package dev.laux.pumpkin.friends.protocol;

import static org.junit.jupiter.api.Assertions.assertEquals;

import dev.laux.pumpkin.friends.Fixtures;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Guards the guard: a fixture file that is added without a test reading it fails here. Which test reads which file:
 * handshake-ok and reject-* by {@link HandshakeFixturesTest}; ops, request-response and pending by
 * {@code OpsFixturesTest} and {@code RequestManagerTest}; errors by {@link ErrorFixturesTest}; events by
 * {@link EventFixturesTest}; hints by {@link HintsFixturesTest}; limits by {@link LimitsFixtureTest}; topics by
 * {@code TopicFixturesTest}.
 */
class FixtureFilesTest {
	@Test
	void theFixtureDirectoryHoldsExactlyTheFilesTheTestsKnow() {
		List<String> known = List.of("errors.jsonl", "events.jsonl", "handshake-ok.jsonl", "hints.jsonl", "limits.jsonl",
			"ops.jsonl", "pending.jsonl", "reject-build.jsonl", "reject-duplicate.jsonl", "reject-owner.jsonl",
			"reject-protocol.jsonl", "reject-retry.jsonl", "reject-token.jsonl", "request-response.jsonl", "topics.jsonl");

		assertEquals(known, Fixtures.fileNames());
	}
}
