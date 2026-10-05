package dev.laux.pumpkin.bridge.transport;

import dev.laux.pumpkin.bridge.protocol.ClosingReason;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame.Closing;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame.Notify;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame.Pending;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame.Response;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame.State;
import dev.laux.pumpkin.bridge.transport.request.RequestManager;
import dev.laux.pumpkin.bridge.runtime.MainThread;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The hand-over from the bridge thread to the main thread. Answers go to the {@link RequestManager}; state frames,
 * notices, closing events and link changes reach listeners in arrival order on the main thread.
 * A listener that throws is logged and skipped: the mod must never throw into the game.
 */
final class Inbox {
	private static final Logger LOG = LoggerFactory.getLogger("pumpkin_bridge");

	private final RequestManager requests;
	private final MainThread mainThread;
	private final Consumer<ClosingReason> onClosing;
	private final List<BridgeListener> listeners = new CopyOnWriteArrayList<>();
	private volatile LinkState linkState = LinkState.OFFLINE;

	Inbox(RequestManager requests, MainThread mainThread, Consumer<ClosingReason> onClosing) {
		this.requests = requests;
		this.mainThread = mainThread;
		this.onClosing = onClosing;
	}

	void addListener(BridgeListener listener) {
		listeners.add(listener);
	}

	LinkState linkState() {
		return linkState;
	}

	/** Bridge thread: a frame that is neither handshake nor keep-alive. */
	void deliver(LauncherFrame frame) {
		if (frame instanceof Response response) {
			requests.onResponse(response);
		} else if (frame instanceof Pending pending) {
			requests.onPending(pending);
		} else if (frame instanceof State push) {
			postToMainThread(() -> tellListeners(listener -> listener.stateReceived(push)));
		} else if (frame instanceof Notify notify) {
			postToMainThread(() -> tellListeners(listener -> listener.notice(notify.kind(), notify.name())));
		} else if (frame instanceof Closing closing) {
			onClosing.accept(closing.reason());
			postToMainThread(() -> tellListeners(listener -> listener.closing(closing.reason())));
		}
	}

	/** Bridge thread, once per housekeeping period. */
	void tick() {
		requests.expireOverdue();
	}

	/** Bridge thread: publishes the new link state in frame-delivery order. */
	void linkChanged(LinkState next) {
		postToMainThread(() -> {
			linkState = next;
			tellListeners(listener -> listener.linkChanged(next));
		});
	}

	private void tellListeners(Consumer<BridgeListener> call) {
		for (BridgeListener listener : listeners) {
			try {
				call.accept(listener);
			} catch (RuntimeException failure) {
				LOG.warn("Pumpkin Bridge: listener failed", failure);
			}
		}
	}

	private void postToMainThread(Runnable task) {
		mainThread.execute(() -> {
			try {
				task.run();
			} catch (RuntimeException failure) {
				LOG.warn("Pumpkin Bridge: handling a launcher message failed", failure);
			}
		});
	}
}
