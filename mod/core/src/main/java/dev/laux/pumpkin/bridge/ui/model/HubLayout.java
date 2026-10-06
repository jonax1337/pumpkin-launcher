package dev.laux.pumpkin.bridge.ui.model;

import java.util.Objects;
import dev.laux.pumpkin.bridge.runtime.Immutable;

import java.util.ArrayList;
import java.util.List;

/**
 * Where everything of a hub-style screen goes (docs/bridge/README.md, "In-game navigation and world behavior"): title and status line on top, an optional tab bar, the body
 * that holds the scrolling rows, and the footer with its buttons. Designed for 320x240 GUI pixels; any other size only
 * changes the content width ({@code min(310, width - 20)}) and the body height.
 */
public final class HubLayout {
	private final Rect title;
	private final Rect status;
	private final List<Rect> tabs;
	private final Rect body;
	private final Rect footer;

	public HubLayout(Rect title, Rect status, List<Rect> tabs, Rect body, Rect footer) {
		tabs = Immutable.copyList(tabs);
		this.title = title;
		this.status = status;
		this.tabs = tabs;
		this.body = body;
		this.footer = footer;
	}

	public Rect title() {
		return title;
	}

	public Rect status() {
		return status;
	}

	public List<Rect> tabs() {
		return tabs;
	}

	public Rect body() {
		return body;
	}

	public Rect footer() {
		return footer;
	}

	@Override
	public boolean equals(Object other) {
		if (this == other) {
			return true;
		}
		if (!(other instanceof HubLayout)) {
			return false;
		}
		HubLayout that = (HubLayout) other;
		return Objects.equals(title, that.title)
			&& Objects.equals(status, that.status)
			&& Objects.equals(tabs, that.tabs)
			&& Objects.equals(body, that.body)
			&& Objects.equals(footer, that.footer);
	}

	@Override
	public int hashCode() {
		int hash = Objects.hashCode(title);
		hash = 31 * hash + Objects.hashCode(status);
		hash = 31 * hash + Objects.hashCode(tabs);
		hash = 31 * hash + Objects.hashCode(body);
		hash = 31 * hash + Objects.hashCode(footer);
		return hash;
	}

	@Override
	public String toString() {
		return "HubLayout[title=" + title + ", status=" + status + ", tabs=" + tabs + ", body=" + body + ", footer=" + footer + "]";
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
			return Immutable.list();
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
