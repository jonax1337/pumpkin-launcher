package dev.laux.pumpkin.friends.ui.model;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import org.junit.jupiter.api.Test;

class TabBarModelTest {
	@Test
	void staysOneRowFromThreeHundredPixelsUp() {
		TabBarModel bar = new TabBarModel(5, 300);

		assertEquals(1, bar.rows());
		assertEquals(GuiMetrics.BUTTON_HEIGHT, bar.height());
	}

	@Test
	void wrapsToTwoRowsBelowThreeHundredPixels() {
		TabBarModel bar = new TabBarModel(5, 299);

		assertEquals(2, bar.rows());
		assertEquals(2 * GuiMetrics.BUTTON_HEIGHT + GuiMetrics.TAB_GAP, bar.height());
	}

	@Test
	void everyRowFillsTheWholeWidthWithoutLeavingAPixel() {
		List<Rect> tabs = new TabBarModel(5, 299).tabs(10, 32);

		assertEquals(List.of(
			new Rect(10, 32, 99, 20), new Rect(111, 32, 98, 20), new Rect(211, 32, 98, 20),
			new Rect(10, 54, 149, 20), new Rect(161, 54, 148, 20)), tabs);
	}

	@Test
	void aSingleTabNeverWraps() {
		TabBarModel bar = new TabBarModel(1, 200);

		assertEquals(1, bar.rows());
		assertEquals(List.of(new Rect(0, 0, 200, 20)), bar.tabs(0, 0));
	}

	@Test
	void noTabsTakeNoSpace() {
		TabBarModel bar = new TabBarModel(0, 310);

		assertEquals(0, bar.height());
		assertEquals(List.of(), bar.tabs(0, 0));
	}
}
