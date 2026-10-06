package dev.laux.pumpkin.bridge.ui.kit;

import java.util.Objects;

import dev.laux.pumpkin.bridge.modules.friends.ui.model.FriendCardLayout;
import dev.laux.pumpkin.bridge.ui.model.GuiMetrics;
import dev.laux.pumpkin.bridge.ui.model.RowStyle;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import net.minecraft.client.gui.components.AbstractWidget;

/**
 * One row of a {@link ScrollPane}: one or two lines of text on the left and any number of vanilla widgets on the right.
 * A screen builds its rows afresh on every rebuild, so the widgets of a row are never shared between builds.
 */
public final class Row {
	private final RowStyle style;
	private final String firstLine;
	private final Optional<String> secondLine;
	private final boolean widgetFillsRow;
	private final List<Action> actions = new ArrayList<>();
	private Optional<FriendIdentity> friendIdentity = Optional.empty();

	private Row(RowStyle style, String firstLine, Optional<String> secondLine, boolean widgetFillsRow) {
		this.style = style;
		this.firstLine = firstLine;
		this.secondLine = secondLine;
		this.widgetFillsRow = widgetFillsRow;
	}

	public static Row text(String line) {
		return new Row(RowStyle.NORMAL, line, Optional.empty(), false);
	}

	/** A line that steps back: hints and explanations under a field or question. */
	public static Row muted(String line) {
		return new Row(RowStyle.MUTED, line, Optional.empty(), false);
	}

	public static Row heading(String line) {
		return new Row(RowStyle.HEADING, line, Optional.empty(), false);
	}

	/** The first line in the normal colour, the second muted. */
	public static Row twoLines(String first, String second) {
		return new Row(RowStyle.NORMAL, first, Optional.of(second), false);
	}

	/** A friend's portrait, identity and status, with actions in their own strip below. */
	public static Row friend(String name, Optional<String> uuid, String detail, String status, int statusColor) {
		Row row = twoLines(name, detail);
		row.friendIdentity = Optional.of(new FriendIdentity(uuid, status, statusColor));
		return row;
	}

	/** A row that holds only {@code widget}, stretched to the row width. */
	public static Row fullWidth(String id, AbstractWidget widget) {
		return new Row(RowStyle.NORMAL, "", Optional.empty(), true).withAction(id, widget);
	}

	/** Adds a widget at the right edge; the first one added is the leftmost. {@code id} is stable across rebuilds. */
	public Row withAction(String id, AbstractWidget widget) {
		actions.add(new Action(id, widget));
		return this;
	}

	int height() {
		if (friendIdentity.isPresent()) {
			return actions.isEmpty() ? FriendCardLayout.HEIGHT : FriendCardLayout.ACTION_HEIGHT;
		}
		return secondLine.isPresent() ? GuiMetrics.TWO_LINE_ROW_HEIGHT : GuiMetrics.ROW_HEIGHT;
	}

	RowStyle style() {
		return style;
	}

	String firstLine() {
		return firstLine;
	}

	Optional<String> secondLine() {
		return secondLine;
	}

	boolean widgetFillsRow() {
		return widgetFillsRow;
	}

	Optional<FriendIdentity> friendIdentity() {
		return friendIdentity;
	}

	static final class FriendIdentity {
		private final Optional<String> uuid;
		private final String status;
		private final int statusColor;

		FriendIdentity(Optional<String> uuid, String status, int statusColor) {
			this.uuid = uuid;
			this.status = status;
			this.statusColor = statusColor;
		}

		public Optional<String> uuid() {
			return uuid;
		}

		public String status() {
			return status;
		}

		public int statusColor() {
			return statusColor;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof FriendIdentity)) {
				return false;
			}
			FriendIdentity that = (FriendIdentity) other;
			return Objects.equals(uuid, that.uuid)
				&& Objects.equals(status, that.status)
				&& statusColor == that.statusColor;
		}

		@Override
		public int hashCode() {
			int hash = Objects.hashCode(uuid);
			hash = 31 * hash + Objects.hashCode(status);
			hash = 31 * hash + Integer.hashCode(statusColor);
			return hash;
		}

		@Override
		public String toString() {
			return "FriendIdentity[uuid=" + uuid + ", status=" + status + ", statusColor=" + statusColor + "]";
		}
	}

	List<Action> actions() {
		return actions;
	}

	static final class Action {
		private final String id;
		private final AbstractWidget widget;

		Action(String id, AbstractWidget widget) {
			this.id = id;
			this.widget = widget;
		}

		public String id() {
			return id;
		}

		public AbstractWidget widget() {
			return widget;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Action)) {
				return false;
			}
			Action that = (Action) other;
			return Objects.equals(id, that.id)
				&& Objects.equals(widget, that.widget);
		}

		@Override
		public int hashCode() {
			int hash = Objects.hashCode(id);
			hash = 31 * hash + Objects.hashCode(widget);
			return hash;
		}

		@Override
		public String toString() {
			return "Action[id=" + id + ", widget=" + widget + "]";
		}
	}
}
