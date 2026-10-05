package dev.laux.pumpkin.bridge.ui.model;

import java.util.ArrayList;
import java.util.List;

/**
 * Where everything of a hub-style screen goes (INGAME 6.2): title and status line on top, an optional tab bar, the body
 * that holds the scrolling rows, and the footer with its buttons. Designed for 320x240 GUI pixels; any other size only
 * changes the content width ({@code min(310, width - 20)}) and the body height.
 */
public record HubLayout(Rect title, Rect status, List<Rect> tabs, Rect body, Rect footer) {
	public HubLayout {
		tabs = List.copyOf(tabs);
	}

	public static HubLayout of(int screenWidth, int screenHeight, int tabCount) {
		int contentWidth = Math.max(0, Math.min(GuiMetrics.MAX_CONTENT_WIDTH, screenWidth - 2 * GuiMetrics.MIN_SIDE_MARGIN));
		int left = (screenWidth - contentWidth) / 2;
		Rect title = new Rect(left, GuiMetrics.HEADER_TOP, contentWidth, GuiMetrics.HEADER_LINE_HEIGHT);
		Rect status = title.withY(title.bottom() + GuiMetrics.HEADER_LINE_GAP);
		int tabBarTop = status.bottom() + GuiMetrics.SECTION_GAP;
		TabBarModel tabBar = new TabBarModel(tabCount, contentWidth);
		int bodyTop = tabCount == 0 ? tabBarTop : tabBarTop + tabBar.height() + GuiMetrics.SECTION_GAP;
		Rect footer = new Rect(left, screenHeight - GuiMetrics.FOOTER_HEIGHT, contentWidth, GuiMetrics.FOOTER_HEIGHT);
		int bodyHeight = Math.max(0, footer.y() - GuiMetrics.SECTION_GAP - bodyTop);
		return new HubLayout(title, status, tabBar.tabs(left, tabBarTop), new Rect(left, bodyTop, contentWidth, bodyHeight), footer);
	}

	/** {@code count} equally wide footer buttons, centred as a group; one button is at most 200 px wide. */
	public List<Rect> footerButtons(int count) {
		if (count == 0) {
			return List.of();
		}
		int gaps = GuiMetrics.FOOTER_BUTTON_GAP * (count - 1);
		int buttonWidth = Math.min(GuiMetrics.FOOTER_BUTTON_MAX_WIDTH, (footer.width() - gaps) / count);
		int groupWidth = count * buttonWidth + gaps;
		int top = footer.y() + (footer.height() - GuiMetrics.BUTTON_HEIGHT) / 2;
		List<Rect> buttons = new ArrayList<>(count);
		int x = footer.x() + (footer.width() - groupWidth) / 2;
		for (int index = 0; index < count; index++) {
			buttons.add(new Rect(x, top, buttonWidth, GuiMetrics.BUTTON_HEIGHT));
			x += buttonWidth + GuiMetrics.FOOTER_BUTTON_GAP;
		}
		return buttons;
	}
}
