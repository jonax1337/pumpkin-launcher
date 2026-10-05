package dev.laux.pumpkin.friends.ui.model;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class PumpkinThemeTest {
	private final RecordingPainter painter = new RecordingPainter();

	@Test
	void pumpkinStaysInsideItsEightBySevenBox() {
		PumpkinTheme.paintPumpkin(painter, 0, 0);

		int maxX = 0;
		int maxY = 0;
		for (String call : painter.calls()) {
			String[] parts = call.split("[ ,x]");
			maxX = Math.max(maxX, Integer.parseInt(parts[1]) + Integer.parseInt(parts[3]));
			maxY = Math.max(maxY, Integer.parseInt(parts[2]) + Integer.parseInt(parts[4]));
		}
		assertEquals(PumpkinTheme.GLYPH_WIDTH, maxX);
		assertEquals(PumpkinTheme.GLYPH_HEIGHT, maxY);
	}
}
