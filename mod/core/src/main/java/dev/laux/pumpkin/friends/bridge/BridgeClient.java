package dev.laux.pumpkin.friends.bridge;

import dev.laux.pumpkin.friends.bridge.Messages.Hello;
import dev.laux.pumpkin.friends.bridge.Messages.Inbound;
import dev.laux.pumpkin.friends.bridge.Messages.Outbound;
import dev.laux.pumpkin.friends.bridge.Messages.Ping;
import dev.laux.pumpkin.friends.bridge.Messages.Pong;
import dev.laux.pumpkin.friends.bridge.Messages.Reject;
import dev.laux.pumpkin.friends.bridge.Messages.Welcome;
import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Hält die Verbindung zum Launcher (SPEC 7, 11.4): ein Daemon-Thread verbindet, liest und wartet nach jedem Abbruch
 * die {@link Backoff}-Zeit; pro Verbindung schreibt ein zweiter Thread aus einer Warteschlange mit 64 Plätzen.
 */
public final class BridgeClient {
	private static final Logger LOG = LoggerFactory.getLogger("pumpkin_friends");
	private static final int QUEUE_CAPACITY = 64;
	private static final String THREAD_NAME = "Pumpkin Friends bridge";

	private final BridgeEnv env;
	private final Versions versions;
	private final Listener listener;
	private final Timing timing;
	private final Backoff backoff = new Backoff();
	private final BlockingQueue<Outbound> outgoing = new LinkedBlockingQueue<>(QUEUE_CAPACITY);
	private volatile boolean running;
	private volatile boolean welcomed;
	private volatile Socket socket;
	private Thread reader;

	private BridgeClient(BridgeEnv env, Versions versions, Listener listener, Timing timing) {
		this.env = env;
		this.versions = versions;
		this.listener = listener;
		this.timing = timing;
	}

	/** Verbindet nur, wenn der Launcher die Umgebung gesetzt hat (SPEC 7.5); sonst entsteht kein Thread. */
	public static Optional<BridgeClient> startIfLaunched(Map<String, String> environment, Versions versions,
			Listener listener, Timing timing) {
		return BridgeEnv.from(environment).map(env -> {
			BridgeClient client = new BridgeClient(env, versions, listener, timing);
			client.running = true;
			client.reader = daemon(client::connectRepeatedly, THREAD_NAME);
			return client;
		});
	}

	public void stop() {
		running = false;
		closeSocket();
		reader.interrupt();
	}

	/** Verwirft die Nachricht, solange der Launcher die Verbindung nicht bestätigt hat oder die Warteschlange voll ist. */
	public void send(Outbound message) {
		if (welcomed && !outgoing.offer(message)) {
			LOG.warn("Nachricht an den Launcher verworfen, Warteschlange voll: {}", message.type());
		}
	}

	private void connectRepeatedly() {
		while (running) {
			connectOnce();
			if (running) {
				waitBeforeReconnect();
			}
		}
	}

	private void waitBeforeReconnect() {
		try {
			timing.sleeper().sleep(backoff.next());
		} catch (InterruptedException stopped) {
			Thread.currentThread().interrupt();
			running = false;
		}
	}

	private void connectOnce() {
		try (Socket connection = new Socket()) {
			socket = connection;
			connection.connect(launcherAddress(), (int) timing.connectTimeout().toMillis());
			connection.setSoTimeout((int) timing.silenceTimeout().toMillis());
			converse(connection);
		} catch (IOException ended) {
			LOG.debug("Verbindung zum Launcher beendet: {}", ended.getMessage());
		} finally {
			socket = null;
			endSession();
		}
	}

	private InetSocketAddress launcherAddress() {
		return new InetSocketAddress(InetAddress.getLoopbackAddress(), env.port());
	}

