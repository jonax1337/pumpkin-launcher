package dev.laux.pumpkin.bridge.ui.model;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class HomeLayoutTest {
	@Test
	void wrapsModuleTilesOnNarrowGuiWithoutOverlappingTheFooter() {
		HomeLayout layout = HomeLayout.of(320, 240, 2);
		Rect first = layout.tiles().get(0);
		Rect second = layout.tiles().get(1);
		assertEquals(first.x(), second.x());
		assertTrue(first.bottom() < second.y());
		assertTrue(second.bottom() < layout.chrome().footer().y());
		assertTrue(second.right() <= layout.chrome().body().right());
	}

	@Test
	void usesSeparateColumnsWhenThereIsRoom() {
		HomeLayout layout = HomeLayout.of(854, 480, 2);
		Rect first = layout.tiles().get(0);
		Rect second = layout.tiles().get(1);
		assertEquals(first.y(), second.y());
		assertTrue(first.right() < second.x());
		assertTrue(second.right() < layout.chrome().body().right());
	}
}
