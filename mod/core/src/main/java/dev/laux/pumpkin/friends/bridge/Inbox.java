package dev.laux.pumpkin.friends.bridge;

import dev.laux.pumpkin.friends.protocol.ClosingReason;
import dev.laux.pumpkin.friends.protocol.LauncherFrame;
import dev.laux.pumpkin.friends.protocol.LauncherFrame.Closing;
import dev.laux.pumpkin.friends.protocol.LauncherFrame.Notify;
import dev.laux.pumpkin.friends.protocol.LauncherFrame.Pending;
import dev.laux.pumpkin.friends.protocol.LauncherFrame.Response;
import dev.laux.pumpkin.friends.protocol.LauncherFrame.State;
import dev.laux.pumpkin.friends.request.RequestManager;
import dev.laux.pumpkin.friends.runtime.MainThread;
import dev.laux.pumpkin.friends.state.Sanitize;
import dev.laux.pumpkin.friends.state.TopicStore;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The hand-over from the bridge thread to the main thread. Answers go to the {@link RequestManager}; topics, notices, the
 * closing event and link changes are posted to the main thread, in the order they arrived, where the {@link TopicStore} and
 * the listeners see them. A listener that throws is logged and skipped: the mod must never throw into the game.
 */
final class Inbox {
	private static final Logger LOG = LoggerFactory.getLogger("pumpkin_friends");

	private final RequestManager requests;
	private final TopicStore topics;
	private final MainThread mainThread;
	private final Consumer<ClosingReason> onClosing;
	private final List<BridgeListener> listeners = new CopyOnWriteArrayList<>();
	private volatile LinkState linkState = LinkState.OFFLINE;

	Inbox(RequestManager requests, TopicStore topics, MainThread mainThread, Consumer<ClosingReason> onClosing) {
		this.requests = requests;
		this.topics = topics;
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
			postToMainThread(() -> topics.apply(push));
		} else if (frame instanceof Notify notify) {
			postToMainThread(() -> tellListeners(listener -> listener.notice(notify.kind(), cleanName(notify))));
		} else if (frame instanceof Closing closing) {
			onClosing.accept(closing.reason());
			postToMainThread(() -> tellListeners(listener -> listener.closing(closing.reason())));
		}
	}

	/** Bridge thread, once per housekeeping period. */
	void tick() {
		requests.expireOverdue();
	}

	/** Bridge thread: the link changed. Topics are forgotten while it is down. */
	void linkChanged(LinkState next) {
		postToMainThread(() -> {
			linkState = next;
			if (!next.isConnected()) {
				topics.clear();
			}
			tellListeners(listener -> listener.linkChanged(next));
		});
	}

	private static Optional<String> cleanName(Notify notify) {
		return notify.name().map(Sanitize::name).filter(name -> !name.isEmpty());
	}

	private void tellListeners(Consumer<BridgeListener> call) {
		for (BridgeListener listener : listeners) {
			try {
				call.accept(listener);
			} catch (RuntimeException failure) {
				LOG.warn("Pumpkin Friends: listener failed", failure);
			}
		}
	}

	private void postToMainThread(Runnable task) {
		mainThread.execute(() -> {
			try {
				task.run();
			} catch (RuntimeException failure) {
				LOG.warn("Pumpkin Friends: handling a launcher message failed", failure);
			}
		});
	}
}
