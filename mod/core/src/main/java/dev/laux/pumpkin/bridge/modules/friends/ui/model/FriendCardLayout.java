package dev.laux.pumpkin.bridge.modules.friends.ui.model;

import java.util.Objects;
import dev.laux.pumpkin.bridge.runtime.Immutable;

import dev.laux.pumpkin.bridge.ui.model.GuiMetrics;
import dev.laux.pumpkin.bridge.ui.model.Rect;
import dev.laux.pumpkin.bridge.ui.model.RowLayout;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/** Portrait and identity above an optional, separate action strip, in GUI pixels. */
public final class FriendCardLayout {
	private final Rect portrait;
	private final Rect name;
	private final Rect status;
	private final Rect detail;
	private final List<Rect> actions;

	public FriendCardLayout(Rect portrait, Rect name, Rect status, Rect detail, List<Rect> actions) {
		actions = Immutable.copyList(actions);
		this.portrait = portrait;
		this.name = name;
		this.status = status;
		this.detail = detail;
		this.actions = actions;
	}

	public Rect portrait() {
		return portrait;
	}

	public Rect name() {
		return name;
	}

	public Rect status() {
		return status;
	}

	public Rect detail() {
		return detail;
	}

	public List<Rect> actions() {
		return actions;
	}

	@Override
	public boolean equals(Object other) {
		if (this == other) {
			return true;
		}
		if (!(other instanceof FriendCardLayout)) {
			return false;
		}
		FriendCardLayout that = (FriendCardLayout) other;
		return Objects.equals(portrait, that.portrait)
			&& Objects.equals(name, that.name)
			&& Objects.equals(status, that.status)
			&& Objects.equals(detail, that.detail)
			&& Objects.equals(actions, that.actions);
	}

	@Override
	public int hashCode() {
		int hash = Objects.hashCode(portrait);
		hash = 31 * hash + Objects.hashCode(name);
		hash = 31 * hash + Objects.hashCode(status);
		hash = 31 * hash + Objects.hashCode(detail);
		hash = 31 * hash + Objects.hashCode(actions);
		return hash;
	}

	@Override
	public String toString() {
		return "FriendCardLayout[portrait=" + portrait + ", name=" + name + ", status=" + status + ", detail=" + detail + ", actions=" + actions + "]";
	}

	public static final int HEIGHT = 48;
	public static final int ACTION_HEIGHT = 72;
	private static final int PADDING = 8;
	private static final int PORTRAIT_SIZE = 24;
	private static final int PORTRAIT_GAP = 8;
	private static final int LINE_HEIGHT = 12;
	private static final int STATUS_GAP = 8;


	public static FriendCardLayout of(Rect row, int statusWidth, List<Integer> actionWidths) {
		int portraitSize = Math.min(PORTRAIT_SIZE, Math.max(0, row.width() - 2 * PADDING));
		Rect portrait = new Rect(row.x() + PADDING, row.y() + PADDING, portraitSize, portraitSize);
		int textLeft = Math.min(row.right() - PADDING, portrait.right() + PORTRAIT_GAP);
		int textWidth = Math.max(0, row.right() - PADDING - textLeft);
		int badgeWidth = Math.min(statusWidth, textWidth / 2);
		Rect status = new Rect(row.right() - PADDING - badgeWidth, row.y() + PADDING, badgeWidth, LINE_HEIGHT);
		Rect name = new Rect(textLeft, status.y(), Math.max(0, status.x() - STATUS_GAP - textLeft), LINE_HEIGHT);
		Rect detail = new Rect(textLeft, row.y() + PADDING + LINE_HEIGHT + 2, textWidth, LINE_HEIGHT);
		List<Rect> actions = new ArrayList<>(actionWidths.size());
		int right = row.right() - PADDING;
		for (int index = actionWidths.size() - 1; index >= 0; index--) {
			int width = Math.min(actionWidths.get(index), Math.max(0, right - row.x() - PADDING));
			right -= width;
			actions.add(0, new Rect(right, row.y() + HEIGHT - 8, width, GuiMetrics.BUTTON_HEIGHT));
			right -= GuiMetrics.ROW_ACTION_GAP;
		}
		return new FriendCardLayout(portrait, name, status, detail, actions);
	}

	public RowLayout rowLayout() {
		return new RowLayout(name, Optional.of(detail), actions);
	}
}
