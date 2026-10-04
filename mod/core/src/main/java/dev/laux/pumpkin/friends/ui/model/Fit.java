package dev.laux.pumpkin.friends.ui.model;

import java.util.ArrayList;
import java.util.List;
import java.util.function.IntUnaryOperator;
import java.util.function.ToIntFunction;

/** Clips and wraps text to a pixel width. The width function is the game's font; core never sees a font. */
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

	/**
	 * Greedy word wrap to a pixel width, for sentences a screen draws over several rows (INGAME 6.2): words go to the
	 * current line while they fit, a word longer than the whole width is split at the border. Blank text wraps to one
	 * empty line.
	 */
	public static List<String> wrap(String text, int maxWidth, ToIntFunction<String> widthOf) {
		List<String> lines = new ArrayList<>();
		StringBuilder line = new StringBuilder();
		for (String word : text.split(" ")) {
			for (String chunk : chunksOf(word, maxWidth, widthOf)) {
				if (line.length() == 0) {
					line.append(chunk);
				} else if (widthOf.applyAsInt(line + " " + chunk) <= maxWidth) {
					line.append(' ').append(chunk);
				} else {
					lines.add(line.toString());
					line.setLength(0);
					line.append(chunk);
				}
			}
		}
		if (line.length() > 0) {
			lines.add(line.toString());
		}
		return lines.isEmpty() ? List.of("") : lines;
	}

	/** The pieces of a word that each fit; a fitting word is one piece. */
	private static List<String> chunksOf(String word, int maxWidth, ToIntFunction<String> widthOf) {
		if (word.isEmpty() || widthOf.applyAsInt(word) <= maxWidth) {
			return List.of(word);
		}
		List<String> chunks = new ArrayList<>();
		StringBuilder chunk = new StringBuilder();
		for (int codePoint : word.codePoints().toArray()) {
			StringBuilder candidate = new StringBuilder(chunk).appendCodePoint(codePoint);
			if (chunk.length() > 0 && widthOf.applyAsInt(candidate.toString()) > maxWidth) {
				chunks.add(chunk.toString());
				chunk.setLength(0);
			}
			chunk.appendCodePoint(codePoint);
		}
		if (chunk.length() > 0) {
			chunks.add(chunk.toString());
		}
		return chunks;
	}
}
