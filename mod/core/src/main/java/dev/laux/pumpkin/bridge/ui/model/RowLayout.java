package dev.laux.pumpkin.bridge.ui.model;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Inside one row: text on the left, action widgets right-aligned and vertically centred. The text lines get the width
 * that is left of the leftmost action, so a long name is clipped before it reaches a button.
 */
public record RowLayout(Rect firstLine, Optional<Rect> secondLine, List<Rect> actions) {
	public RowLayout {
		actions = List.copyOf(actions);
	}

	/** {@code actionWidths} are in the order the actions appear on screen, left to right. */
	public static RowLayout of(Rect row, boolean twoLine, List<Integer> actionWidths) {
		List<Rect> actions = actionRects(row, actionWidths);
		int textLeft = row.x() + GuiMetrics.ROW_PADDING;
		int textRight = actions.isEmpty() ? row.right() - GuiMetrics.ROW_PADDING
			: actions.get(0).x() - GuiMetrics.ROW_ACTION_GAP;
		int textWidth = Math.max(0, textRight - textLeft);
		if (!twoLine) {
			return new RowLayout(new Rect(textLeft, row.y(), textWidth, row.height()), Optional.empty(), actions);
		}
		Rect first = new Rect(textLeft, row.y() + GuiMetrics.ROW_PADDING, textWidth, GuiMetrics.ROW_TEXT_LINE_HEIGHT);
		Rect second = first.withY(first.bottom() + GuiMetrics.ROW_PADDING);
		return new RowLayout(first, Optional.of(second), actions);
	}

	private static List<Rect> actionRects(Rect row, List<Integer> actionWidths) {
		List<Rect> actions = new ArrayList<>(actionWidths.size());
		int top = row.y() + (row.height() - GuiMetrics.BUTTON_HEIGHT) / 2;
		int right = row.right() - GuiMetrics.ROW_PADDING;
		for (int index = actionWidths.size() - 1; index >= 0; index--) {
			int width = actionWidths.get(index);
			right -= width;
			actions.add(0, new Rect(right, top, width, GuiMetrics.BUTTON_HEIGHT));
			right -= GuiMetrics.ROW_ACTION_GAP;
		}
		return actions;
	}
}
