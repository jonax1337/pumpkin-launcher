package dev.laux.pumpkin.friends.ui.hub;

import java.util.Optional;

/**
 * The input of the "Per Name" tab (BYNAME 9.3): a Minecraft name is one to sixteen characters of letters, digits and
 * the underscore. The shape check runs in the game before anything is sent, so an invalid name needs no launcher round
 * trip.
 */
public final class AddFriendForm {
	public static final int NAME_MAX_LENGTH = 16;

	private String typed = "";

	public static boolean isMcName(String candidate) {
		return candidate.matches("[A-Za-z0-9_]{1," + NAME_MAX_LENGTH + "}");
	}

	public void edit(String text) {
		typed = text;
	}

	public String typed() {
		return typed;
	}

	/** The name to send: the trimmed input, or nothing when the field is blank. */
	public Optional<String> nameToSend() {
		String trimmed = typed.trim();
		return trimmed.isEmpty() ? Optional.empty() : Optional.of(trimmed);
	}
}
