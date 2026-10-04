package dev.laux.pumpkin.friends.state;

import java.text.Normalizer;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * Bereinigt Texte vom Launcher nach denselben Regeln wie {@code friends/sanitize.rs} (SPEC 12.3). Der Launcher
 * bereinigt schon; die Mod wiederholt es, weil der Kanal als nicht vertrauenswürdig gilt.
 */
public final class Sanitize {
	public static final int NAME_MAX_CHARS = 32;
	public static final int TITLE_MAX_CHARS = 64;

	private static final Pattern MC_UUID = Pattern.compile("[0-9a-f]{32}");
	// White_Space ist dieselbe Unicode-Eigenschaft wie Rusts char::is_whitespace.
	private static final Pattern WHITESPACE_RUN = Pattern.compile("\\p{IsWhite_Space}+");
	private static final int[][] REMOVED_RANGES = {
		{0x00A7, 0x00A7}, {0x00AD, 0x00AD}, {0x061C, 0x061C}, {0x180E, 0x180E}, {0x200B, 0x200F},
		{0x2028, 0x202E}, {0x2060, 0x2064}, {0x2066, 0x206F}, {0xFEFF, 0xFEFF}, {0xFFF9, 0xFFFB},
		{0xE0001, 0xE0001}, {0xE0020, 0xE007F},
	};

	private Sanitize() {
	}

	public static String name(String raw) {
		return cap(clean(raw), NAME_MAX_CHARS);
	}

	public static String title(String raw) {
		return cap(clean(raw), TITLE_MAX_CHARS);
	}

	public static Optional<String> mcUuid(String raw) {
		return Optional.ofNullable(raw).filter(uuid -> MC_UUID.matcher(uuid).matches());
	}

	/** A relay host of the launcher's network line: launcher-chosen, still cleaned and capped like a title. */
	public static String host(String raw) {
		return cap(clean(raw), TITLE_MAX_CHARS);
	}

	private static String clean(String raw) {
		if (raw == null) {
			return "";
		}
		String visible = Normalizer.normalize(raw, Normalizer.Form.NFC).codePoints()
			.filter(codePoint -> !isRemoved(codePoint))
			.collect(StringBuilder::new, StringBuilder::appendCodePoint, StringBuilder::append)
			.toString();
		return WHITESPACE_RUN.matcher(visible).replaceAll(" ").strip();
	}

	private static boolean isRemoved(int codePoint) {
		if (Character.getType(codePoint) == Character.CONTROL) {
			return true;
		}
		for (int[] range : REMOVED_RANGES) {
			if (codePoint >= range[0] && codePoint <= range[1]) {
				return true;
			}
		}
		return false;
	}

	private static String cap(String text, int maxChars) {
		if (text.codePointCount(0, text.length()) <= maxChars) {
			return text;
		}
		return text.substring(0, text.offsetByCodePoints(0, maxChars));
	}
}
