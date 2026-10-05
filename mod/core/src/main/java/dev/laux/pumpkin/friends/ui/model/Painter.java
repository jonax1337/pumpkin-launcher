package dev.laux.pumpkin.friends.ui.model;

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

	default void scrollbar(Rect track, Rect thumb) {
		fill(track, PumpkinTheme.SUNK);
		fill(thumb, PumpkinTheme.ACCENT);
	}

	/** Everything until {@link #endClip()} stays inside {@code area}; a painter without clipping ignores it. */
	default void beginClip(Rect area) {
	}

	default void endClip() {
	}
}
