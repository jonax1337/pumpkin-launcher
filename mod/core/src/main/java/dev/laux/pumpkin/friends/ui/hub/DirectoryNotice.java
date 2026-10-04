package dev.laux.pumpkin.friends.ui.hub;

import dev.laux.pumpkin.friends.state.Me;

/**
 * The line the "Per Name" tab shows about the directory (INGAME 6.2, mirroring the launcher's texts of BYNAME 9.7):
 * {@code active} says nothing, the other states explain themselves. Where friends-by-name cannot work right now, the
 * line comes with the "Im Launcher öffnen" action, because R-A has no code entry in-game.
 */
public record DirectoryNotice(String key, boolean offersLauncherOpen) {
	public static final DirectoryNotice NONE = new DirectoryNotice("", false);

	public static DirectoryNotice of(Me.Directory directory) {
		return switch (directory) {
			case ACTIVE -> NONE;
			case OFF -> new DirectoryNotice("pumpkin_friends.add.directory.off", false);
			case UNREACHABLE -> new DirectoryNotice("pumpkin_friends.add.directory.unreachable", true);
			case NOT_ALLOWED -> new DirectoryNotice("pumpkin_friends.add.directory.notAllowed", true);
			case UNAVAILABLE -> new DirectoryNotice("pumpkin_friends.add.directory.unavailable", true);
		};
	}
}
