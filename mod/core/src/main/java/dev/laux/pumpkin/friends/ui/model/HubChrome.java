package dev.laux.pumpkin.friends.ui.model;

/** Draws what every hub screen has besides its widgets: the body backdrop, the title and the status line. */
public final class HubChrome {
	private static final int GLYPH_GAP = 2;

	private final FittedLine title = new FittedLine();
	private final FittedLine status = new FittedLine();

	/** Drawn behind the widgets. */
	public static void paintBackdrop(Painter painter, HubLayout layout) {
		Rect body = layout.body();
		Rect title = layout.title();
		Rect status = layout.status();
		Rect footer = layout.footer();
		int left = body.x() - 5;
		int width = body.width() + 10;
		int top = title.y() - 3;
		int bottom = footer.bottom();
		painter.fill(left, top, width, bottom - top, PumpkinTheme.BORDER);
		painter.fill(left + 1, top + 1, width - 2, bottom - top - 2, PumpkinTheme.PANEL);

		// The warm masthead ends before navigation; the status has its own quieter band.
		painter.fill(left + 1, top + 1, width - 2, title.bottom() - top, PumpkinTheme.GOURD);
		painter.fill(left + 1, top + 1, width - 2, 1, PumpkinTheme.ACCENT);
		painter.fill(left + 1, title.bottom() + 1, width - 2,
			Math.max(0, status.bottom() - title.bottom()), PumpkinTheme.SURFACE);
		painter.fill(left + 1, status.bottom() + 1, width - 2, 1, PumpkinTheme.EDGE);

		if (!layout.tabs().isEmpty()) {
			int navTop = layout.tabs().get(0).y() - 2;
			painter.fill(left + 1, navTop, width - 2, Math.max(0, body.y() - navTop - 2),
				PumpkinTheme.SURFACE);
		}
		PumpkinTheme.plate(painter, body.x(), body.y(), body.width(), body.height(), false, PumpkinTheme.EDGE,
			PumpkinTheme.SUNK);
		painter.fill(left + 1, footer.y(), width - 2, Math.max(0, footer.height() - 1), PumpkinTheme.HOVER);
		painter.fill(left + 1, footer.y(), width - 2, 1, PumpkinTheme.BORDER);
	}

	/**
	 * Drawn over the widgets. The pumpkin and the title are centred as one group, the status line on its own; both
	 * lines are clipped to their width. Every line carries the drop shadow of the vanilla screens.
	 */
	public void paintHeader(Painter painter, HubLayout layout, String titleText, String statusText) {
		Rect titleLine = layout.title();
		String fitted = title.fit(titleText,
			Math.max(0, titleLine.width() - PumpkinTheme.GLYPH_WIDTH - GLYPH_GAP), painter);
		int groupWidth = PumpkinTheme.GLYPH_WIDTH + GLYPH_GAP + painter.textWidth(fitted);
		int startX = titleLine.x() + Math.max(0, (titleLine.width() - groupWidth) / 2);
		PumpkinTheme.paintPumpkin(painter, startX,
			titleLine.y() + (titleLine.height() - PumpkinTheme.GLYPH_HEIGHT) / 2);
		painter.text(fitted, startX + PumpkinTheme.GLYPH_WIDTH + GLYPH_GAP,
			titleLine.y() + (titleLine.height() - painter.lineHeight()) / 2, PumpkinTheme.TEXT, true);

		Rect statusLine = layout.status();
		String statusFitted = status.fit(statusText, statusLine.width(), painter);
		int statusX = statusLine.x() + Math.max(0, (statusLine.width() - painter.textWidth(statusFitted)) / 2);
		painter.text(statusFitted, statusX,
			statusLine.y() + (statusLine.height() - painter.lineHeight()) / 2, PumpkinTheme.MUTED, true);
	}

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
