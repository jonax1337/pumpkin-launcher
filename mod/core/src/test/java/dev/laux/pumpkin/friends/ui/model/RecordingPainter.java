package dev.laux.pumpkin.friends.ui.model;

import java.util.ArrayList;
import java.util.List;

/** A painter that only writes down what it was asked to draw; every code point is {@value #GLYPH_WIDTH} px wide. */
final class RecordingPainter implements Painter {
	static final int GLYPH_WIDTH = 6;
	static final int LINE_HEIGHT = 9;

	private final List<String> calls = new ArrayList<>();

	List<String> calls() {
		return calls;
	}

	@Override
	public void fill(Rect area, int argb) {
		calls.add("fill " + area + " " + hex(argb));
	}

	@Override
	public void text(String text, int x, int y, int argb) {
		calls.add("text '" + text + "' at " + x + "," + y + " " + hex(argb));
	}

	@Override
	public void text(String text, int x, int y, int argb, boolean shadow) {
		calls.add("text '" + text + "' at " + x + "," + y + " " + hex(argb) + (shadow ? " shadow" : ""));
	}

	@Override
	public int codePointWidth(int codePoint) {
		return GLYPH_WIDTH;
	}

	@Override
	public int lineHeight() {
		return LINE_HEIGHT;
	}

	private static String hex(int argb) {
		return String.format("#%08X", argb);
	}
}