	private void converse(Socket connection) throws IOException {
		OutputStream out = connection.getOutputStream();
		// Reste der vorigen Verbindung dürfen nicht vor oder statt der neuen Begrüßung hinausgehen.
		outgoing.clear();
		writeLine(out, new Hello(List.of(Protocol.VERSION), env.token(), versions.mod(), versions.minecraft()));
		Thread writer = daemon(() -> writeQueued(out), THREAD_NAME + " writer");
		try {
			readUntilClosed(new BufferedInputStream(connection.getInputStream()));
		} finally {
			writer.interrupt();
		}
	}

	private void readUntilClosed(InputStream in) throws IOException {
		while (running) {
			if (!handle(Protocol.readLine(in))) {
				return;
			}
		}
	}

	/** Liefert {@code false}, wenn die Verbindung enden soll. Unlesbare Zeilen werden übergangen. */
	private boolean handle(String line) {
		return Protocol.decode(line).map(this::dispatch).orElse(true);
	}

	private boolean dispatch(Inbound message) {
		if (message instanceof Welcome welcome) {
			return acceptWelcome(welcome);
		}
		if (message instanceof Reject reject) {
			LOG.warn("Launcher lehnt die Verbindung ab: {}", reject.reason());
			return false;
		}
		if (!(message instanceof Pong) && welcomed) {
			listener.received(message);
		}
		return true;
	}

	private boolean acceptWelcome(Welcome welcome) {
		if (welcome.protocol() != Protocol.VERSION) {
			LOG.warn("Launcher spricht Protokoll {}, die Mod nur {}", welcome.protocol(), Protocol.VERSION);
			return false;
		}
		backoff.reset();
		welcomed = true;
		LOG.info("Mit dem Pumpkin Launcher verbunden");
		listener.connected();
		return true;
	}

	private void endSession() {
		if (welcomed) {
			welcomed = false;
			LOG.info("Verbindung zum Pumpkin Launcher getrennt");
			listener.disconnected();
		}
	}

	/** Schreibt die Warteschlange; ist sie eine Ping-Periode lang leer, geht ein {@code ping} hinaus (Lebenszeichen). */
	private void writeQueued(OutputStream out) {
		try {
			while (true) {
				Outbound message = outgoing.poll(timing.pingInterval().toMillis(), TimeUnit.MILLISECONDS);
				writeLine(out, message == null ? new Ping() : message);
			}
		} catch (InterruptedException sessionEnded) {
			Thread.currentThread().interrupt();
		} catch (IOException writeFailed) {
			closeSocket();
		}
	}

	private static void writeLine(OutputStream out, Outbound message) throws IOException {
		out.write((Protocol.encode(message) + "\n").getBytes(StandardCharsets.UTF_8));
		out.flush();
	}

	private void closeSocket() {
		Socket current = socket;
		if (current == null) {
			return;
		}
		try {
			current.close();
		} catch (IOException ignored) {
			// Ein Fehler beim Schließen ändert nichts: die Verbindung ist danach so oder so weg.
		}
	}

	private static Thread daemon(Runnable task, String name) {
		Thread thread = new Thread(task, name);
		thread.setDaemon(true);
		thread.start();
		return thread;
	}

	/** Empfänger der Brückenereignisse; wird vom Lese-Thread aufgerufen. */
	public interface Listener {
		void connected();

		void received(Inbound message);

		void disconnected();
	}

	public record Versions(String mod, String minecraft) {
	}

	/** Zeiten der Verbindung; Tests verkürzen die Wartezeiten über einen eigenen {@link Sleeper}. */
	public record Timing(Duration connectTimeout, Duration pingInterval, Duration silenceTimeout, Sleeper sleeper) {
		public static Timing production() {
			return new Timing(Duration.ofSeconds(2), Duration.ofSeconds(10), Duration.ofSeconds(30),
				pause -> Thread.sleep(pause.toMillis()));
		}
	}

	@FunctionalInterface
	public interface Sleeper {
		void sleep(Duration duration) throws InterruptedException;
	}
}
