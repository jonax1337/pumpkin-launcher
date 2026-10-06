package dev.laux.pumpkin.bridge.transport;

import java.util.Objects;

import dev.laux.pumpkin.bridge.protocol.Protocol;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * Verbindungsdaten, die der Launcher nur über die Umgebung des Spielprozesses übergibt (SPEC 7.1). Fehlt ein Wert
 * oder ist er ungültig, wurde das Spiel nicht vom Launcher mit aktivierten Freunden gestartet.
 */
public final class BridgeEnv {
	private final int port;
	private final String token;

	public BridgeEnv(int port, String token) {
		this.port = port;
		this.token = token;
	}

	public int port() {
		return port;
	}

	public String token() {
		return token;
	}

	@Override
	public boolean equals(Object other) {
		if (this == other) {
			return true;
		}
		if (!(other instanceof BridgeEnv)) {
			return false;
		}
		BridgeEnv that = (BridgeEnv) other;
		return port == that.port
			&& Objects.equals(token, that.token);
	}

	@Override
	public int hashCode() {
		int hash = Integer.hashCode(port);
		hash = 31 * hash + Objects.hashCode(token);
		return hash;
	}


	static final String PORT_VARIABLE = "PUMPKIN_IPC_PORT";
	static final String TOKEN_VARIABLE = "PUMPKIN_IPC_TOKEN";
	static final String PROTOCOL_VARIABLE = "PUMPKIN_IPC_PROTOCOL";

	private static final Pattern PORT = Pattern.compile("[1-9][0-9]{0,4}");
	private static final Pattern TOKEN = Pattern.compile("[0-9a-f]{64}");
	private static final int MAX_PORT = 65_535;

	public static Optional<BridgeEnv> from(Map<String, String> environment) {
		String port = environment.getOrDefault(PORT_VARIABLE, "");
		String token = environment.getOrDefault(TOKEN_VARIABLE, "");
		String protocol = environment.getOrDefault(PROTOCOL_VARIABLE, "");
		if (!isValidPort(port) || !TOKEN.matcher(token).matches() || !isSupported(protocol)) {
			return Optional.empty();
		}
		return Optional.of(new BridgeEnv(Integer.parseInt(port), token));
	}

	// Das Token darf nie in einem Log landen (SPEC 12.1).
	@Override
	public String toString() {
		return "BridgeEnv[port=" + port + "]";
	}

	private static boolean isValidPort(String port) {
		return PORT.matcher(port).matches() && Integer.parseInt(port) <= MAX_PORT;
	}

	private static boolean isSupported(String protocol) {
		return protocol.equals(String.valueOf(Protocol.VERSION));
	}
}
