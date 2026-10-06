package dev.laux.pumpkin.bridge.modules.friends.state;

import java.util.Objects;

/** A friend code the player created; only its last characters are known here, {@code expiresAt} is Unix seconds. */
public final class Code {
	private final String id;
	private final String tail;
	private final long expiresAt;
	private final boolean used;

	public Code(String id, String tail, long expiresAt, boolean used) {
		this.id = id;
		this.tail = tail;
		this.expiresAt = expiresAt;
		this.used = used;
	}

	public String id() {
		return id;
	}

	public String tail() {
		return tail;
	}

	public long expiresAt() {
		return expiresAt;
	}

	public boolean used() {
		return used;
	}

	@Override
	public boolean equals(Object other) {
		if (this == other) {
			return true;
		}
		if (!(other instanceof Code)) {
			return false;
		}
		Code that = (Code) other;
		return Objects.equals(id, that.id)
			&& Objects.equals(tail, that.tail)
			&& expiresAt == that.expiresAt
			&& used == that.used;
	}

	@Override
	public int hashCode() {
		int hash = Objects.hashCode(id);
		hash = 31 * hash + Objects.hashCode(tail);
		hash = 31 * hash + Long.hashCode(expiresAt);
		hash = 31 * hash + Boolean.hashCode(used);
		return hash;
	}

	@Override
	public String toString() {
		return "Code[id=" + id + ", tail=" + tail + ", expiresAt=" + expiresAt + ", used=" + used + "]";
	}
}
