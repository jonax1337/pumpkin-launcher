package dev.laux.pumpkin.bridge.ui.model;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Scrolling by whole rows (docs/bridge/README.md): the viewport shows rows from {@link #firstRow()} on, and a row that does not
 * fit completely is not shown at all. Wheel, PageUp and PageDown move the first row; the focused row can be revealed.
 * At least one row is always shown, even if it is taller than the viewport.
 */
public final class ScrollModel {
	private final int[] rowHeights;
	private final int viewportHeight;
	private int firstRow;

	public ScrollModel(List<Integer> rowHeights, int viewportHeight) {
		this.rowHeights = rowHeights.stream().mapToInt(Integer::intValue).toArray();
		this.viewportHeight = viewportHeight;
	}

	public int rowCount() {
		return rowHeights.length;
	}

	public int firstRow() {
		return firstRow;
	}

	/** Restores a remembered position; it is clamped, because a rebuild may have fewer rows or a smaller viewport. */
	public void scrollTo(int row) {
		firstRow = Math.max(0, Math.min(row, lastFirstRow()));
	}

	/** One notch of the wheel moves one row; a positive delta is wheel up, as in Minecraft. */
	public void wheel(double verticalDelta) {
		if (verticalDelta != 0) {
			scrollTo(firstRow + (verticalDelta > 0 ? -1 : 1));
		}
	}

	public void pageDown() {
		scrollTo(firstRow + visibleCount());
	}

	public void pageUp() {
		int target = firstRow;
		int shown = 0;
		while (target > 0 && shown + rowHeights[target - 1] <= viewportHeight) {
			target--;
			shown += rowHeights[target];
		}
		scrollTo(target == firstRow && firstRow > 0 ? firstRow - 1 : target);
	}

	/** Scrolls the least that makes {@code row} visible. */
	public void revealRow(int row) {
		if (row < 0 || row >= rowHeights.length) {
			return;
		}
		if (row < firstRow) {
			scrollTo(row);
			return;
		}
		int target = firstRow;
		while (target < row && !isShown(target, row)) {
			target++;
		}
		scrollTo(target);
	}

	public boolean isVisible(int row) {
		return row >= firstRow && row < firstRow + visibleCount();
	}

	public int visibleCount() {
		int shown = 0;
		int used = 0;
		for (int row = firstRow; row < rowHeights.length; row++) {
			if (shown > 0 && used + rowHeights[row] > viewportHeight) {
				break;
			}
			used += rowHeights[row];
			shown++;
		}
		return shown;
	}

	/** The rectangles of the shown rows, from the first, stacked from the top of {@code area}. */
	public List<Rect> visibleRows(Rect area) {
		List<Rect> rects = new ArrayList<>();
		int top = area.y();
		for (int row = firstRow; row < firstRow + visibleCount(); row++) {
			rects.add(new Rect(area.x(), top, area.width(), rowHeights[row]));
			top += rowHeights[row];
		}
		return rects;
	}

	public boolean needsScrollbar() {
		return lastFirstRow() > 0;
	}

	/** The thumb inside {@code track}: proportional to the visible part, at least 8 px, empty if nothing scrolls. */
	public Optional<Rect> thumb(Rect track) {
		if (!needsScrollbar()) {
			return Optional.empty();
		}
		int thumbHeight = Math.min(track.height(),
			Math.max(GuiMetrics.SCROLLBAR_MIN_THUMB, track.height() * viewportHeight / totalHeight()));
		int thumbTravel = track.height() - thumbHeight;
		int top = track.y() + (int) ((long) thumbTravel * heightAbove(firstRow) / heightAbove(lastFirstRow()));
		return Optional.of(new Rect(track.x(), top, track.width(), thumbHeight));
	}

	private boolean isShown(int first, int row) {
		int used = 0;
		for (int index = first; index <= row; index++) {
			used += rowHeights[index];
		}
		return used <= viewportHeight;
	}

	/** The first row at which the rest of the list still fits; scrolling further would leave empty space. */
	private int lastFirstRow() {
		int used = 0;
		int row = rowHeights.length;
		while (row > 0 && used + rowHeights[row - 1] <= viewportHeight) {
			row--;
			used += rowHeights[row];
		}
		return rowHeights.length == 0 ? 0 : Math.min(row, rowHeights.length - 1);
	}

	private int heightAbove(int row) {
		int sum = 0;
		for (int index = 0; index < row; index++) {
			sum += rowHeights[index];
		}
		return sum;
	}

	private int totalHeight() {
		return heightAbove(rowHeights.length);
	}
}
