package dev.laux.pumpkin.bridge.modules.friends.ui.model;

import java.util.Objects;

import dev.laux.pumpkin.bridge.modules.friends.state.Me;

/**
 * The line the "Per Name" tab shows about the directory (docs/bridge/README.md, "In-game navigation and world behavior", mirroring the launcher's texts of BYNAME 9.7):
 * {@code active} says nothing, the other states explain themselves. Where friends-by-name cannot work right now, the
 * line comes with the "Im Launcher öffnen" action, because R-A has no code entry in-game.
 */
public final class DirectoryNotice {
	private final String key;
	private final boolean offersLauncherOpen;

	public DirectoryNotice(String key, boolean offersLauncherOpen) {
		this.key = key;
		this.offersLauncherOpen = offersLauncherOpen;
	}

	public String key() {
		return key;
	}

	public boolean offersLauncherOpen() {
		return offersLauncherOpen;
	}

	@Override
	public boolean equals(Object other) {
		if (this == other) {
			return true;
		}
		if (!(other instanceof DirectoryNotice)) {
			return false;
		}
		DirectoryNotice that = (DirectoryNotice) other;
		return Objects.equals(key, that.key)
			&& offersLauncherOpen == that.offersLauncherOpen;
	}

	@Override
	public int hashCode() {
		int hash = Objects.hashCode(key);
		hash = 31 * hash + Boolean.hashCode(offersLauncherOpen);
		return hash;
	}

	@Override
	public String toString() {
		return "DirectoryNotice[key=" + key + ", offersLauncherOpen=" + offersLauncherOpen + "]";
	}

	public static final DirectoryNotice NONE = new DirectoryNotice("", false);

	public static DirectoryNotice of(Me.Directory directory) {
		switch (directory) {
			case ACTIVE:
				return NONE;
			case OFF:
				return new DirectoryNotice("pumpkin_bridge.add.directory.off", false);
			case UNREACHABLE:
				return new DirectoryNotice("pumpkin_bridge.add.directory.unreachable", true);
			case NOT_ALLOWED:
				return new DirectoryNotice("pumpkin_bridge.add.directory.notAllowed", true);
			case UNAVAILABLE:
				return new DirectoryNotice("pumpkin_bridge.add.directory.unavailable", true);
			default:
				throw new IncompatibleClassChangeError();
		}
	}
}
