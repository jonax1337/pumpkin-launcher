package dev.laux.pumpkin.friends.ui.model;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class RowLayoutTest {
	private static final Rect SINGLE = new Rect(10, 100, 294, GuiMetrics.ROW_HEIGHT);
	private static final Rect DOUBLE = new Rect(10, 100, 294, GuiMetrics.TWO_LINE_ROW_HEIGHT);

	@Test
	void aRowWithoutActionsGivesTheTextTheWholeWidthMinusPadding() {
		RowLayout inside = RowLayout.of(SINGLE, false, List.of());

		assertEquals(new Rect(14, 100, 286, 24), inside.firstLine());
		assertEquals(Optional.empty(), inside.secondLine());
		assertEquals(List.of(), inside.actions());
	}

	@Test
	void actionsAreRightAlignedInTheOrderTheyAppearAndCentredVertically() {
		RowLayout inside = RowLayout.of(SINGLE, false, List.of(50, 20));

		assertEquals(List.of(new Rect(226, 102, 50, 20), new Rect(280, 102, 20, 20)), inside.actions());
	}

	@Test
	void theTextStopsBeforeTheLeftmostAction() {
		RowLayout inside = RowLayout.of(SINGLE, false, List.of(50, 20));

		assertEquals(new Rect(14, 100, 208, 24), inside.firstLine());
	}

	@Test
	void aTwoLineRowStacksTwoTwelvePixelLinesWithFourPixelsAround() {
		RowLayout inside = RowLayout.of(DOUBLE, true, List.of(60));

		assertEquals(new Rect(14, 104, 222, 12), inside.firstLine());
		assertEquals(Optional.of(new Rect(14, 120, 222, 12)), inside.secondLine());
		assertEquals(List.of(new Rect(240, 108, 60, 20)), inside.actions());
	}

	@Test
	void actionsWiderThanTheRowLeaveNoTextWidthButNeverANegativeOne() {
		RowLayout inside = RowLayout.of(new Rect(0, 0, 40, 24), false, List.of(60));

		assertEquals(0, inside.firstLine().width());
	}
}
