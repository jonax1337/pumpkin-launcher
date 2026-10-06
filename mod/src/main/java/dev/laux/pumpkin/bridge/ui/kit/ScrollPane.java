package dev.laux.pumpkin.bridge.ui.kit;

import java.util.Objects;
import dev.laux.pumpkin.bridge.runtime.Immutable;

import dev.laux.pumpkin.bridge.compat.Text;
import dev.laux.pumpkin.bridge.compat.Widgets;
import dev.laux.pumpkin.bridge.ui.model.Fit;
import dev.laux.pumpkin.bridge.modules.friends.ui.model.FriendCardLayout;
import dev.laux.pumpkin.bridge.ui.model.GuiMetrics;
import dev.laux.pumpkin.bridge.ui.model.Painter;
import dev.laux.pumpkin.bridge.ui.model.Rect;
import dev.laux.pumpkin.bridge.ui.model.RowLayout;
import dev.laux.pumpkin.bridge.ui.model.RowPainter;
import dev.laux.pumpkin.bridge.ui.model.PumpkinTheme;
import dev.laux.pumpkin.bridge.ui.model.RowStyle;
import dev.laux.pumpkin.bridge.ui.model.ScrollModel;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import net.minecraft.client.gui.components.AbstractWidget;

/**
 * The rows of a screen inside its body rectangle, scrolled by whole rows (docs/bridge/README.md). The widgets of every row are
 * regular screen widgets; the ones outside the body are made invisible, so vanilla neither draws nor clicks them. Rows
 * are placed by the Minecraft-free {@link ScrollModel} and {@link RowLayout}.
 */
public final class ScrollPane {
	private final Rect rowArea;
	private final Rect scrollbarTrack;
	private final List<Row> rows;
	private final ScrollModel scroll;
	private final Rect viewport;
	private final List<PlacedRow> placed = new ArrayList<>();

	/** {@code firstRow} is a remembered scroll position; it is clamped to what the new window can show. */
	public ScrollPane(Rect body, List<Row> rows, int firstRow) {
		this.rows = Immutable.copyList(rows);
		rowArea = new Rect(body.x(), body.y(), body.width() - GuiMetrics.SCROLLBAR_GUTTER, body.height());
		scrollbarTrack = new Rect(body.right() - GuiMetrics.SCROLLBAR_WIDTH, body.y(), GuiMetrics.SCROLLBAR_WIDTH, body.height());
		viewport = body;
		scroll = new ScrollModel(this.rows.stream().map(Row::height).collect(Immutable.toList()), body.height());
		scroll.scrollTo(firstRow);
	}

	/** Every widget of every row, shown or not: the screen adds them all once per build. */
	public List<Row.Action> actions() {
		return rows.stream().flatMap(row -> row.actions().stream()).collect(Immutable.toList());
	}

	public int firstRow() {
		return scroll.firstRow();
	}

	/** Moves the widgets of the shown rows into place and hides all others. Call after every change of the scroll position. */
	public void layout() {
		hideAll();
		placed.clear();
		List<Rect> shown = scroll.visibleRows(rowArea);
		for (int index = 0; index < shown.size(); index++) {
			Row row = rows.get(scroll.firstRow() + index);
			Rect bounds = shown.get(index);
			Optional<FriendCardLayout> card = row.friendIdentity().map(identity ->
				FriendCardLayout.of(bounds, Text.width(identity.status()) + 18, actionWidths(row, bounds)));
			RowLayout inside = card.map(FriendCardLayout::rowLayout).orElseGet(() ->
				RowLayout.of(bounds, row.secondLine().isPresent(), actionWidths(row, bounds)));
			placeActions(row, inside);
			String statusLabel = row.friendIdentity().map(identity -> Fit.clip(identity.status(),
				Math.max(0, card.get().status().width() - 13),
				codePoint -> Text.width(new String(Character.toChars(codePoint))))).orElse("");
			placed.add(new PlacedRow(row, inside, bounds, card, statusLabel, Text.width(statusLabel)));
		}
	}

