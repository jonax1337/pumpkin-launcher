package dev.laux.pumpkin.bridge.ui.model;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

class CornerButtonLayoutTest {
	@Test
	void movesToTheOtherCornerRatherThanCoveringAnotherModsButton() {
		Rect occupied = new Rect(276, 190, 36, 36);
		Rect slot = CornerButtonLayout.find(320, 240, List.of(occupied)).orElseThrow();
		assertEquals(8, slot.x());
		assertEquals(190, slot.y());
	}

	@Test
	void leavesNativeMenuUsableWhenNeitherEdgeHasRoom() {
		assertTrue(CornerButtonLayout.find(320, 240, List.of(new Rect(0, 0, 320, 240))).isEmpty());
		assertTrue(CornerButtonLayout.find(40, 40, List.of()).isEmpty());
	}

	@Test
	void keepsTheEntryInsideTheViewportAfterGuiScaleChanges() {
		Rect slot = CornerButtonLayout.find(240, 120, List.of(new Rect(60, 30, 100, 60))).orElseThrow();
		assertTrue(slot.x() >= 0 && slot.y() >= 0 && slot.right() <= 240 && slot.bottom() <= 120);
		assertTrue(slot.right() <= 60 || slot.x() >= 160 || slot.bottom() <= 30 || slot.y() >= 90);
	}
}
