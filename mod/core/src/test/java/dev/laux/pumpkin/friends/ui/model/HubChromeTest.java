package dev.laux.pumpkin.friends.ui.model;

import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** What the layout classes ask a painter to draw, checked with a recording painter. */
class HubChromeTest {
	private final RecordingPainter painter = new RecordingPainter();
	private final HubLayout layout = HubLayout.of(320, 240, 0);

	@Test
	void headerCentresTitleAndStatusInTheirLines() {
		new HubChrome().paintHeader(painter, layout, "Friends", "Connected");

		// 7 glyphs of 6 px centre at x = 10 + (300 - 42) / 2; a 9 px font in a 10 px line starts at the line top.
		assertTrue(painter.calls().get(0).startsWith("text 'Friends' at 139,6 "));
		assertTrue(painter.calls().get(1).startsWith("text 'Connected' at 133,18 "));
	}

	@Test
	void headerClipsATitleThatIsTooWide() {
		new HubChrome().paintHeader(painter, layout, "x".repeat(60), "");

		String clipped = "x".repeat(49) + "…";
		assertTrue(painter.calls().get(0).startsWith("text '" + clipped + "' at 10,6 "));
	}

	@Test
	void rowTextIsClippedBeforeTheActionAndSecondLineKeepsItsPosition() {
		Rect row = new Rect(0, 0, 100, GuiMetrics.TWO_LINE_ROW_HEIGHT);
		RowLayout inside = RowLayout.of(row, true, List.of(40));

		RowPainter.paint(painter, inside, RowStyle.HEADING, "A long friend name", Optional.of("Playing"));

		// The text area is 4..52 = 48 px = 8 glyphs, so six characters (the trailing space is dropped) and the ellipsis remain.
		assertTrue(painter.calls().get(0).startsWith("text 'A long…' at 4,5 "));
		assertTrue(painter.calls().get(1).startsWith("text 'Playing' at 4,21 "));
	}
}
