package dev.laux.pumpkin.bridge.ui.model;

import java.util.ArrayList;
import java.util.List;

/**
 * The geometry of a tab bar: one row, or two rows when the content is narrower than
 * {@link GuiMetrics#TAB_WRAP_WIDTH}. Every row fills the whole width, so the tabs of a short second row are wider.
 */
public final class TabBarModel {
	private final int tabCount;
	private final int width;

	public TabBarModel(int tabCount, int width) {
		this.tabCount = tabCount;
		this.width = width;
	}

	public int rows() {
		return width < GuiMetrics.TAB_WRAP_WIDTH && tabCount > 1 ? 2 : 1;
	}

	public int height() {
		if (tabCount == 0) {
			return 0;
		}
		return rows() * GuiMetrics.BUTTON_HEIGHT + (rows() - 1) * GuiMetrics.TAB_GAP;
	}

	/** One rectangle per tab, in tab order, with the bar's top-left corner at {@code (left, top)}. */
	public List<Rect> tabs(int left, int top) {
		List<Rect> tabs = new ArrayList<>(tabCount);
		int tabsPerRow = (tabCount + rows() - 1) / rows();
		for (int row = 0; row < rows(); row++) {
			int first = row * tabsPerRow;
			int inThisRow = Math.min(tabsPerRow, tabCount - first);
			int rowTop = top + row * (GuiMetrics.BUTTON_HEIGHT + GuiMetrics.TAB_GAP);
			addRow(tabs, left, rowTop, inThisRow);
		}
		return tabs;
	}

	private void addRow(List<Rect> tabs, int left, int top, int count) {
		if (count <= 0) {
			return;
		}
		int usable = width - GuiMetrics.TAB_GAP * (count - 1);
		int baseWidth = usable / count;
		int widerTabs = usable % count;
		int x = left;
		for (int index = 0; index < count; index++) {
			int tabWidth = baseWidth + (index < widerTabs ? 1 : 0);
			tabs.add(new Rect(x, top, tabWidth, GuiMetrics.BUTTON_HEIGHT));
			x += tabWidth + GuiMetrics.TAB_GAP;
		}
	}
}
