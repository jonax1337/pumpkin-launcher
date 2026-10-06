package dev.laux.pumpkin.bridge.transport;

import dev.laux.pumpkin.bridge.runtime.Immutable;

import dev.laux.pumpkin.bridge.protocol.ClosingReason;
import dev.laux.pumpkin.bridge.protocol.ErrorCode;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame.Welcome;
import dev.laux.pumpkin.bridge.protocol.ModFrame;
import dev.laux.pumpkin.bridge.protocol.RejectReason;
import dev.laux.pumpkin.bridge.transport.request.Op;
import dev.laux.pumpkin.bridge.transport.request.Request;
import dev.laux.pumpkin.bridge.transport.request.RequestManager;
import dev.laux.pumpkin.bridge.transport.request.RequestManager.Delivery;
import dev.laux.pumpkin.bridge.runtime.MonotonicClock;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.apache.logging.log4j.Logger;
import org.apache.logging.log4j.LogManager;

/**
 * The mod's side of the launcher channel (docs/bridge/README.md, "Protocol 2", protocol 2). A daemon thread connects, speaks the protocol and, after
 * every end of the connection, waits the {@link Backoff} time (a fixed minute after a terminal {@code reject}) before it
 * tries again. Requests, state frames and notices are delivered on the main thread through {@link BridgeListener}.
 * Without the launcher's environment variables nothing starts.
 */
public final class BridgeClient {
	private static final Logger LOG = LogManager.getLogger("pumpkin_bridge");
	private static final String THREAD_NAME = "Pumpkin Bridge bridge";

	private final BridgeEnv env;
	private final HostPlatform platform;
	private final Timing timing;
	private final MonotonicClock clock = MonotonicClock.SYSTEM;
	private final Backoff backoff = new Backoff();
	private final RequestManager requests;
	private final Inbox inbox;
	private final Thread bridgeThread;
	private volatile boolean running = true;
	private volatile Connection current;
	private volatile Socket socket;
	private volatile List<String> readyScreens = Immutable.list();
	// Only the bridge thread touches the rest.
	private Connection serving;
	private Optional<RejectReason> rejection = Optional.empty();
	private Optional<RejectReason> lastReportedRejection = Optional.empty();
	private LinkState published = LinkState.OFFLINE;

	private BridgeClient(BridgeEnv env, HostPlatform platform, Timing timing) {
		this.env = env;
		this.platform = platform;
		this.timing = timing;
		this.requests = new RequestManager(platform.mainThread(), clock, this::deliver);
		this.inbox = new Inbox(requests, platform.mainThread(), this::onClosing);
		this.bridgeThread = new Thread(this::connectRepeatedly, THREAD_NAME);
		bridgeThread.setDaemon(true);
	}

	/** Connects only when the launcher set the environment (SPEC 7.5); otherwise no thread exists. */
	public static Optional<BridgeClient> startIfLaunched(Map<String, String> environment, HostPlatform platform, Timing timing) {
		return BridgeEnv.from(environment).map(env -> {
			BridgeClient client = new BridgeClient(env, platform, timing);
			client.bridgeThread.start();
			return client;
		});
	}

	public void stop() {
		running = false;
		closeSocket();
		bridgeThread.interrupt();
	}

	public void addListener(BridgeListener listener) {
		inbox.addListener(listener);
	}

	/** Main thread. */
	public LinkState state() {
		return inbox.linkState();
	}

	/** Main thread. */
	public boolean isConnected() {
		return state().isConnected();
	}

	/** Main thread. The reply completes on the main thread, also when the link is down ({@code disconnected}). */
	public <T> Request<T> request(Op<T> op) {
		return requests.start(op);
	}

	/** Whether the launcher currently waits for the player to answer a dialog on behalf of a request. */
	public boolean isAwaitingLauncherDialog() {
		return requests.isAwaitingLauncherDialog();
	}

	/** Names the screens this mod offers; sent now and again after every reconnect. */
	public void announceReady(List<String> screens) {
		readyScreens = Immutable.copyList(screens);
		sendReady();
	}

