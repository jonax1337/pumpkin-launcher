package dev.laux.pumpkin.friends.ui.model;

/** Draws what every hub screen has besides its widgets: the body backdrop, the title and the status line. */
public final class HubChrome {
	private final FittedLine title = new FittedLine();
	private final FittedLine status = new FittedLine();

	/** Drawn behind the widgets. */
	public static void paintBackdrop(Painter painter, HubLayout layout) {
		Rect body = layout.body();
		int left = body.x() - 5;
		int top = layout.title().y() - 3;
		int bottom = layout.footer().bottom();
		PumpkinTheme.plate(painter, left, top, body.width() + 10, bottom - top,
			PumpkinTheme.BORDER, PumpkinTheme.PANEL);
		PumpkinTheme.plate(painter, body.x(), body.y(), body.width(), body.height(),
			PumpkinTheme.SURFACE, PumpkinTheme.SUNK);
		painter.fill(body.x() + 3, top, Math.max(0, body.width() - 6), 2, PumpkinTheme.ACCENT);
		painter.fill(body.x(), layout.footer().y(), body.width(), 1, PumpkinTheme.SURFACE);
	}

	/** Drawn over the widgets. Both lines are centred in the content width and clipped to it. */
	public void paintHeader(Painter painter, HubLayout layout, String titleText, String statusText) {
		centred(painter, layout.title(), title.fit(titleText, layout.title().width(), painter), PumpkinTheme.ACCENT);
		centred(painter, layout.status(), status.fit(statusText, layout.status().width(), painter), PumpkinTheme.MUTED);
	}

	private static void centred(Painter painter, Rect line, String text, int color) {
		int x = line.x() + (line.width() - painter.textWidth(text)) / 2;
		int y = line.y() + (line.height() - painter.lineHeight()) / 2;
		painter.text(text, x, y, color);
	}

	/** One header line, fitted again only when its text or its line width changes; screens redraw every frame. */
	private static final class FittedLine {
		private String source = "";
		private String fitted = "";
		private int maxWidth = -1;

		String fit(String text, int maxWidth, Painter painter) {
			if (!text.equals(source) || maxWidth != this.maxWidth) {
				source = text;
				fitted = Fit.clip(text, maxWidth, painter::codePointWidth);
				this.maxWidth = maxWidth;
			}
			return fitted;
		}
	}
}
