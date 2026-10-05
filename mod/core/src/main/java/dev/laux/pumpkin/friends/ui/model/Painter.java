package dev.laux.pumpkin.friends.ui.model;

import java.util.Optional;

/**
 * What the layout classes need to draw. The compat layer implements it over the game's graphics object of the running
 * Minecraft version, tests implement it as a recorder. Colours are ARGB.
 */
public interface Painter {
	void fill(Rect area, int argb);

	default void fill(int x, int y, int width, int height, int argb) {
		fill(new Rect(x, y, width, height), argb);
	}

	/** Draws one line of plain text with its top-left corner at {@code (x, y)}, without shadow. */
	void text(String text, int x, int y, int argb);

	/**
	 * Draws one line of plain text with its top-left corner at {@code (x, y)}, with the drop shadow every vanilla
	 * screen draws; the game darkens the text's own colour for the shadow.
	 */
	default void text(String text, int x, int y, int argb, boolean shadow) {
		text(text, x, y, argb);
	}

	/**
	 * Draws a Minecraft face and hat, centered as a square inside {@code bounds}. A known UUID may resolve
	 * asynchronously; otherwise the game uses a vanilla default skin. Minecraft-free painters may omit heads.
	 */
	default void head(String name, Optional<String> uuid, Rect bounds) {
	}

	/** The width of one code point in pixels: the function {@link Fit} measures with. */
	int codePointWidth(int codePoint);

	int lineHeight();

	default int textWidth(String text) {
		int width = 0;
		for (int index = 0; index < text.length();) {
			int codePoint = text.codePointAt(index);
			width += codePointWidth(codePoint);
			index += Character.charCount(codePoint);
		}
		return width;
	}

	/** Everything until {@link #endClip()} stays inside {@code area}; a painter without clipping ignores it. */
	default void beginClip(Rect area) {
	}

	default void endClip() {
	}
}
