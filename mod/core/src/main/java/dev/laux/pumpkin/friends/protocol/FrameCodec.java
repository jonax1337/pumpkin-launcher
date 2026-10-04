package dev.laux.pumpkin.friends.protocol;

import com.google.gson.JsonObject;
import dev.laux.pumpkin.friends.json.JsonFields;
import dev.laux.pumpkin.friends.json.MalformedJson;
import dev.laux.pumpkin.friends.protocol.LauncherFrame.Closing;
import dev.laux.pumpkin.friends.protocol.LauncherFrame.Notify;
import dev.laux.pumpkin.friends.protocol.LauncherFrame.Pending;
import dev.laux.pumpkin.friends.protocol.LauncherFrame.Ping;
import dev.laux.pumpkin.friends.protocol.LauncherFrame.Pong;
import dev.laux.pumpkin.friends.protocol.LauncherFrame.Reject;
import dev.laux.pumpkin.friends.protocol.LauncherFrame.Response;
import dev.laux.pumpkin.friends.protocol.LauncherFrame.State;
import dev.laux.pumpkin.friends.protocol.LauncherFrame.Welcome;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;

/** Turns frames into JSON lines and back. Whatever does not match the protocol exactly is dropped: the launcher channel is untrusted. */
public final class FrameCodec {
	private static final Map<String, Function<JsonFields, LauncherFrame>> READERS = Map.of(
		"welcome", FrameCodec::welcome,
		"reject", fields -> new Reject(fields.enumValue("reason", RejectReason.class)),
		"res", FrameCodec::response,
		"pending", FrameCodec::pending,
		"state", FrameCodec::state,
		"event", FrameCodec::event,
		"ping", fields -> new Ping(),
		"pong", fields -> new Pong());

	private FrameCodec() {
	}

	/** The line without its line ending. */
	public static String encode(ModFrame frame) {
		JsonObject line = new JsonObject();
		line.addProperty("type", frame.type());
		frame.writeMembers(line);
		return line.toString();
	}

	public static Optional<LauncherFrame> decode(String line) {
		try {
			JsonFields fields = JsonFields.parseLine(line);
			Function<JsonFields, LauncherFrame> reader = READERS.get(fields.string("type"));
			return Optional.ofNullable(reader).map(read -> read.apply(fields));
		} catch (MalformedJson malformed) {
			return Optional.empty();
		}
	}

	private static LauncherFrame welcome(JsonFields fields) {
		JsonFields scopes = fields.object("scopes");
		return new Welcome(fields.integer("protocol"), fields.string("launcher"),
			new Scopes(scopes.enumValue("share", ScopeState.class), scopes.enumValue("social", ScopeState.class)));
	}

	private static LauncherFrame response(JsonFields fields) {
		String id = requestId(fields);
		if (fields.bool("ok")) {
			return new Response(id, Optional.of(fields.optionalObject("result").orElseGet(() -> JsonFields.of(new JsonObject()))),
				Optional.empty());
		}
		JsonFields error = fields.object("error");
		Map<String, String> params = error.optionalObject("params").map(JsonFields::textMembers).orElse(Map.of());
		return new Response(id, Optional.empty(), Optional.of(new OpError(ErrorCode.fromWire(error.string("code")), params)));
	}

	private static LauncherFrame pending(JsonFields fields) {
		if (!"scope".equals(fields.string("prompt"))) {
			throw new MalformedJson("unknown prompt");
		}
		return new Pending(requestId(fields), fields.enumValue("scope", Scope.class));
	}

	private static LauncherFrame state(JsonFields fields) {
		return new State(fields.enumValue("topic", Topic.class), fields.number("rev"), fields.element("value"));
	}

	private static LauncherFrame event(JsonFields fields) {
		switch (fields.string("event")) {
			case "notify":
				return new Notify(fields.enumValue("kind", NotifyKind.class), fields.optionalString("name"));
			case "closing":
				return new Closing(fields.enumValue("reason", ClosingReason.class));
			default:
				throw new MalformedJson("unknown event");
		}
	}

	private static String requestId(JsonFields fields) {
		String id = fields.string("id");
		if (!Protocol.isValidRequestId(id)) {
			throw new MalformedJson("invalid request id");
		}
		return id;
	}
}
