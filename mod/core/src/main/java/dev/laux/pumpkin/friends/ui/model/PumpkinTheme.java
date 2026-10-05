package dev.laux.pumpkin.friends.ui.model;

/** Shared ARGB palette and drawing language for the Minecraft-free chrome and native widgets. */
public final class PumpkinTheme {
	public static final int PANEL = 0xFF211B18;
	public static final int SUNK = 0xFF171310;
	public static final int SURFACE = 0xFF332922;
	public static final int HOVER = 0xFF4A382B;
	public static final int BORDER = 0xFF8B7260;
	public static final int EDGE = 0xFF100D0B;
	public static final int ACCENT = 0xFFE39860;
	public static final int INK = 0xFF120C07;
	public static final int TEXT = 0xFFF6EEE4;
	public static final int MUTED = 0xFFC2AEA0;
	public static final int DISABLED = 0xFF988779;
	public static final int FOCUS = 0xFFF6E7C8;
	public static final int ONLINE = 0xFFA9D879;
	public static final int PLAYING = 0xFF7BCDD1;
	public static final int OFFLINE = 0xFFB5A397;

	/** The two tones every raised or sunken edge is drawn with, the bevel language of the vanilla widgets. */
	public static final int BEVEL_LIGHT = 0xFF54402E;
	public static final int BEVEL_DARK = 0xFF171310;

	/** Only the header pumpkin uses these: the darker flanks of the gourd and its stem. */
	public static final int GOURD = 0xFFB9683A;
	public static final int LEAF = 0xFF7C9A4E;

	/** The size of the header pumpkin, in GUI pixels. */
	public static final int GLYPH_WIDTH = 8;
	public static final int GLYPH_HEIGHT = 7;

	private PumpkinTheme() {
	}

	/**
	 * A plate in the chrome language of the vanilla widgets: a one-pixel outline, then a bevel — light above and on
	 * the left, dark below and on the right — around the face. A raised plate ({@code raised = true}) stands out like
	 * a button; a sunken one sits behind fields and lists.
	 */
	public static void plate(Painter painter, int x, int y, int width, int height, boolean raised, int outline,
		int face) {
		if (width < 4 || height < 4) {
			return;
		}
		int light = raised ? BEVEL_LIGHT : BEVEL_DARK;
		int dark = raised ? BEVEL_DARK : BEVEL_LIGHT;
		painter.fill(x, y, width, height, outline);
		painter.fill(x + 1, y, width - 2, 1, light);
		painter.fill(x, y + 1, 1, height - 2, light);
		painter.fill(x + 1, y + height - 1, width - 2, 1, dark);
		painter.fill(x + width - 1, y + 1, 1, height - 2, dark);
		painter.fill(x + 1, y + 1, width - 2, height - 2, face);
	}

	/** A scrollbar in the same language: a sunken groove as the track, an outlined thumb inside it. */
	public static void scrollbar(Painter painter, Rect track, Rect thumb) {
		plate(painter, track.x(), track.y(), track.width(), track.height(), false, EDGE, SUNK);
		painter.fill(thumb.x(), thumb.y(), Math.max(1, thumb.width()), thumb.height(), EDGE);
		painter.fill(thumb.x() + 1, thumb.y() + 1, Math.max(1, thumb.width() - 2), Math.max(1, thumb.height() - 2),
			ACCENT);
	}

	/**
	 * The mark of the screens, a seven-pixel pumpkin with stem, darker flanks and a small lantern face, drawn with
	 * plain fills at the top-left corner {@code (x, y)}; it is {@value #GLYPH_WIDTH}x{@value #GLYPH_HEIGHT} pixels.
	 */
	public static void paintPumpkin(Painter painter, int x, int y) {
		painter.fill(x + 3, y, 2, 2, LEAF);
		painter.fill(x + 1, y + 2, 6, 4, ACCENT);
		painter.fill(x, y + 3, 8, 3, ACCENT);
		painter.fill(x + 1, y + 6, 6, 1, ACCENT);
		painter.fill(x, y + 3, 1, 3, GOURD);
		painter.fill(x + 7, y + 3, 1, 3, GOURD);
		painter.fill(x + 2, y + 4, 1, 2, INK);
		painter.fill(x + 5, y + 4, 1, 2, INK);
		painter.fill(x + 3, y + 6, 2, 1, INK);
	}
}
