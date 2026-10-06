package dev.laux.pumpkin.bridge.ui.model;

/** The fixed measures of the in-game screens, in GUI pixels (docs/bridge/README.md, "In-game navigation and world behavior"). Every layout class reads them from here. */
public final class GuiMetrics {
	/** The widest the content gets; narrower windows use the window width minus a margin on each side. */
	public static final int MAX_CONTENT_WIDTH = 310;
	public static final int MIN_SIDE_MARGIN = 10;

	public static final int ROW_HEIGHT = 24;
	public static final int TWO_LINE_ROW_HEIGHT = 36;
	public static final int BUTTON_HEIGHT = 20;

	/** Below this content width the tab bar wraps to two rows. */
	public static final int TAB_WRAP_WIDTH = 300;
	public static final int TAB_GAP = 2;

	public static final int SECTION_GAP = 4;
	public static final int HEADER_TOP = 6;
	public static final int HEADER_LINE_HEIGHT = 10;
	public static final int HEADER_LINE_GAP = 2;
	public static final int FOOTER_HEIGHT = 28;
	public static final int FOOTER_BUTTON_MAX_WIDTH = 200;
	public static final int FOOTER_BUTTON_GAP = 4;

	public static final int ROW_PADDING = 4;
	public static final int ROW_ACTION_GAP = 4;
	public static final int ROW_TEXT_LINE_HEIGHT = 12;

	public static final int SCROLLBAR_WIDTH = 4;
	/** Space reserved right of the rows so the scrollbar never overlaps a button. */
	public static final int SCROLLBAR_GUTTER = 6;
	public static final int SCROLLBAR_MIN_THUMB = 8;

	private GuiMetrics() {
	}
}
