package dev.laux.pumpkin.bridge.ui.model;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.function.IntUnaryOperator;
import org.junit.jupiter.api.Test;

class FitTest {
	private static final IntUnaryOperator SIX_PX_GLYPHS = codePoint -> 6;
	private static final String ELLIPSIS = new String(Character.toChars(Fit.ELLIPSIS_CODE_POINT));

	@Test
	void textThatFitsIsReturnedUnchanged() {
		assertEquals("Anna", Fit.clip("Anna", 100, SIX_PX_GLYPHS));
	}

	@Test
	void longTextIsCutAndEndsWithAnEllipsisThatStillFits() {
		assertEquals("Anna" + ELLIPSIS, Fit.clip("Annabelle", 30, SIX_PX_GLYPHS));
	}

	@Test
	void theCutNeverLeavesASpaceBeforeTheEllipsis() {
		assertEquals("Anna" + ELLIPSIS, Fit.clip("Anna Belle", 36, SIX_PX_GLYPHS));
	}

	@Test
	void anEmptyStringIsReturnedWhenNotEvenTheEllipsisFits() {
		assertEquals("", Fit.clip("Annabelle", 5, SIX_PX_GLYPHS));
	}

	@Test
	void anExactFitIsNotCut() {
		assertEquals("Anna", Fit.clip("Anna", 24, SIX_PX_GLYPHS));
	}

	@Test
	void aSurrogatePairIsMeasuredAndCutAsOneCodePoint() {
		String pumpkins = new String(Character.toChars(0x1F383)).repeat(4);

		String clipped = Fit.clip(pumpkins, 24, codePoint -> codePoint == Fit.ELLIPSIS_CODE_POINT ? 6 : 8);

		assertEquals(new String(Character.toChars(0x1F383)).repeat(2) + ELLIPSIS, clipped);
	}

	@Test
	void widthsOfDifferentGlyphsAreSummed() {
		IntUnaryOperator narrowI = codePoint -> codePoint == 'i' ? 2 : 6;

		assertEquals("iiiiiiii", Fit.clip("iiiiiiii", 16, narrowI));
		assertEquals("iiiiiii" + ELLIPSIS, Fit.clip("iiiiiiiiiii", 20, narrowI));
	}
}
