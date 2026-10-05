package dev.laux.pumpkin.bridge.ui.model;

/** How a row's text looks: the colour is the only difference, so a row never changes its layout with its style. */
public enum RowStyle {
	HEADING(PumpkinTheme.ACCENT),
	NORMAL(PumpkinTheme.TEXT),
	MUTED(PumpkinTheme.MUTED);

	private final int argb;

	RowStyle(int argb) {
		this.argb = argb;
	}

	public int argb() {
		return argb;
	}
}
