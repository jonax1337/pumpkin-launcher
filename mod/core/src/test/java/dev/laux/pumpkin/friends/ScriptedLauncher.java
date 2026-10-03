package dev.laux.pumpkin.friends;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
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
import java.util.Map;

/** Spielt die Launcher-Seite von SPEC 7 nach Drehbuch: lauscht auf Loopback und spricht JSON-Zeilen. */
final class ScriptedLauncher implements AutoCloseable {
	static final String TOKEN = "ab".repeat(32);
	private static final Duration STEP_TIMEOUT = Duration.ofSeconds(5);

	private final ServerSocket server;

	ScriptedLauncher() throws IOException {
		server = new ServerSocket(0, 8, InetAddress.getLoopbackAddress());
	}

	Map<String, String> environment() {
		return Map.of(
			"PUMPKIN_IPC_PORT", String.valueOf(server.getLocalPort()),
			"PUMPKIN_IPC_TOKEN", TOKEN,
			"PUMPKIN_IPC_PROTOCOL", "1");
	}

	Connection accept() throws IOException {
		server.setSoTimeout((int) STEP_TIMEOUT.toMillis());
		return new Connection(server.accept());
	}

	/** Nimmt die Verbindung an, prüft das {@code hello} und begrüßt die Mod. */
	Connection acceptAndWelcome() throws IOException {
		Connection connection = accept();
		assertEquals("hello", connection.readMessage().get("type").getAsString());
		connection.send("{\"type\":\"welcome\",\"protocol\":1,\"launcher\":\"0.2.0\"}");
		return connection;
	}

	void assertNoConnectionWithin(Duration window) throws IOException {
		server.setSoTimeout((int) window.toMillis());
		assertThrows(SocketTimeoutException.class, server::accept);
	}

	@Override
	public void close() throws IOException {
		server.close();
	}

	static final class Connection implements AutoCloseable {
		private final Socket socket;
		private final BufferedReader reader;
		private final OutputStream out;

		private Connection(Socket socket) throws IOException {
			this.socket = socket;
			socket.setSoTimeout((int) STEP_TIMEOUT.toMillis());
			reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
			out = socket.getOutputStream();
		}

		String readLine() throws IOException {
			return reader.readLine();
		}

		JsonObject readMessage() throws IOException {
			return JsonParser.parseString(readLine()).getAsJsonObject();
		}

		/** Nächste Nachricht außer {@code ping}; Pings kommen je nach Takt dazwischen. */
		String readLineSkippingPings() throws IOException {
			String line = readLine();
			while (line != null && line.equals("{\"type\":\"ping\"}")) {
				line = readLine();
			}
			return line;
		}

		void send(String line) throws IOException {
			out.write((line + "\n").getBytes(StandardCharsets.UTF_8));
			out.flush();
		}

		/** Die Mod hat die Verbindung geschlossen, wenn das Lesen das Ende liefert. */
		void assertClosedByMod() throws IOException {
			try {
				assertNull(readLineSkippingPings());
			} catch (SocketException reset) {
				// Schließt die Mod mit ungelesenen Daten im Puffer, kommt ein RST statt eines FIN an.
			}
		}

		@Override
		public void close() throws IOException {
			socket.close();
		}
	}
}
