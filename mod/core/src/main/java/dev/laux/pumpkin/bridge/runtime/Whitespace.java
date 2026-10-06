package dev.laux.pumpkin.bridge.runtime;

/** The Unicode whitespace semantics of String.strip/isBlank, on Java 8. */
public final class Whitespace {
	private Whitespace() {
	}

	public static boolean isBlank(String text) {
		return firstVisible(text) == text.length();
	}

	public static String strip(String text) {
		int start = firstVisible(text);
		int end = lastVisibleEnd(text, start);
		return start == 0 && end == text.length() ? text : text.substring(start, end);
	}

	public static String stripTrailing(String text) {
		int end = lastVisibleEnd(text, 0);
		return end == text.length() ? text : text.substring(0, end);
	}

	private static int firstVisible(String text) {
		int index = 0;
		while (index < text.length()) {
			int codePoint = text.codePointAt(index);
			if (!Character.isWhitespace(codePoint)) {
				break;
			}
			index += Character.charCount(codePoint);
		}
		return index;
	}

	private static int lastVisibleEnd(String text, int start) {
		int index = text.length();
		while (index > start) {
			int codePoint = text.codePointBefore(index);
			if (!Character.isWhitespace(codePoint)) {
				break;
			}
			index -= Character.charCount(codePoint);
		}
		return index;
	}
}
