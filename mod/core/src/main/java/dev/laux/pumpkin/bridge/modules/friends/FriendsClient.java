package dev.laux.pumpkin.bridge.modules.friends;

import dev.laux.pumpkin.bridge.modules.friends.state.Sanitize;
import dev.laux.pumpkin.bridge.modules.friends.state.TopicStore;
import dev.laux.pumpkin.bridge.protocol.ClosingReason;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame.State;
import dev.laux.pumpkin.bridge.protocol.ModFrame;
import dev.laux.pumpkin.bridge.protocol.NotifyKind;
import dev.laux.pumpkin.bridge.transport.BridgeClient;
import dev.laux.pumpkin.bridge.transport.BridgeListener;
import dev.laux.pumpkin.bridge.transport.LinkState;
import dev.laux.pumpkin.bridge.transport.request.Op;
import dev.laux.pumpkin.bridge.transport.request.Request;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Friends state and operations on a shared launcher connection. All module callbacks run on the main thread. */
public final class FriendsClient implements BridgeListener {
	private static final Logger LOG = LoggerFactory.getLogger("pumpkin_bridge");

	private final BridgeClient bridge;
	private final TopicStore topics = new TopicStore();
	private final List<BridgeListener> listeners = new CopyOnWriteArrayList<>();

	public FriendsClient(BridgeClient bridge) {
		this.bridge = Objects.requireNonNull(bridge);
		bridge.addListener(this);
	}

	public BridgeClient bridge() {
		return bridge;
	}

	public TopicStore topics() {
		return topics;
	}

	public LinkState state() {
		return bridge.state();
	}

	public boolean isConnected() {
		return bridge.isConnected();
	}

	public boolean isAwaitingLauncherDialog() {
		return bridge.isAwaitingLauncherDialog();
	}

	public <T> Request<T> request(Op<T> operation) {
		return bridge.request(operation);
	}

	public void lanOpened(int port) {
		bridge.hint(new ModFrame.LanOpened(port));
	}

	public void lanClosed() {
		bridge.hint(new ModFrame.LanClosed());
	}

	public void addListener(BridgeListener listener) {
		listeners.add(listener);
	}

	@Override
	public void stateReceived(State state) {
		topics.apply(state);
		tellListeners(listener -> listener.stateReceived(state));
	}

	@Override
	public void linkChanged(LinkState state) {
		if (!state.isConnected()) {
			topics.clear();
		}
		tellListeners(listener -> listener.linkChanged(state));
	}

	@Override
	public void notice(NotifyKind kind, Optional<String> name) {
		Optional<String> cleanName = name.map(Sanitize::name).filter(value -> !value.isEmpty());
		tellListeners(listener -> listener.notice(kind, cleanName));
	}

	@Override
	public void closing(ClosingReason reason) {
		tellListeners(listener -> listener.closing(reason));
	}

	private void tellListeners(Consumer<BridgeListener> call) {
		for (BridgeListener listener : listeners) {
			try {
				call.accept(listener);
			} catch (RuntimeException failure) {
				LOG.warn("Pumpkin Bridge: Friends listener failed", failure);
			}
		}
	}
}
