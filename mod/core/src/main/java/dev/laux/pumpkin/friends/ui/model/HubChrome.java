package dev.laux.pumpkin.friends.ui.model;

/** Draws what every hub screen has besides its widgets: the body backdrop, the title and the status line. */
public final class HubChrome {
	static final int BODY_BACKDROP = 0x70000000;
	static final int TITLE_COLOR = 0xFFFFFFFF;
	static final int STATUS_COLOR = 0xFFAAAAAA;

	private HubChrome() {
	}

	/** Drawn behind the widgets. */
	public static void paintBackdrop(Painter painter, HubLayout layout) {
		painter.fill(layout.body(), BODY_BACKDROP);
	}

	/** Drawn over the widgets. Both lines are centred in the content width and clipped to it. */
	public static void paintHeader(Painter painter, HubLayout layout, String title, String status) {
		centred(painter, layout.title(), title, TITLE_COLOR);
		centred(painter, layout.status(), status, STATUS_COLOR);
	}

	private static void centred(Painter painter, Rect line, String text, int color) {
		String fitted = Fit.clip(text, line.width(), painter::codePointWidth);
		int x = line.x() + (line.width() - painter.textWidth(fitted)) / 2;
		int y = line.y() + (line.height() - painter.lineHeight()) / 2;
		painter.text(fitted, x, y, color);
	}
}
