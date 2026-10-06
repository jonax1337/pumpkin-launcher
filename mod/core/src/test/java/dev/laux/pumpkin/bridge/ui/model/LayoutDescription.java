package dev.laux.pumpkin.bridge.ui.model;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.IntStream;

/**
 * The reviewable text form of a hub layout at one resolution: every rectangle on its own line. The golden files in
 * {@code src/test/resources/ui/golden} hold exactly this text, so a layout change shows up as a text diff.
 */
final class LayoutDescription {
	private static final int TAB_COUNT = 5;
	private static final int ROW_COUNT = 40;
	private static final int ACTION_WIDTH = 60;

	private LayoutDescription() {
	}

	static String of(int screenWidth, int screenHeight) {
		HubLayout layout = HubLayout.of(screenWidth, screenHeight, TAB_COUNT);
		List<String> lines = new ArrayList<>();
		lines.add("screen " + screenWidth + "x" + screenHeight + ", " + TAB_COUNT + " tabs");
		lines.add("title " + layout.title());
		lines.add("status " + layout.status());
		for (int tab = 0; tab < layout.tabs().size(); tab++) {
			lines.add("tab" + tab + " " + layout.tabs().get(tab));
		}
		lines.add("body " + layout.body());
		lines.add("footer " + layout.footer());
		describeFooterButtons(lines, layout, 1);
		describeFooterButtons(lines, layout, 2);
		describeRows(lines, layout);
		return String.join("\n", lines) + "\n";
	}

	private static void describeFooterButtons(List<String> lines, HubLayout layout, int count) {
		List<Rect> buttons = layout.footerButtons(count);
		for (int index = 0; index < buttons.size(); index++) {
			lines.add("footerButton " + (index + 1) + "/" + count + " " + buttons.get(index));
		}
	}

	/** 40 rows, every third one with two lines, one action each; the first page and the page after PageDown. */
	private static void describeRows(List<String> lines, HubLayout layout) {
		Rect rowArea = new Rect(layout.body().x(), layout.body().y(), layout.body().width() - GuiMetrics.SCROLLBAR_GUTTER,
			layout.body().height());
		ScrollModel scroll = new ScrollModel(rowHeights(), layout.body().height());
		describePage(lines, "page 1", scroll, rowArea);
		scroll.pageDown();
		describePage(lines, "page 2", scroll, rowArea);
		scroll.scrollTo(ROW_COUNT);
		describePage(lines, "last page", scroll, rowArea);
	}

	private static void describePage(List<String> lines, String name, ScrollModel scroll, Rect rowArea) {
		lines.add(name + ": first row " + scroll.firstRow() + ", " + scroll.visibleCount() + " rows shown");
		List<Rect> rects = scroll.visibleRows(rowArea);
		for (int index = 0; index < rects.size(); index++) {
			int row = scroll.firstRow() + index;
			RowLayout inside = RowLayout.of(rects.get(index), isTwoLine(row), List.of(ACTION_WIDTH));
			lines.add("  row" + row + " " + rects.get(index) + " | line1 " + inside.firstLine()
				+ inside.secondLine().map(second -> " | line2 " + second).orElse("") + " | action " + inside.actions().get(0));
		}
		lines.add("  scrollbar thumb " + scroll.thumb(new Rect(rowArea.right() + GuiMetrics.SCROLLBAR_GUTTER - GuiMetrics.SCROLLBAR_WIDTH,
			rowArea.y(), GuiMetrics.SCROLLBAR_WIDTH, rowArea.height())).map(Rect::toString).orElse("none"));
	}

	private static List<Integer> rowHeights() {
		return IntStream.range(0, ROW_COUNT)
			.mapToObj(row -> isTwoLine(row) ? GuiMetrics.TWO_LINE_ROW_HEIGHT : GuiMetrics.ROW_HEIGHT)
			.toList();
	}

	private static boolean isTwoLine(int row) {
		return row % 3 == 2;
	}
}
