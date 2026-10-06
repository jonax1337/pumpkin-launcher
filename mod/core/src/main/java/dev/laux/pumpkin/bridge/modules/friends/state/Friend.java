package dev.laux.pumpkin.bridge.modules.friends.state;

import java.util.Objects;

import java.util.Optional;

/**
 * A friend, addressed by the alias {@code id} of this link; {@code mcUuid} is 32 lowercase hex characters when known and
 * {@code notice} is the hint the launcher attached to the friend, if any.
 */
public final class Friend {
	private final String id;
	private final String name;
	private final Optional<String> mcUuid;
	private final Presence presence;
	private final Optional<FriendNotice> notice;

	public Friend(String id, String name, Optional<String> mcUuid, Presence presence, Optional<FriendNotice> notice) {
		this.id = id;
		this.name = name;
		this.mcUuid = mcUuid;
		this.presence = presence;
		this.notice = notice;
	}

	public String id() {
		return id;
	}

	public String name() {
		return name;
	}

	public Optional<String> mcUuid() {
		return mcUuid;
	}

	public Presence presence() {
		return presence;
	}

	public Optional<FriendNotice> notice() {
		return notice;
	}

	@Override
	public boolean equals(Object other) {
		if (this == other) {
			return true;
		}
		if (!(other instanceof Friend)) {
			return false;
		}
		Friend that = (Friend) other;
		return Objects.equals(id, that.id)
			&& Objects.equals(name, that.name)
			&& Objects.equals(mcUuid, that.mcUuid)
			&& Objects.equals(presence, that.presence)
			&& Objects.equals(notice, that.notice);
	}

	@Override
	public int hashCode() {
		int hash = Objects.hashCode(id);
		hash = 31 * hash + Objects.hashCode(name);
		hash = 31 * hash + Objects.hashCode(mcUuid);
		hash = 31 * hash + Objects.hashCode(presence);
		hash = 31 * hash + Objects.hashCode(notice);
		return hash;
	}

	@Override
	public String toString() {
		return "Friend[id=" + id + ", name=" + name + ", mcUuid=" + mcUuid + ", presence=" + presence + ", notice=" + notice + "]";
	}

	public enum Presence {
		OFFLINE,
		ONLINE,
		PLAYING
	}

	public boolean isOnline() {
		return presence != Presence.OFFLINE;
	}
}
