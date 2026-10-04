package dev.laux.pumpkin.friends.ui.model;

import java.util.function.IntUnaryOperator;

/** Clips text to a pixel width with an ellipsis. The width function is the game's font; core never sees a font. */
public final class Fit {
	static final int ELLIPSIS_CODE_POINT = 0x2026;

	private Fit() {
	}

	/**
	 * Returns {@code text} if it fits, otherwise its longest prefix plus an ellipsis that fits, or an empty string if
	 * not even the ellipsis fits. {@code codePointWidth} maps one code point to its width in pixels.
	 */
	public static String clip(String text, int maxWidth, IntUnaryOperator codePointWidth) {
		int[] codePoints = text.codePoints().toArray();
		if (widthOf(codePoints, codePointWidth) <= maxWidth) {
			return text;
		}
		int budget = maxWidth - codePointWidth.applyAsInt(ELLIPSIS_CODE_POINT);
		if (budget < 0) {
			return "";
		}
		int fitting = 0;
		int used = 0;
		while (fitting < codePoints.length && used + codePointWidth.applyAsInt(codePoints[fitting]) <= budget) {
			used += codePointWidth.applyAsInt(codePoints[fitting]);
			fitting++;
		}
		return new String(codePoints, 0, fitting).stripTrailing() + new String(Character.toChars(ELLIPSIS_CODE_POINT));
	}

	private static int widthOf(int[] codePoints, IntUnaryOperator codePointWidth) {
		int width = 0;
		for (int codePoint : codePoints) {
			width += codePointWidth.applyAsInt(codePoint);
		}
		return width;
	}
}
