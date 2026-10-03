package dev.laux.pumpkin.friends.bridge;

import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;
import dev.laux.pumpkin.friends.bridge.Messages.ErrorReport;
import dev.laux.pumpkin.friends.bridge.Messages.Inbound;
import dev.laux.pumpkin.friends.bridge.Messages.Notify;
import dev.laux.pumpkin.friends.bridge.Messages.Outbound;
import dev.laux.pumpkin.friends.bridge.Messages.Pong;
import dev.laux.pumpkin.friends.bridge.Messages.Reject;
import dev.laux.pumpkin.friends.bridge.Messages.SnapshotUpdate;
import dev.laux.pumpkin.friends.bridge.Messages.Welcome;
import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Optional;

/** JSON-Zeilen der Mod-Brücke (SPEC 7): ein Objekt mit {@code type} pro Zeile, höchstens 16 KiB. */
public final class Protocol {
	public static final int VERSION = 1;
	public static final int MAX_LINE_BYTES = 16 * 1024;

	private static final Gson GSON = new Gson();
	private static final Map<String, Class<? extends Inbound>> INBOUND_TYPES = Map.of(
		"welcome", Welcome.class,
		"reject", Reject.class,
		"snapshot", SnapshotUpdate.class,
		"notify", Notify.class,
		"error", ErrorReport.class,
		"pong", Pong.class);

	private Protocol() {
	}

	public static String encode(Outbound message) {
		JsonObject line = new JsonObject();
		line.addProperty("type", message.type());
		GSON.toJsonTree(message).getAsJsonObject().asMap().forEach(line::add);
		return GSON.toJson(line);
	}

	/** Unbekannte Typen und kaputte Zeilen ergeben ein leeres Ergebnis; der Launcher ist nicht vertrauenswürdig. */
	public static Optional<Inbound> decode(String line) {
		try {
			JsonObject json = JsonParser.parseString(line).getAsJsonObject();
			return typeOf(json).map(INBOUND_TYPES::get).map(type -> GSON.fromJson(json, type));
		} catch (RuntimeException malformed) {
			// Gson meldet Syntax-, Typ- und Konstruktorfehler mit verschiedenen RuntimeExceptions.
			return Optional.empty();
		}
	}

	private static Optional<String> typeOf(JsonObject json) {
		JsonElement type = json.get("type");
		if (type instanceof JsonPrimitive primitive && primitive.isString()) {
			return Optional.of(primitive.getAsString());
		}
		return Optional.empty();
	}

	/** Liest eine Zeile ohne Zeilenende; bricht ab, bevor mehr als {@link #MAX_LINE_BYTES} gepuffert werden. */
	public static String readLine(InputStream in) throws IOException {
		ByteArrayOutputStream line = new ByteArrayOutputStream();
		for (int next = in.read(); next != '\n'; next = in.read()) {
			if (next < 0) {
				throw new EOFException("Launcher hat die Verbindung geschlossen");
			}
			if (line.size() == MAX_LINE_BYTES) {
				throw new OversizedLineException();
			}
			line.write(next);
		}
		return line.toString(StandardCharsets.UTF_8);
	}

	public static final class OversizedLineException extends IOException {
		OversizedLineException() {
			super("Zeile vom Launcher ist länger als " + MAX_LINE_BYTES + " Bytes");
		}
	}
}
