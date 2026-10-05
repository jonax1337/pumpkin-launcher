package dev.laux.pumpkin.bridge.modules.friends.ui.model;

import static org.junit.jupiter.api.Assertions.assertEquals;

import dev.laux.pumpkin.bridge.ui.model.Fit;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * The word wrap for sentences a screen draws over several rows (INGAME 6.2): the hint of the name tab, the question of
 * a ConfirmFlow. Widths come from an injected measure, as in the screens.
 */
class FitWrapTest {
	private static final int GLYPH_WIDTH = 6;

	private static int width(String text) {
		return text.codePointCount(0, text.length()) * GLYPH_WIDTH;
	}

	@Test
	void aFittingSentenceIsOneLine() {
		assertEquals(List.of("ein Satz der passt"), Fit.wrap("ein Satz der passt", 18 * GLYPH_WIDTH, FitWrapTest::width));
	}

	@Test
	void wordsMoveToTheNextLineWhenTheyNoLongerFit() {
		List<String> lines = Fit.wrap("Die andere Person sieht deinen Namen", 6 * GLYPH_WIDTH, FitWrapTest::width);

		assertEquals(List.of("Die", "andere", "Person", "sieht", "deinen", "Namen"), lines);
	}

	@Test
	void asManyWordsAsFitShareALine() {
		List<String> lines = Fit.wrap("a bb ccc dd", 4 * GLYPH_WIDTH, FitWrapTest::width);

		assertEquals(List.of("a bb", "ccc", "dd"), lines);
	}

	@Test
	void aWordLongerThanTheWidthIsSplitAtTheBorder() {
		List<String> lines = Fit.wrap("Donaudampfschifffahrt", 4 * GLYPH_WIDTH, FitWrapTest::width);

		assertEquals(List.of("Dona", "udam", "pfsc", "hiff", "fahr", "t"), lines);
	}

	@Test
	void aLongWordSharesTheLastPartOfItsLine() {
		List<String> lines = Fit.wrap("ein Donaudampfschiff", 7 * GLYPH_WIDTH, FitWrapTest::width);

		assertEquals(List.of("ein", "Donauda", "mpfschi", "ff"), lines);
	}

	@Test
	void blankTextIsOneEmptyLine() {
		assertEquals(List.of(""), Fit.wrap("", 30, FitWrapTest::width));
	}
}
