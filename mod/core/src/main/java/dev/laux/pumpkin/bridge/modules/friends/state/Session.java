package dev.laux.pumpkin.bridge.modules.friends.state;

import java.util.Objects;
import dev.laux.pumpkin.bridge.runtime.Immutable;

import java.util.List;

/** The world this game shares: its guests, addressed by the alias {@code id} of the friend. */
public final class Session {
	private final List<Guest> guests;

	public Session(List<Guest> guests) {
		guests = Immutable.copyList(guests);
		this.guests = guests;
	}

	public List<Guest> guests() {
		return guests;
	}

	@Override
	public boolean equals(Object other) {
		if (this == other) {
			return true;
		}
		if (!(other instanceof Session)) {
			return false;
		}
		Session that = (Session) other;
		return Objects.equals(guests, that.guests);
	}

	@Override
	public int hashCode() {
		int hash = Objects.hashCode(guests);
		return hash;
	}

	@Override
	public String toString() {
		return "Session[guests=" + guests + "]";
	}


	public static final class Guest {
		private final String id;
		private final String name;
		private final State state;

		public Guest(String id, String name, State state) {
			this.id = id;
			this.name = name;
			this.state = state;
		}

		public String id() {
			return id;
		}

		public String name() {
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
			if (!(other instanceof Guest)) {
				return false;
			}
			Guest that = (Guest) other;
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
			return "Guest[id=" + id + ", name=" + name + ", state=" + state + "]";
		}
	}

	public enum State {
		INVITED,
		CONNECTED
	}
}