	/** Sends a module hint; disconnected hints are dropped, and a full outgoing queue is reported. */
	public void hint(ModFrame frame) {
		if (deliver(frame) == Delivery.QUEUE_FULL) {
			LOG.warn("Pumpkin Bridge: dropped {} for the launcher, the queue is full", frame.type());
		}
	}

	private void sendReady() {
		if (!readyScreens.isEmpty()) {
			hint(new ModFrame.Ready(readyScreens));
		}
	}

	private Delivery deliver(ModFrame frame) {
		Connection connection = current;
		if (connection == null) {
			return Delivery.NOT_CONNECTED;
		}
		return connection.offer(frame) ? Delivery.QUEUED : Delivery.QUEUE_FULL;
	}

	private void onClosing(ClosingReason reason) {
		if (reason.isFinal()) {
			LOG.info("Pumpkin Bridge: the launcher ended this link for good ({})", reason);
			running = false;
		}
	}

	private void connectRepeatedly() {
		while (running) {
			rejection = Optional.empty();
			connectOnce();
			if (running) {
				pauseBeforeReconnect();
			}
		}
	}

	private void pauseBeforeReconnect() {
		Duration pause = rejection.isPresent() ? timing.rejectedRetry() : backoff.next();
		try {
			timing.sleeper().sleep(pause);
		} catch (InterruptedException stopped) {
			Thread.currentThread().interrupt();
			running = false;
		}
	}

	private void connectOnce() {
		try (Socket connection = new Socket()) {
			socket = connection;
			connection.connect(new InetSocketAddress("127.0.0.1", env.port()),
				(int) timing.connectTimeout().toMillis());
			serving = new Connection(connection, hello(), timing, clock, inbox, new HandshakeEvents());
			serving.serve();
		} catch (IOException ended) {
			LOG.debug("Pumpkin Bridge: connection to the launcher ended: {}", ended.getMessage());
		} finally {
			socket = null;
			endLink();
		}
	}

	private ModFrame.Hello hello() {
		return new ModFrame.Hello(env.token(), platform.modVersion(), platform.buildId(), platform.game());
	}

	private void endLink() {
		current = null;
		requests.failAll(ErrorCode.DISCONNECTED);
		publish(rejection.<LinkState>map(LinkState.Rejected::new).orElse(LinkState.OFFLINE));
	}

	private void publish(LinkState next) {
		if (!next.equals(published)) {
			if (published.isConnected()) {
				LOG.info("Pumpkin Bridge: disconnected from the Pumpkin Launcher");
			}
			published = next;
			inbox.linkChanged(next);
		}
	}

	private void closeSocket() {
		Socket open = socket;
		if (open == null) {
			return;
		}
		try {
			open.close();
		} catch (IOException ignored) {
			// Closing a socket that is already failing changes nothing: the connection is gone either way.
		}
	}

	private final class HandshakeEvents implements Connection.Events {
		@Override
		public void welcomed(Welcome welcome) {
			backoff.reset();
			lastReportedRejection = Optional.empty();
			current = serving;
			LOG.info("Pumpkin Bridge: connected to the Pumpkin Launcher {}", welcome.launcher());
			publish(new LinkState.Connected(welcome.launcher(), welcome.scopes()));
			sendReady();
		}

		@Override
		public void rejected(RejectReason reason) {
			rejection = Optional.of(reason).filter(RejectReason::isTerminal);
			reportOnce(reason);
		}

		// A game that is refused keeps asking once a minute; the log hears of it once per reason.
		private void reportOnce(RejectReason reason) {
			if (reason.isTerminal() && !Optional.of(reason).equals(lastReportedRejection)) {
				LOG.warn("Pumpkin Bridge: the launcher refused this game ({}); trying again every minute", reason);
				lastReportedRejection = Optional.of(reason);
			} else {
				LOG.debug("Pumpkin Bridge: the launcher refused this game ({})", reason);
			}
		}
	}
}
