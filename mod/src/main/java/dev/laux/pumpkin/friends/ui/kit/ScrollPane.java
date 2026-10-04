package dev.laux.pumpkin.friends.ui.kit;

import dev.laux.pumpkin.friends.ui.model.GuiMetrics;
import dev.laux.pumpkin.friends.ui.model.Painter;
import dev.laux.pumpkin.friends.ui.model.Rect;
import dev.laux.pumpkin.friends.ui.model.RowLayout;
import dev.laux.pumpkin.friends.ui.model.RowPainter;
import dev.laux.pumpkin.friends.ui.model.ScrollModel;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.gui.components.AbstractWidget;

/**
 * The rows of a screen inside its body rectangle, scrolled by whole rows (INGAME 4.4). The widgets of every row are
 * regular screen widgets; the ones outside the body are made invisible, so vanilla neither draws nor clicks them. Rows
 * are placed by the Minecraft-free {@link ScrollModel} and {@link RowLayout}.
 */
public final class ScrollPane {
	private final Rect rowArea;
	private final Rect scrollbarTrack;
	private final List<Row> rows;
	private final ScrollModel scroll;
	private final List<PlacedRow> placed = new ArrayList<>();

	/** {@code firstRow} is a remembered scroll position; it is clamped to what the new window can show. */
	public ScrollPane(Rect body, List<Row> rows, int firstRow) {
		this.rows = List.copyOf(rows);
		rowArea = new Rect(body.x(), body.y(), body.width() - GuiMetrics.SCROLLBAR_GUTTER, body.height());
		scrollbarTrack = new Rect(body.right() - GuiMetrics.SCROLLBAR_WIDTH, body.y(), GuiMetrics.SCROLLBAR_WIDTH, body.height());
		scroll = new ScrollModel(this.rows.stream().map(Row::height).toList(), body.height());
		scroll.scrollTo(firstRow);
	}

	/** Every widget of every row, shown or not: the screen adds them all once per build. */
	public List<Row.Action> actions() {
		return rows.stream().flatMap(row -> row.actions().stream()).toList();
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
			RowLayout inside = RowLayout.of(shown.get(index), row.secondLine().isPresent(), actionWidths(row, shown.get(index)));
			placeActions(row, inside);
			placed.add(new PlacedRow(row, inside));
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

	public void paint(Painter painter) {
		for (PlacedRow shown : placed) {
			if (!shown.row().firstLine().isEmpty()) {
				RowPainter.paint(painter, shown.layout(), shown.row().style(), shown.row().firstLine(), shown.row().secondLine());
			}
		}
		scroll.thumb(scrollbarTrack).ifPresent(thumb -> painter.scrollbar(scrollbarTrack, thumb));
	}

	/** The narration of the shown rows in view order: both lines of a two-line row, one line per row (INGAME 6.2). */
	public List<String> narrationLines() {
		List<String> lines = new ArrayList<>();
		for (PlacedRow shown : placed) {
			if (shown.row().firstLine().isEmpty()) {
				continue;
			}
			lines.add(shown.row().secondLine()
				.map(second -> shown.row().firstLine() + ", " + second)
				.orElse(shown.row().firstLine()));
		}
		return lines;
	}

	private void hideAll() {
		actions().forEach(action -> action.widget().visible = false);
	}

	private static List<Integer> actionWidths(Row row, Rect rowRect) {
		return row.actions().stream()
			.map(action -> row.widgetFillsRow() ? rowRect.width() - 2 * GuiMetrics.ROW_PADDING : action.widget().getWidth())
			.toList();
	}

	private static void placeActions(Row row, RowLayout inside) {
		for (int index = 0; index < row.actions().size(); index++) {
			Rect target = inside.actions().get(index);
			AbstractWidget widget = row.actions().get(index).widget();
			widget.setWidth(target.width());
			widget.setX(target.x());
			widget.setY(target.y());
			widget.visible = true;
		}
	}

	private record PlacedRow(Row row, RowLayout layout) {
	}
}
