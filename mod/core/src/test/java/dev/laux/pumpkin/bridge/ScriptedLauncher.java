package dev.laux.pumpkin.bridge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.fail;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.laux.pumpkin.bridge.Fixtures.Direction;
import dev.laux.pumpkin.bridge.Fixtures.Line;
import dev.laux.pumpkin.bridge.protocol.json.WireNames;
import dev.laux.pumpkin.bridge.protocol.RejectReason;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Plays the launcher side of protocol 2 from a script: listens on loopback and speaks JSON lines. The environment it hands
 * out carries the token of the fixtures, so a fixture {@code hello} is exactly what the mod must send.
 */
public final class ScriptedLauncher implements AutoCloseable {
	private static final Duration STEP_TIMEOUT = Duration.ofSeconds(5);

	private final ServerSocket server;

	public ScriptedLauncher() throws IOException {
		server = new ServerSocket(0, 8, InetAddress.getLoopbackAddress());
	}

	public Map<String, String> environment() {
		return Map.of(
			"PUMPKIN_IPC_PORT", String.valueOf(server.getLocalPort()),
			"PUMPKIN_IPC_TOKEN", Fixtures.TOKEN,
			"PUMPKIN_IPC_PROTOCOL", "2");
	}

	public Session accept() throws IOException {
		server.setSoTimeout((int) STEP_TIMEOUT.toMillis());
		return new Session(server.accept());
	}

	/** Accepts, checks that the first line is a {@code hello}, and sends the {@code welcome} of the handshake fixture. */
	public Session acceptAndWelcome() throws IOException {
		Session session = accept();
		assertEquals("hello", session.readFrame().get("type").getAsString());
		session.sendFixture(Fixtures.only("handshake-ok.jsonl", Direction.LAUNCHER_TO_MOD));
		return session;
	}

	/** Accepts, reads the {@code hello} and closes without an answer, like a launcher that does not know the game yet. */
	public void refuseOneAttempt() throws IOException {
		try (Session refused = accept()) {
			refused.readLine();
		}
	}

	public void assertNoConnectionWithin(Duration window) throws IOException {
		server.setSoTimeout((int) window.toMillis());
		try {
			server.accept().close();
			fail("The mod connected although it should be waiting");
		} catch (SocketTimeoutException expected) {
			// Nobody came: that is what the test wants.
		}
	}

	@Override
	public void close() throws IOException {
		server.close();
	}

	/** One accepted connection. Every line it reads is also kept with its arrival time. */
	public static final class Session implements AutoCloseable {
		private final Socket socket;
		private final BufferedReader reader;
		private final OutputStream out;
		private final List<ReceivedLine> received = new ArrayList<>();

		private Session(Socket socket) throws IOException {
			this.socket = socket;
			socket.setSoTimeout((int) STEP_TIMEOUT.toMillis());
			reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
			out = socket.getOutputStream();
		}

		public record ReceivedLine(long nanos, String text) {
		}

		public String readLine() throws IOException {
			String line = reader.readLine();
			if (line != null) {
				received.add(new ReceivedLine(System.nanoTime(), line));
			}
			return line;
		}

		public JsonObject readFrame() throws IOException {
			return new JsonParser().parse(readLine()).getAsJsonObject();
		}

		/** The next frame that is not a {@code ping}: the mod pings whenever it has been idle. */
		public JsonObject readFrameSkippingPings() throws IOException {
			JsonObject frame = readFrame();
			while (frame.get("type").getAsString().equals("ping")) {
				frame = readFrame();
			}
			return frame;
		}

		/** Reads until a frame of that type arrives; pings and other frames in between are skipped. */
		public JsonObject readFrameOfType(String type) throws IOException {
			JsonObject frame = readFrame();
			while (!frame.get("type").getAsString().equals(type)) {
				frame = readFrame();
			}
			return frame;
		}

		public List<ReceivedLine> received() {
			return List.copyOf(received);
		}

		public void send(String line) throws IOException {
			out.write((line + "\n").getBytes(StandardCharsets.UTF_8));
			out.flush();
		}

		public void sendFixture(Line line) throws IOException {
			send(line.wire());
		}

		public void sendReject(RejectReason reason) throws IOException {
			send("{\"type\":\"reject\",\"reason\":\"" + WireNames.of(reason) + "\"}");
		}

		/** Answers a request with an empty result. */
		public void sendSuccess(String requestId) throws IOException {
			send("{\"type\":\"res\",\"id\":\"" + requestId + "\",\"ok\":true,\"result\":{}}");
		}

		/** The mod has closed the connection when reading yields the end. */
		public void assertClosedByMod() throws IOException {
			try {
				while (readLine() != null) {
					// Whatever the mod still wrote before closing does not matter.
				}
			} catch (SocketTimeoutException stillOpen) {
				fail("The mod did not close the connection within " + STEP_TIMEOUT);
			} catch (SocketException reset) {
				// Closing with unread data in the buffer shows up as a reset instead of a clean end.
			}
		}

		@Override
		public void close() throws IOException {
			socket.close();
		}
	}
}
