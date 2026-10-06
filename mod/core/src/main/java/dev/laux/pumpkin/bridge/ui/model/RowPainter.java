package dev.laux.pumpkin.bridge.ui.model;

import java.util.Optional;

/** Draws the text of one row inside its {@link RowLayout}: clipped to the free width, centred vertically in its line. */
public final class RowPainter {
	private RowPainter() {
	}

	public static void paint(Painter painter, RowLayout layout, RowStyle style, String firstLine, Optional<String> secondLine) {
		line(painter, layout.firstLine(), firstLine, style.argb());
		layout.secondLine().ifPresent(area -> secondLine.ifPresent(text -> line(painter, area, text, RowStyle.MUTED.argb())));
	}

	private static void line(Painter painter, Rect area, String text, int argb) {
		String fitted = Fit.clip(text, area.width(), painter::codePointWidth);
		int y = area.y() + (area.height() - painter.lineHeight()) / 2;
		painter.text(fitted, area.x(), y, argb, true);
	}
}
