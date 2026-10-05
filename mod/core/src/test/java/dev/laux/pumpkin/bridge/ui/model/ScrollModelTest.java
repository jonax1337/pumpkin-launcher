package dev.laux.pumpkin.bridge.ui.model;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Collections;
import java.util.List;
import org.junit.jupiter.api.Test;

class ScrollModelTest {
	private static final int ROW = GuiMetrics.ROW_HEIGHT;
	private static final int VIEWPORT = 5 * ROW;

	private static ScrollModel rows(int count) {
		return new ScrollModel(Collections.nCopies(count, ROW), VIEWPORT);
	}

	@Test
	void showsOnlyTheRowsThatFitCompletely() {
		ScrollModel scroll = new ScrollModel(Collections.nCopies(10, ROW), VIEWPORT + ROW - 1);

		assertEquals(5, scroll.visibleCount());
	}

	@Test
	void aListThatFitsNeedsNoScrollbarAndCannotScroll() {
		ScrollModel scroll = rows(5);

		scroll.pageDown();
		scroll.wheel(-1);

		assertEquals(0, scroll.firstRow());
		assertFalse(scroll.needsScrollbar());
	}

	@Test
	void theWheelMovesOneRowAndStopsAtBothEnds() {
		ScrollModel scroll = rows(8);

		scroll.wheel(1);
		assertEquals(0, scroll.firstRow(), "wheel up at the top stays");
		scroll.wheel(-1);
		assertEquals(1, scroll.firstRow());
		scroll.wheel(-3);
		scroll.wheel(-3);
		assertEquals(3, scroll.firstRow(), "8 rows, 5 shown: the last first row is 3");
	}

	@Test
	void pageDownShowsTheNextPageAndPageUpComesBack() {
		ScrollModel scroll = rows(30);

		scroll.pageDown();
		assertEquals(5, scroll.firstRow());
		scroll.pageDown();
		assertEquals(10, scroll.firstRow());
		scroll.pageUp();
		assertEquals(5, scroll.firstRow());
		scroll.pageUp();
		scroll.pageUp();
		assertEquals(0, scroll.firstRow());
	}

	@Test
	void pageDownNearTheEndStopsWhereTheLastRowIsAtTheBottom() {
		ScrollModel scroll = rows(12);

		scroll.pageDown();
		scroll.pageDown();

		assertEquals(7, scroll.firstRow());
		assertEquals(5, scroll.visibleCount());
	}

	@Test
	void revealingARowBelowScrollsTheLeastThatShowsIt() {
		ScrollModel scroll = rows(30);

		scroll.revealRow(7);
		assertEquals(3, scroll.firstRow());
		assertTrue(scroll.isVisible(7));

		scroll.revealRow(4);
		assertEquals(3, scroll.firstRow(), "a row that is shown already changes nothing");
	}

	@Test
	void revealingARowAboveMakesItTheFirstRow() {
		ScrollModel scroll = rows(30);
		scroll.scrollTo(12);

		scroll.revealRow(9);

		assertEquals(9, scroll.firstRow());
	}

	@Test
	void revealingARowThatDoesNotExistChangesNothing() {
		ScrollModel scroll = rows(30);
		scroll.scrollTo(4);

		scroll.revealRow(30);
		scroll.revealRow(-1);

		assertEquals(4, scroll.firstRow());
	}

	@Test
	void aRememberedPositionIsClampedToTheNewList() {
		ScrollModel scroll = rows(8);

		scroll.scrollTo(25);

		assertEquals(3, scroll.firstRow());
	}

	@Test
	void rowsOfDifferentHeightsAreShownWholeOrNotAtAll() {
		List<Integer> heights = List.of(24, 36, 36, 36, 24);
		ScrollModel scroll = new ScrollModel(heights, 90);

		assertEquals(2, scroll.visibleCount(), "24 + 36 fit into 90 px, the third row would end at 96");
		scroll.pageDown();
		assertEquals(2, scroll.firstRow());
		assertEquals(List.of(new Rect(0, 10, 50, 36), new Rect(0, 46, 50, 36)),
			scroll.visibleRows(new Rect(0, 10, 50, 90)));
	}

	@Test
	void aRowTallerThanTheViewportIsStillShown() {
		ScrollModel scroll = new ScrollModel(List.of(200, 24), 100);

		assertEquals(1, scroll.visibleCount());
		assertTrue(scroll.isVisible(0));
	}

	@Test
	void anEmptyListShowsNothing() {
		ScrollModel scroll = new ScrollModel(List.of(), VIEWPORT);

		scroll.pageDown();

		assertEquals(0, scroll.visibleCount());
		assertEquals(List.of(), scroll.visibleRows(new Rect(0, 0, 10, VIEWPORT)));
		assertFalse(scroll.needsScrollbar());
	}

	@Test
	void theThumbGrowsWithTheVisibleShareAndNeverShrinksBelowTheMinimum() {
		Rect track = new Rect(308, 56, 2, 120);

		assertEquals(60, rows(10).thumb(track).orElseThrow().height());
		assertEquals(GuiMetrics.SCROLLBAR_MIN_THUMB, rows(500).thumb(track).orElseThrow().height());
	}

	@Test
	void theThumbTravelsFromTopToBottomOfTheTrack() {
		Rect track = new Rect(308, 56, 2, 120);
		ScrollModel scroll = rows(10);

		assertEquals(56, scroll.thumb(track).orElseThrow().y());
		scroll.scrollTo(10);
		Rect bottom = scroll.thumb(track).orElseThrow();
		assertEquals(track.bottom(), bottom.bottom());
	}
}
