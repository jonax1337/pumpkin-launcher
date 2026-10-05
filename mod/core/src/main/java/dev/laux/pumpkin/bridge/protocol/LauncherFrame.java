package dev.laux.pumpkin.bridge.protocol;

import com.google.gson.JsonElement;
import dev.laux.pumpkin.bridge.protocol.json.JsonFields;
import java.util.Optional;

/** What the launcher sends to the mod, already checked for shape but not yet sanitised: texts in it are player-controlled. */
public sealed interface LauncherFrame {
	record Welcome(int protocol, String launcher, Scopes scopes) implements LauncherFrame {
	}

	record Reject(RejectReason reason) implements LauncherFrame {
	}

	/** The answer to a request: exactly one of {@code result} and {@code error} is present. */
	record Response(String id, Optional<JsonFields> result, Optional<OpError> error) implements LauncherFrame {
	}

	/** A dialog in the launcher is open; the final answer follows. */
	record Pending(String id, Scope scope) implements LauncherFrame {
	}

	/** The whole value of one topic with its revision; {@code value} may be JSON null. */
	record State(Topic topic, long rev, JsonElement value) implements LauncherFrame {
	}

	record Notify(NotifyKind kind, Optional<String> name) implements LauncherFrame {
	}

	record Closing(ClosingReason reason) implements LauncherFrame {
	}

	record Ping() implements LauncherFrame {
	}

	record Pong() implements LauncherFrame {
	}
}
