package dev.laux.pumpkin.bridge.protocol;

import java.util.Objects;

import com.google.gson.JsonElement;
import dev.laux.pumpkin.bridge.protocol.json.JsonFields;
import java.util.Optional;

/** What the launcher sends to the mod, already checked for shape but not yet sanitised: texts in it are player-controlled. */
public interface LauncherFrame {
	public static final class Welcome implements LauncherFrame {
		private final int protocol;
		private final String launcher;
		private final Scopes scopes;

		public Welcome(int protocol, String launcher, Scopes scopes) {
			this.protocol = protocol;
			this.launcher = launcher;
			this.scopes = scopes;
		}

		public int protocol() {
			return protocol;
		}

		public String launcher() {
			return launcher;
		}

		public Scopes scopes() {
			return scopes;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Welcome)) {
				return false;
			}
			Welcome that = (Welcome) other;
			return protocol == that.protocol
				&& Objects.equals(launcher, that.launcher)
				&& Objects.equals(scopes, that.scopes);
		}

		@Override
		public int hashCode() {
			int hash = Integer.hashCode(protocol);
			hash = 31 * hash + Objects.hashCode(launcher);
			hash = 31 * hash + Objects.hashCode(scopes);
			return hash;
		}

		@Override
		public String toString() {
			return "Welcome[protocol=" + protocol + ", launcher=" + launcher + ", scopes=" + scopes + "]";
		}
	}

	public static final class Reject implements LauncherFrame {
		private final RejectReason reason;

		public Reject(RejectReason reason) {
			this.reason = reason;
		}

		public RejectReason reason() {
			return reason;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Reject)) {
				return false;
			}
			Reject that = (Reject) other;
			return Objects.equals(reason, that.reason);
		}

		@Override
		public int hashCode() {
			int hash = Objects.hashCode(reason);
			return hash;
		}

		@Override
		public String toString() {
			return "Reject[reason=" + reason + "]";
		}
	}

	/** The answer to a request: exactly one of {@code result} and {@code error} is present. */
	public static final class Response implements LauncherFrame {
		private final String id;
		private final Optional<JsonFields> result;
		private final Optional<OpError> error;

		public Response(String id, Optional<JsonFields> result, Optional<OpError> error) {
			this.id = id;
			this.result = result;
			this.error = error;
		}

		public String id() {
			return id;
		}

		public Optional<JsonFields> result() {
			return result;
		}

		public Optional<OpError> error() {
			return error;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Response)) {
				return false;
			}
			Response that = (Response) other;
			return Objects.equals(id, that.id)
				&& Objects.equals(result, that.result)
				&& Objects.equals(error, that.error);
		}

		@Override
		public int hashCode() {
			int hash = Objects.hashCode(id);
			hash = 31 * hash + Objects.hashCode(result);
			hash = 31 * hash + Objects.hashCode(error);
			return hash;
		}

		@Override
		public String toString() {
			return "Response[id=" + id + ", result=" + result + ", error=" + error + "]";
		}
	}

	/** A dialog in the launcher is open; the final answer follows. */
	public static final class Pending implements LauncherFrame {
		private final String id;
		private final Scope scope;

		public Pending(String id, Scope scope) {
			this.id = id;
			this.scope = scope;
		}

		public String id() {
			return id;
		}

		public Scope scope() {
			return scope;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Pending)) {
				return false;
			}
			Pending that = (Pending) other;
			return Objects.equals(id, that.id)
				&& Objects.equals(scope, that.scope);
		}

		@Override
		public int hashCode() {
			int hash = Objects.hashCode(id);
			hash = 31 * hash + Objects.hashCode(scope);
			return hash;
		}

		@Override
		public String toString() {
			return "Pending[id=" + id + ", scope=" + scope + "]";
		}
	}

	/** The whole value of one topic with its revision; {@code value} may be JSON null. */
	public static final class State implements LauncherFrame {
		private final Topic topic;
		private final long rev;
		private final JsonElement value;

		public State(Topic topic, long rev, JsonElement value) {
			this.topic = topic;
			this.rev = rev;
			this.value = value;
		}

		public Topic topic() {
			return topic;
		}

		public long rev() {
			return rev;
		}

		public JsonElement value() {
			return value;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof State)) {
				return false;
			}
			State that = (State) other;
			return Objects.equals(topic, that.topic)
				&& rev == that.rev
				&& Objects.equals(value, that.value);
		}

		@Override
		public int hashCode() {
			int hash = Objects.hashCode(topic);
			hash = 31 * hash + Long.hashCode(rev);
			hash = 31 * hash + Objects.hashCode(value);
			return hash;
		}

		@Override
		public String toString() {
			return "State[topic=" + topic + ", rev=" + rev + ", value=" + value + "]";
		}
	}

	public static final class Notify implements LauncherFrame {
		private final NotifyKind kind;
		private final Optional<String> name;

		public Notify(NotifyKind kind, Optional<String> name) {
			this.kind = kind;
			this.name = name;
		}

		public NotifyKind kind() {
			return kind;
		}

		public Optional<String> name() {
			return name;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Notify)) {
				return false;
			}
			Notify that = (Notify) other;
			return Objects.equals(kind, that.kind)
				&& Objects.equals(name, that.name);
		}

		@Override
		public int hashCode() {
			int hash = Objects.hashCode(kind);
			hash = 31 * hash + Objects.hashCode(name);
			return hash;
		}

		@Override
		public String toString() {
			return "Notify[kind=" + kind + ", name=" + name + "]";
		}
	}

	public static final class Closing implements LauncherFrame {
		private final ClosingReason reason;

		public Closing(ClosingReason reason) {
			this.reason = reason;
		}

		public ClosingReason reason() {
			return reason;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Closing)) {
				return false;
			}
			Closing that = (Closing) other;
			return Objects.equals(reason, that.reason);
		}

		@Override
		public int hashCode() {
			int hash = Objects.hashCode(reason);
			return hash;
		}

		@Override
		public String toString() {
			return "Closing[reason=" + reason + "]";
		}
	}

	public static final class Ping implements LauncherFrame {
		public Ping() {
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Ping)) {
				return false;
			}
			return true;
		}

		@Override
		public int hashCode() {
			return 0;
		}

		@Override
		public String toString() {
			return "Ping[]";
		}
	}

	public static final class Pong implements LauncherFrame {
		public Pong() {
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Pong)) {
				return false;
			}
			return true;
		}

		@Override
		public int hashCode() {
			return 0;
		}

		@Override
		public String toString() {
			return "Pong[]";
		}
	}
}