	public void scrollToTop() {
		scroll.scrollTo(0);
	}

	public boolean wheel(double verticalDelta) {
		scroll.wheel(verticalDelta);
		layout();
		return scroll.needsScrollbar();
	}

	public boolean pageUp() {
		scroll.pageUp();
		layout();
		return scroll.needsScrollbar();
	}

	public boolean pageDown() {
		scroll.pageDown();
		layout();
		return scroll.needsScrollbar();
	}

	/** Scrolls the least that shows the row of {@code widget}; does nothing for a widget that is not in a row. */
	public void reveal(AbstractWidget widget) {
		for (int index = 0; index < rows.size(); index++) {
			if (rows.get(index).actions().stream().anyMatch(action -> action.widget() == widget)) {
				scroll.revealRow(index);
				layout();
				return;
			}
		}
	}

	public void paintBackdrop(Painter painter) {
		painter.beginClip(viewport);
		paintRowBackdrops(painter);
		painter.endClip();
	}

	private void paintRowBackdrops(Painter painter) {
		for (int index = 0; index < placed.size(); index++) {
			PlacedRow shown = placed.get(index);
			Rect area = shown.bounds();
			if (shown.row().friendIdentity().isPresent()) {
				paintCardBackdrop(painter, shown);
				continue;
			}
			if (shown.row().style() == RowStyle.HEADING) {
				painter.fill(area, PumpkinTheme.PANEL);
				painter.fill(area.x(), area.y() + 3, 2, Math.max(0, area.height() - 6), PumpkinTheme.ACCENT);
			} else if (index % 2 == 0) {
				painter.fill(area, PumpkinTheme.PANEL);
			}
			painter.fill(area.x() + GuiMetrics.ROW_PADDING, area.bottom() - 1,
				Math.max(0, area.width() - 2 * GuiMetrics.ROW_PADDING), 1, PumpkinTheme.SURFACE);
		}
	}

	private void paintCardBackdrop(Painter painter, PlacedRow shown) {
		Rect area = shown.bounds();
		int color = shown.row().friendIdentity().get().statusColor();
		painter.fill(area.x() + 2, area.y() + 2, Math.max(0, area.width() - 4), area.height() - 6, PumpkinTheme.EDGE);
		painter.fill(area.x() + 3, area.y() + 3, Math.max(0, area.width() - 6), area.height() - 8, PumpkinTheme.SURFACE);
		painter.fill(area.x() + 3, area.y() + 3, 2, area.height() - 8, color);
		Rect head = shown.card().get().portrait();
		painter.fill(head.x() - 1, head.y() - 1, head.width() + 2, head.height() + 2, PumpkinTheme.BORDER);
		if (!shown.row().actions().isEmpty()) {
			painter.fill(area.x() + 8, area.y() + FriendCardLayout.HEIGHT - 12,
				Math.max(0, area.width() - 16), 1, PumpkinTheme.HOVER);
		}
	}

	public void paint(Painter painter) {
		painter.beginClip(viewport);
		paintRows(painter);
		painter.endClip();
		scroll.thumb(scrollbarTrack).ifPresent(thumb -> PumpkinTheme.scrollbar(painter, scrollbarTrack, thumb));
	}

	private void paintRows(Painter painter) {
		for (PlacedRow shown : placed) {
			if (shown.card().isPresent()) {
				paintFriend(painter, shown);
				continue;
			}
			if (!shown.row().firstLine().isEmpty()) {
				RowPainter.paint(painter, shown.layout(), shown.row().style(), shown.row().firstLine(), shown.row().secondLine());
			}
		}
	}

