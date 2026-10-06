package dev.laux.pumpkin.bridge.modules.friends.ui.model;

import dev.laux.pumpkin.bridge.modules.friends.state.Join;
import java.util.Optional;

/**
 * The join flow of docs/bridge/README.md, "In-game navigation and world behavior" as a pure machine: the answer of {@code invite.joinHere} is validated as a literal loopback
 * address before anything happens, the player confirms leaving the world, then the game connects and waits for the join
 * topic to reach {@code connected} within thirty seconds. Every event returns the step the caller owes the flow next;
 * {@link #tick} drives the deadline, {@link #joinTopic} the connection's progress. The failure cases end the flow and
 * owe the launcher the {@code join.failed} report.
 */
public final class JoinHereFlow {
	/** docs/bridge/README.md, "In-game navigation and world behavior": after thirty seconds without {@code connected} the join counts as failed. */
	public static final long DEADLINE_MILLIS = 30_000;

	public enum Phase {
		WAITING_FOR_THE_ANSWER,
		CONFIRMING,
		CONNECTING,
		JOINED,
		ENDED
	}

	/** What the caller does next; the order of the enum is the order the flow runs in. */
	public enum Step {
		NONE,
		/** Ask "Welt verlassen und beitreten?"; the answer arrives as {@link #confirmed} or {@link #declined}. */
		CONFIRM,
		/** Leave the world, then connect to {@link #host()}:{@link #port()}. */
		LEAVE_AND_CONNECT,
		/** The player declined: tell the launcher with {@code join.leave}. */
		CANCEL_JOIN,
		/** Show {@link #failure()} and send {@code join.failed}. */
		FAIL
	}

	public enum Failure {
		NOT_A_LOOPBACK_ADDRESS,
		DISCONNECTED,
		TIMEOUT
	}

	private Phase phase = Phase.WAITING_FOR_THE_ANSWER;
	private String host = "";
	private int port;
	private long deadlineMillis;
	private boolean joinSeen;
	private Failure failure;

	/** The answer of {@code invite.joinHere}; a host outside 127.0.0.0/8 is refused and reported, never connected to. */
	public Step answered(String answerHost, int answerPort) {
		if (phase != Phase.WAITING_FOR_THE_ANSWER) {
			return Step.NONE;
		}
		if (!LoopbackAddress.isLiteral(answerHost)) {
			return fail(Failure.NOT_A_LOOPBACK_ADDRESS);
		}
		host = answerHost;
		port = answerPort;
		phase = Phase.CONFIRMING;
		return Step.CONFIRM;
	}

	public Step confirmed(long nowMillis) {
		if (phase != Phase.CONFIRMING) {
			return Step.NONE;
		}
		phase = Phase.CONNECTING;
		deadlineMillis = nowMillis + DEADLINE_MILLIS;
		return Step.LEAVE_AND_CONNECT;
	}

	public Step declined() {
		if (phase != Phase.CONFIRMING) {
			return Step.NONE;
		}
		phase = Phase.ENDED;
		return Step.CANCEL_JOIN;
	}

	/** The operation itself failed, so no answer will come; the flow ends without owing the launcher a report. */
	public void abandoned() {
		if (phase == Phase.WAITING_FOR_THE_ANSWER) {
			phase = Phase.ENDED;
		}
	}

	/**
	 * The join topic: {@code connected} completes the flow; a topic that vanishes after it was seen means the connection
	 * is gone. An absent topic before the first one is nothing - the push of the topic can trail the answer of the
	 * operation.
	 */
	public Step joinTopic(Optional<Join> join) {
		if (phase != Phase.CONNECTING) {
			return Step.NONE;
		}
		if (join.isPresent()) {
			joinSeen = true;
			if (join.get().phase() == Join.Phase.CONNECTED) {
				phase = Phase.JOINED;
			}
		} else if (joinSeen) {
			return fail(Failure.DISCONNECTED);
		}
		return Step.NONE;
	}

	public Step tick(long nowMillis) {
		return phase == Phase.CONNECTING && nowMillis >= deadlineMillis ? fail(Failure.TIMEOUT) : Step.NONE;
	}

	public Phase phase() {
		return phase;
	}

	/** Whether this flow still owns the join: waiting for the answer, confirming or connecting. */
	public boolean busy() {
		return phase == Phase.WAITING_FOR_THE_ANSWER || phase == Phase.CONFIRMING || phase == Phase.CONNECTING;
	}

	/** Only set after the {@code CONFIRM} step: the validated loopback address to connect to. */
	public String host() {
		return host;
	}

	public int port() {
		return port;
	}

	/** Why the flow ended in {@code FAIL}; {@code null} otherwise. */
	public Failure failure() {
		return failure;
	}

	private Step fail(Failure cause) {
		phase = Phase.ENDED;
		failure = cause;
		return Step.FAIL;
	}
}
