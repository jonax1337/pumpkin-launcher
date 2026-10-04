package dev.laux.pumpkin.friends.ui.model;

import java.util.Optional;

/** A widget whose state must survive a rebuild of the screen: an id that is stable across rebuilds, text, focus. */
public interface TrackedField {
	String id();

	/** The text a player typed, or empty for a widget that has none (a button). */
	Optional<String> text();

	void setText(String text);

	boolean isFocused();

	void focus();
}