	private void paintFriend(Painter painter, PlacedRow shown) {
		Row row = shown.row();
		Row.FriendIdentity identity = row.friendIdentity().get();
		FriendCardLayout card = shown.card().get();
		painter.head(row.firstLine(), identity.uuid(), card.portrait());
		RowPainter.paint(painter, shown.layout(), row.style(), row.firstLine(), row.secondLine());
		Rect status = card.status();
		painter.fill(status, PumpkinTheme.SUNK);
		painter.fill(status.x() + 4, status.y() + 4, 3, 3, identity.statusColor());
		painter.text(shown.statusLabel(), status.right() - 4 - shown.statusWidth(),
			status.y() + (status.height() - painter.lineHeight()) / 2, identity.statusColor(), true);
	}

	/** The narration of the shown rows in view order: both lines of a two-line row, one line per row (docs/bridge/README.md, "In-game navigation and world behavior"). */
	public List<String> narrationLines() {
		List<String> lines = new ArrayList<>();
		for (PlacedRow shown : placed) {
			if (shown.row().firstLine().isEmpty()) {
				continue;
			}
			String line = shown.row().secondLine()
				.map(second -> shown.row().firstLine() + ", " + second)
				.orElse(shown.row().firstLine());
			lines.add(line + shown.row().friendIdentity().map(identity -> ", " + identity.status()).orElse(""));
		}
		return lines;
	}

	private void hideAll() {
		actions().forEach(action -> action.widget().visible = false);
	}

	private static List<Integer> actionWidths(Row row, Rect rowRect) {
		return row.actions().stream()
			.map(action -> row.widgetFillsRow() ? rowRect.width() - 2 * GuiMetrics.ROW_PADDING : action.widget().getWidth()).collect(Immutable.toList());
	}

	private void placeActions(Row row, RowLayout inside) {
		for (int index = 0; index < row.actions().size(); index++) {
			Rect target = inside.actions().get(index);
			AbstractWidget widget = row.actions().get(index).widget();
			widget.setWidth(target.width());
			Widgets.setPosition(widget, target.x(), target.y());
			widget.visible = target.y() >= viewport.y() && target.bottom() <= viewport.bottom();
		}
	}

	private static final class PlacedRow {
		private final Row row;
		private final RowLayout layout;
		private final Rect bounds;
		private final Optional<FriendCardLayout> card;
		private final String statusLabel;
		private final int statusWidth;

		private PlacedRow(Row row, RowLayout layout, Rect bounds, Optional<FriendCardLayout> card, String statusLabel, int statusWidth) {
			this.row = row;
			this.layout = layout;
			this.bounds = bounds;
			this.card = card;
			this.statusLabel = statusLabel;
			this.statusWidth = statusWidth;
		}

		public Row row() {
			return row;
		}

		public RowLayout layout() {
			return layout;
		}

		public Rect bounds() {
			return bounds;
		}

		public Optional<FriendCardLayout> card() {
			return card;
		}

		public String statusLabel() {
			return statusLabel;
		}

		public int statusWidth() {
			return statusWidth;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof PlacedRow)) {
				return false;
			}
			PlacedRow that = (PlacedRow) other;
			return Objects.equals(row, that.row)
				&& Objects.equals(layout, that.layout)
				&& Objects.equals(bounds, that.bounds)
				&& Objects.equals(card, that.card)
				&& Objects.equals(statusLabel, that.statusLabel)
				&& statusWidth == that.statusWidth;
		}

		@Override
		public int hashCode() {
			int hash = Objects.hashCode(row);
			hash = 31 * hash + Objects.hashCode(layout);
			hash = 31 * hash + Objects.hashCode(bounds);
			hash = 31 * hash + Objects.hashCode(card);
			hash = 31 * hash + Objects.hashCode(statusLabel);
			hash = 31 * hash + Integer.hashCode(statusWidth);
			return hash;
		}

		@Override
		public String toString() {
			return "PlacedRow[row=" + row + ", layout=" + layout + ", bounds=" + bounds + ", card=" + card + ", statusLabel=" + statusLabel + ", statusWidth=" + statusWidth + "]";
		}
	}
}
