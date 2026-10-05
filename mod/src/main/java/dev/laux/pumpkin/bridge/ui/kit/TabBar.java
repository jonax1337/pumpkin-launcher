package dev.laux.pumpkin.bridge.ui.kit;

import dev.laux.pumpkin.bridge.compat.Widgets;
import dev.laux.pumpkin.bridge.ui.model.Rect;
import java.util.List;
import java.util.function.IntConsumer;
import java.util.stream.IntStream;
import net.minecraft.client.gui.components.AbstractWidget;

/** One vanilla button per tab, at the rectangles the {@link dev.laux.pumpkin.bridge.ui.model.TabBarModel} computed. The selected tab is inactive. */
final class TabBar {
	private final List<Row.Action> tabs;

	TabBar(List<String> labels, List<Rect> rectangles, int selected, IntConsumer onSelect) {
		tabs = IntStream.range(0, labels.size())
			.mapToObj(index -> tab(index, labels.get(index), rectangles.get(index), index == selected, onSelect))
			.toList();
	}

	List<Row.Action> tabs() {
		return tabs;
	}

	private static Row.Action tab(int index, String label, Rect rectangle, boolean selected, IntConsumer onSelect) {
		AbstractWidget button = Widgets.tab(label, rectangle.width(), selected, () -> onSelect.accept(index));
		button.setX(rectangle.x());
		button.setY(rectangle.y());
		button.active = !selected;
		return new Row.Action("tab" + index, button);
	}
}
