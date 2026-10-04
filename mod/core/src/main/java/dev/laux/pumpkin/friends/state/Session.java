package dev.laux.pumpkin.friends.state;

import java.util.List;

/** The world this game shares: its guests, addressed by the alias {@code id} of the friend. */
public record Session(List<Guest> guests) {
	public Session {
		guests = List.copyOf(guests);
	}

	public record Guest(String id, String name, State state) {
	}

	public enum State {
		INVITED,
		CONNECTED
	}
}
