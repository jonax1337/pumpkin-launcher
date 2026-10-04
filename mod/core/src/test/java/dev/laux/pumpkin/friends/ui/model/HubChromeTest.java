package dev.laux.pumpkin.friends.ui.model;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** What the layout classes ask a painter to draw, checked with a recording painter. */
class HubChromeTest {
	private final RecordingPainter painter = new RecordingPainter();
	private final HubLayout layout = HubLayout.of(320, 240, 0);

	@Test
	void backdropFillsTheBody() {
		HubChrome.paintBackdrop(painter, layout);

		assertEquals(List.of("fill 10,32 300x176 #70000000"), painter.calls());
	}

	@Test
	void headerCentresTitleAndStatusInTheirLines() {
		HubChrome.paintHeader(painter, layout, "Friends", "Connected");

		// 7 glyphs of 6 px centre at x = 10 + (300 - 42) / 2; a 9 px font in a 10 px line starts at the line top.
		assertEquals(List.of(
			"text 'Friends' at 139,6 #FFFFFFFF",
			"text 'Connected' at 133,18 #FFAAAAAA"), painter.calls());
	}

	@Test
	void headerClipsATitleThatIsTooWide() {
		HubChrome.paintHeader(painter, layout, "x".repeat(60), "");

		String clipped = "x".repeat(49) + "…";
		assertEquals("text '" + clipped + "' at 10,6 #FFFFFFFF", painter.calls().get(0));
	}

	@Test
	void rowTextIsClippedBeforeTheActionAndTheSecondLineIsMuted() {
		Rect row = new Rect(0, 0, 100, GuiMetrics.TWO_LINE_ROW_HEIGHT);
		RowLayout inside = RowLayout.of(row, true, List.of(40));

		RowPainter.paint(painter, inside, RowStyle.HEADING, "A long friend name", Optional.of("Playing"));

		// The text area is 4..52 = 48 px = 8 glyphs, so six characters (the trailing space is dropped) and the ellipsis remain.
		assertEquals(List.of(
			"text 'A long…' at 4,5 #FFFFAA00",
			"text 'Playing' at 4,21 #FFAAAAAA"), painter.calls());
	}

	@Test
	void scrollbarDrawsTrackAndThumb() {
		painter.scrollbar(new Rect(308, 56, 2, 152), new Rect(308, 56, 2, 20));

		assertEquals(List.of("fill 308,56 2x152 #40FFFFFF", "fill 308,56 2x20 #C0FFFFFF"), painter.calls());
	}
}
