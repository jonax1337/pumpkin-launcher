package dev.laux.pumpkin.bridge.ui.model;

import java.util.Objects;
import dev.laux.pumpkin.bridge.runtime.Immutable;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Inside one row: text on the left, action widgets right-aligned and vertically centred. The text lines get the width
 * that is left of the leftmost action, so a long name is clipped before it reaches a button.
 */
public final class RowLayout {
	private final Rect firstLine;
	private final Optional<Rect> secondLine;
	private final List<Rect> actions;

	public RowLayout(Rect firstLine, Optional<Rect> secondLine, List<Rect> actions) {
		actions = Immutable.copyList(actions);
		this.firstLine = firstLine;
		this.secondLine = secondLine;
		this.actions = actions;
	}

	public Rect firstLine() {
		return firstLine;
	}

	public Optional<Rect> secondLine() {
		return secondLine;
	}

	public List<Rect> actions() {
		return actions;
	}

	@Override
	public boolean equals(Object other) {
		if (this == other) {
			return true;
		}
		if (!(other instanceof RowLayout)) {
			return false;
		}
		RowLayout that = (RowLayout) other;
		return Objects.equals(firstLine, that.firstLine)
			&& Objects.equals(secondLine, that.secondLine)
			&& Objects.equals(actions, that.actions);
	}

	@Override
	public int hashCode() {
		int hash = Objects.hashCode(firstLine);
		hash = 31 * hash + Objects.hashCode(secondLine);
		hash = 31 * hash + Objects.hashCode(actions);
		return hash;
	}

	@Override
	public String toString() {
		return "RowLayout[firstLine=" + firstLine + ", secondLine=" + secondLine + ", actions=" + actions + "]";
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
