package dev.laux.pumpkin.bridge.modules.friends.state;

import java.util.Objects;

/** A blocked person, addressed by the alias {@code id}. */
public final class Blocked {
	private final String id;
	private final String name;

	public Blocked(String id, String name) {
		this.id = id;
		this.name = name;
	}

	public String id() {
		return id;
	}

	public String name() {
		return name;
	}

	@Override
	public boolean equals(Object other) {
		if (this == other) {
			return true;
		}
		if (!(other instanceof Blocked)) {
			return false;
		}
		Blocked that = (Blocked) other;
		return Objects.equals(id, that.id)
			&& Objects.equals(name, that.name);
	}

	@Override
	public int hashCode() {
		int hash = Objects.hashCode(id);
		hash = 31 * hash + Objects.hashCode(name);
		return hash;
	}

	@Override
	public String toString() {
		return "Blocked[id=" + id + ", name=" + name + "]";
	}
}
