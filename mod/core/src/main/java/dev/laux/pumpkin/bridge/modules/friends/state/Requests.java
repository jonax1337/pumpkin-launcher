package dev.laux.pumpkin.bridge.modules.friends.state;

import java.util.Objects;
import dev.laux.pumpkin.bridge.runtime.Immutable;

import java.util.List;
import java.util.Optional;

/**
 * Friend requests in both directions. {@code retryCooldownMillis} is the launcher's remaining block after "Jetzt
 * zustellen" ({@code friends.retry}); zero when pressing again would act now (A27). The value counts from the moment
 * this push arrived, so {@link TopicStore#retryCooldownMillis(long)} is the live countdown.
 */
public final class Requests {
	private final List<Incoming> incoming;
	private final List<Outgoing> outgoing;
	private final long retryCooldownMillis;

	public Requests(List<Incoming> incoming, List<Outgoing> outgoing, long retryCooldownMillis) {
		incoming = Immutable.copyList(incoming);
		outgoing = Immutable.copyList(outgoing);
		this.incoming = incoming;
		this.outgoing = outgoing;
		this.retryCooldownMillis = retryCooldownMillis;
	}

	public List<Incoming> incoming() {
		return incoming;
	}

	public List<Outgoing> outgoing() {
		return outgoing;
	}

	public long retryCooldownMillis() {
		return retryCooldownMillis;
	}

	@Override
	public boolean equals(Object other) {
		if (this == other) {
			return true;
		}
		if (!(other instanceof Requests)) {
			return false;
		}
		Requests that = (Requests) other;
		return Objects.equals(incoming, that.incoming)
			&& Objects.equals(outgoing, that.outgoing)
			&& retryCooldownMillis == that.retryCooldownMillis;
	}

	@Override
	public int hashCode() {
		int hash = Objects.hashCode(incoming);
		hash = 31 * hash + Objects.hashCode(outgoing);
		hash = 31 * hash + Long.hashCode(retryCooldownMillis);
		return hash;
	}

	@Override
	public String toString() {
		return "Requests[incoming=" + incoming + ", outgoing=" + outgoing + ", retryCooldownMillis=" + retryCooldownMillis + "]";
	}

	public static final Requests NONE = new Requests(Immutable.list(), Immutable.list(), 0);


	public static final class Incoming {
		private final String id;
		private final String name;
		private final Optional<String> mcName;
		private final String fingerprint;

		public Incoming(String id, String name, Optional<String> mcName, String fingerprint) {
			this.id = id;
			this.name = name;
			this.mcName = mcName;
			this.fingerprint = fingerprint;
		}

		public String id() {
			return id;
		}

		public String name() {
			return name;
		}

		public Optional<String> mcName() {
			return mcName;
		}

		public String fingerprint() {
			return fingerprint;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Incoming)) {
				return false;
			}
			Incoming that = (Incoming) other;
			return Objects.equals(id, that.id)
				&& Objects.equals(name, that.name)
				&& Objects.equals(mcName, that.mcName)
				&& Objects.equals(fingerprint, that.fingerprint);
		}

		@Override
		public int hashCode() {
			int hash = Objects.hashCode(id);
			hash = 31 * hash + Objects.hashCode(name);
			hash = 31 * hash + Objects.hashCode(mcName);
			hash = 31 * hash + Objects.hashCode(fingerprint);
			return hash;
		}

		@Override
		public String toString() {
			return "Incoming[id=" + id + ", name=" + name + ", mcName=" + mcName + ", fingerprint=" + fingerprint + "]";
		}
	}

	public static final class Outgoing {
		private final String id;
		private final Optional<String> name;
		private final State state;

		public Outgoing(String id, Optional<String> name, State state) {
			this.id = id;
			this.name = name;
			this.state = state;
		}

		public String id() {
			return id;
		}

		public Optional<String> name() {
			return name;
		}

		public State state() {
			return state;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Outgoing)) {
				return false;
			}
			Outgoing that = (Outgoing) other;
			return Objects.equals(id, that.id)
				&& Objects.equals(name, that.name)
				&& Objects.equals(state, that.state);
		}

		@Override
		public int hashCode() {
			int hash = Objects.hashCode(id);
			hash = 31 * hash + Objects.hashCode(name);
			hash = 31 * hash + Objects.hashCode(state);
			return hash;
		}

		@Override
		public String toString() {
			return "Outgoing[id=" + id + ", name=" + name + ", state=" + state + "]";
		}
	}

	public enum State {
		DELIVERING,
		AWAITING_ANSWER
	}
}
