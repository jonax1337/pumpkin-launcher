package dev.laux.pumpkin.bridge.modules.friends.ui.model;

import dev.laux.pumpkin.bridge.protocol.OpError;
import dev.laux.pumpkin.bridge.protocol.Scope;
import dev.laux.pumpkin.bridge.transport.request.Reply;
import dev.laux.pumpkin.bridge.transport.request.Request;
import java.util.Optional;

/**
 * The state of waiting for a launcher dialog (INGAME 5.5, 6.2): while a request is pending the game shows the
 * LauncherWaitScreen, and its "Abbrechen" only stops waiting — the operation itself keeps running to its answer. The
 * first terminal event decides; later ones change nothing.
 */
public final class LauncherWait {
	/** WAITING while the answer is open; the rest are the ways waiting ends. */
	public enum Phase {
		WAITING,
		SUCCEEDED,
		FAILED,
		STOPPED_WAITING
	}

	private Phase phase = Phase.WAITING;
	private Optional<Scope> awaitedScope = Optional.empty();
	private Optional<OpError> failure = Optional.empty();
	private Runnable onLauncherAsks = () -> {
	};

	private LauncherWait() {
	}

	/** Observes one request: its pending dialog and its final answer both arrive here, on the main thread. */
	public static LauncherWait of(Request<?> request) {
		LauncherWait wait = new LauncherWait();
		request.whenPending(wait::launcherAsks);
		request.reply().thenAccept(wait::answered);
		return wait;
	}

	/** Runs the listener when the launcher shows its dialog, or at once if it already does. */
	public void whenLauncherAsks(Runnable listener) {
		onLauncherAsks = listener;
		if (awaitedScope.isPresent() && phase == Phase.WAITING) {
			listener.run();
		}
	}

	public Phase phase() {
		return phase;
	}

	public boolean finished() {
		return phase != Phase.WAITING;
	}

	/** The scope of the dialog the player has to answer, while there is one. */
	public Optional<Scope> awaitedScope() {
		return awaitedScope;
	}

	/** Why the request failed; empty for every other way waiting ended. */
	public Optional<OpError> failure() {
		return failure;
	}

	void launcherAsks(Scope scope) {
		if (phase == Phase.WAITING) {
			awaitedScope = Optional.of(scope);
			onLauncherAsks.run();
		}
	}

	void answered(Reply<?> reply) {
		if (phase != Phase.WAITING) {
			return;
		}
		failure = reply.error();
		phase = failure.isPresent() ? Phase.FAILED : Phase.SUCCEEDED;
	}

	/** Stops the UI from waiting without cancelling the request or changing an already terminal phase. */
	public void stopWaiting() {
		if (phase == Phase.WAITING) {
			phase = Phase.STOPPED_WAITING;
		}
	}
}
