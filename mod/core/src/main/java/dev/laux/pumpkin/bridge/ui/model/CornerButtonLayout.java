package dev.laux.pumpkin.bridge.ui.model;

import java.util.List;
import java.util.Optional;

/** Finds a detached corner slot without moving or covering any native menu widget. */
public final class CornerButtonLayout {
	public static final int SIZE = 36;
	private static final int MARGIN = 8;
	private static final int FOOTER_CLEARANCE = 14;
	private static final int GAP = 4;

	private CornerButtonLayout() {
	}

	public static Optional<Rect> find(int width, int height, List<Rect> occupied) {
		if (width < SIZE + 2 * MARGIN || height < SIZE + MARGIN + FOOTER_CLEARANCE) {
			return Optional.empty();
		}
		for (int y = height - FOOTER_CLEARANCE - SIZE; y >= MARGIN; y -= SIZE + GAP) {
			Rect right = new Rect(width - MARGIN - SIZE, y, SIZE, SIZE);
			if (free(right, occupied)) {
				return Optional.of(right);
			}
			Rect left = new Rect(MARGIN, y, SIZE, SIZE);
			if (free(left, occupied)) {
				return Optional.of(left);
			}
		}
		return Optional.empty();
	}

	private static boolean free(Rect slot, List<Rect> occupied) {
		for (Rect widget : occupied) {
			if (slot.x() < widget.right() + GAP && slot.right() + GAP > widget.x()
				&& slot.y() < widget.bottom() + GAP && slot.bottom() + GAP > widget.y()) {
				return false;
			}
		}
		return true;
	}
}
