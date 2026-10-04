package dev.laux.pumpkin.friends.ui.model;

/**
 * What the layout classes need to draw. The compat layer implements it over the game's graphics object of the running
 * Minecraft version, tests implement it as a recorder. Colours are ARGB.
 */
public interface Painter {
	int SCROLLBAR_TRACK = 0x40FFFFFF;
	int SCROLLBAR_THUMB = 0xC0FFFFFF;

	void fill(Rect area, int argb);

	/** Draws one line of plain text with its top-left corner at {@code (x, y)}, without shadow. */
	void text(String text, int x, int y, int argb);

	/** The width of one code point in pixels: the function {@link Fit} measures with. */
	int codePointWidth(int codePoint);

	int lineHeight();

	default int textWidth(String text) {
		return text.codePoints().map(this::codePointWidth).sum();
	}

	default void scrollbar(Rect track, Rect thumb) {
		fill(track, SCROLLBAR_TRACK);
		fill(thumb, SCROLLBAR_THUMB);
	}
}
