package dev.laux.pumpkin.bridge.modules.friends.ui.model;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import dev.laux.pumpkin.bridge.modules.friends.state.Join;
import java.util.Optional;
import java.util.OptionalInt;
import org.junit.jupiter.api.Test;

/**
 * The join lifecycle of docs/bridge/README.md, "In-game navigation and world behavior": the loopback validation, the confirm-leave-connect order, the thirty-second deadline
 * and the failure report.
 */
class JoinHereFlowTest {
	private static final long START = 1_000;
	private static final Join CONNECTED = new Join("i1", "Sam", Join.Phase.CONNECTED, Optional.of(Join.Path.DIRECT),
		OptionalInt.of(23));
	private static final Join CONNECTING = new Join("i1", "Sam", Join.Phase.CONNECTING, Optional.empty(),
		OptionalInt.empty());

	@Test
	void aValidAnswerAsksForConfirmationAndThenLeavesAndConnects() {
		JoinHereFlow flow = new JoinHereFlow();

		assertEquals(JoinHereFlow.Step.CONFIRM, flow.answered("127.0.0.1", 49_151));
		assertEquals(JoinHereFlow.Step.LEAVE_AND_CONNECT, flow.confirmed(START));
		assertEquals("127.0.0.1", flow.host());
		assertEquals(49_151, flow.port());
		assertEquals(JoinHereFlow.Phase.CONNECTING, flow.phase());
	}

	@Test
	void aHostOutsideTheLoopbackBlockIsRefusedBeforeAnythingHappens() {
		JoinHereFlow flow = new JoinHereFlow();

		assertEquals(JoinHereFlow.Step.FAIL, flow.answered("10.0.0.5", 49_151));
		assertEquals(JoinHereFlow.Failure.NOT_A_LOOPBACK_ADDRESS, flow.failure());
		assertEquals(JoinHereFlow.Phase.ENDED, flow.phase());
		assertEquals("", flow.host());
	}

	@Test
	void aDeclinedConfirmationCancelsTheJoinInsteadOfFailingIt() {
		JoinHereFlow flow = new JoinHereFlow();
		flow.answered("127.0.0.1", 49_151);

		assertEquals(JoinHereFlow.Step.CANCEL_JOIN, flow.declined());
		assertEquals(JoinHereFlow.Phase.ENDED, flow.phase());
		assertNull(flow.failure());
	}

	@Test
	void theJoinTopicConnectedCompletesTheFlow() {
		JoinHereFlow flow = joinedAndConnected();

		assertEquals(JoinHereFlow.Phase.JOINED, flow.phase());
		assertEquals(JoinHereFlow.Step.NONE, flow.joinTopic(Optional.of(CONNECTED)));
	}

	@Test
	void aJoinTopicThatVanishesAfterItWasSeenDisconnects() {
		JoinHereFlow flow = new JoinHereFlow();
		flow.answered("127.0.0.1", 49_151);
		flow.confirmed(START);
		assertEquals(JoinHereFlow.Step.NONE, flow.joinTopic(Optional.of(CONNECTING)));

		assertEquals(JoinHereFlow.Step.FAIL, flow.joinTopic(Optional.empty()));
		assertEquals(JoinHereFlow.Failure.DISCONNECTED, flow.failure());
	}

	@Test
	void anAbsentJoinTopicBeforeTheFirstOneIsJustThePushTrailingTheAnswer() {
		JoinHereFlow flow = new JoinHereFlow();
		flow.answered("127.0.0.1", 49_151);
		flow.confirmed(START);

		assertEquals(JoinHereFlow.Step.NONE, flow.joinTopic(Optional.empty()));
		assertEquals(JoinHereFlow.Phase.CONNECTING, flow.phase());
	}

	@Test
	void withoutConnectedAfterThirtySecondsTheJoinFails() {
		JoinHereFlow flow = new JoinHereFlow();
		flow.answered("127.0.0.1", 49_151);
		flow.confirmed(START);

		assertEquals(JoinHereFlow.Step.NONE, flow.tick(START + JoinHereFlow.DEADLINE_MILLIS - 1));
		assertEquals(JoinHereFlow.Step.FAIL, flow.tick(START + JoinHereFlow.DEADLINE_MILLIS));
		assertEquals(JoinHereFlow.Failure.TIMEOUT, flow.failure());
	}

	@Test
	void anAbandonedAnswerEndsTheFlowWithoutOwingAReport() {
		JoinHereFlow flow = new JoinHereFlow();
		flow.abandoned();

		assertEquals(JoinHereFlow.Phase.ENDED, flow.phase());
		assertNull(flow.failure());
		assertEquals(JoinHereFlow.Step.NONE, flow.answered("127.0.0.1", 49_151));
	}

	@Test
	void anEndedFlowIgnoresFurtherEvents() {
		JoinHereFlow flow = new JoinHereFlow();
		flow.answered("127.0.0.1", 49_151);
		flow.confirmed(START);
		flow.tick(START + JoinHereFlow.DEADLINE_MILLIS);

		assertEquals(JoinHereFlow.Step.NONE, flow.tick(START + 2 * JoinHereFlow.DEADLINE_MILLIS));
		assertEquals(JoinHereFlow.Step.NONE, flow.joinTopic(Optional.of(CONNECTED)));
		assertEquals(JoinHereFlow.Step.NONE, flow.joinTopic(Optional.empty()));
	}

	private static JoinHereFlow joinedAndConnected() {
		JoinHereFlow flow = new JoinHereFlow();
		flow.answered("127.0.0.1", 49_151);
		flow.confirmed(START);
		flow.joinTopic(Optional.of(CONNECTED));
		return flow;
	}
}
