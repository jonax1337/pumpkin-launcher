package dev.laux.pumpkin.friends.ui.model;

/** Shared ARGB palette for the Minecraft-free chrome and native widgets. */
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

	private PumpkinTheme() {
	}

	/** One-pixel notches leave the corners open without textures or rounded geometry. */
	public static void plate(Painter painter, int x, int y, int width, int height, int border, int surface) {
		if (width < 4 || height < 4) {
			return;
		}
		painter.fill(x + 1, y, width - 2, height, border);
		painter.fill(x, y + 1, width, height - 2, border);
		painter.fill(x + 1, y + 1, width - 2, height - 2, surface);
	}
}
