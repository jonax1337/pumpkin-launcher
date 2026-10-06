package dev.laux.pumpkin.bridge.modules.friends.state;

import java.util.Objects;

/** An invite from a friend; joining is decided in the launcher or with {@code invite.joinHere}. */
public final class Invite {
	private final String id;
	private final String fromName;
	private final String title;

	public Invite(String id, String fromName, String title) {
		this.id = id;
		this.fromName = fromName;
		this.title = title;
	}

	public String id() {
		return id;
	}

	public String fromName() {
		return fromName;
	}

	public String title() {
		return title;
	}

	@Override
	public boolean equals(Object other) {
		if (this == other) {
			return true;
		}
		if (!(other instanceof Invite)) {
			return false;
		}
		Invite that = (Invite) other;
		return Objects.equals(id, that.id)
			&& Objects.equals(fromName, that.fromName)
			&& Objects.equals(title, that.title);
	}

	@Override
	public int hashCode() {
		int hash = Objects.hashCode(id);
		hash = 31 * hash + Objects.hashCode(fromName);
		hash = 31 * hash + Objects.hashCode(title);
		return hash;
	}

	@Override
	public String toString() {
		return "Invite[id=" + id + ", fromName=" + fromName + ", title=" + title + "]";
	}
}
