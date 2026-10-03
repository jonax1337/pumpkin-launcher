package dev.laux.pumpkin.friends;

import static org.junit.jupiter.api.Assertions.assertEquals;

import dev.laux.pumpkin.friends.state.Sanitize;
import java.util.Arrays;
import java.util.Optional;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/**
 * Die Regeln aus SPEC 12.3, gleich denen von {@code friends/sanitize.rs}. Unsichtbare Zeichen stehen als Codepunkte
 * im Test, damit der Quelltext selbst keine enthält.
 */
class SanitizeTest {
	private static final int SECTION_SIGN = 0xA7;
	private static final int RIGHT_TO_LEFT_OVERRIDE = 0x202E;
	private static final int ZERO_WIDTH_SPACE = 0x200B;
	private static final int LEFT_TO_RIGHT_ISOLATE = 0x2066;
	private static final int POP_DIRECTIONAL_ISOLATE = 0x2069;
	private static final int BYTE_ORDER_MARK = 0xFEFF;

	@Test
	void stripsTheFormattingSign() {
		assertEquals("cRedk", Sanitize.name(text(SECTION_SIGN) + "cRed" + text(SECTION_SIGN) + "k"));
	}

	@Test
	void removesBidiAndZeroWidthCharacters() {
		String raw = text(RIGHT_TO_LEFT_OVERRIDE) + "ev" + text(ZERO_WIDTH_SPACE) + "il"
			+ text(LEFT_TO_RIGHT_ISOLATE, POP_DIRECTIONAL_ISOLATE, BYTE_ORDER_MARK);
		assertEquals("evil", Sanitize.name(raw));
	}

	@Test
	void removesEveryListedCodePoint() {
		String listed = text(0x00AD, 0x061C, 0x180E, 0x200B, 0x200F, 0x2028, 0x202E, 0x2060, 0x2064, 0x2066, 0x206F,
			0xFEFF, 0xFFF9, 0xFFFB, 0xE0001, 0xE0020, 0xE007F);
		assertEquals("ab", Sanitize.name("a" + listed + "b"));
	}

	@Test
	void removesControlCharactersIncludingTabsAndNewlines() {
		assertEquals("abc", Sanitize.name("a" + text('\t') + "b" + text('\n') + "c" + text(0x00, 0x7F, 0x85)));
	}

	@Test
	void collapsesWhitespaceRunsAndTrims() {
		String raw = text(' ', ' ') + "Alex" + text(' ', 0x00A0, 0x2003, ' ') + "Smith" + text(' ', 0x3000);
		assertEquals("Alex Smith", Sanitize.name(raw));
	}

	@Test
	void normalizesToNfc() {
		assertEquals(text(0x00E9), Sanitize.name("e" + text(0x0301)));
	}

	@ParameterizedTest
	@CsvSource({"32, 32", "33, 32"})
	void capsNamesAtThirtyTwoCodePoints(int length, int expected) {
		String capped = Sanitize.name(text(0x1F383).repeat(length));
		assertEquals(expected, capped.codePointCount(0, capped.length()));
	}

	@Test
	void capsTitlesAtSixtyFourCodePoints() {
		assertEquals("t".repeat(64), Sanitize.title("t".repeat(65)));
	}

	@Test
	void treatsAMissingValueAsEmpty() {
		assertEquals("", Sanitize.name(null));
	}

	@ParameterizedTest
	@CsvSource(value = {
		"0123456789abcdef0123456789abcdef, true",
		"0123456789ABCDEF0123456789ABCDEF, false",
		"01234567-89ab-cdef-0123-456789abcdef, false",
		"0123456789abcdef0123456789abcde, false",
		"NULL, false"}, nullValues = "NULL")
	void acceptsOnlyThirtyTwoLowercaseHexAsMcUuid(String raw, boolean valid) {
		assertEquals(valid ? Optional.of(raw) : Optional.empty(), Sanitize.mcUuid(raw));
	}

	private static String text(int... codePoints) {
		return Arrays.stream(codePoints).mapToObj(Character::toString).collect(Collectors.joining());
	}
}
