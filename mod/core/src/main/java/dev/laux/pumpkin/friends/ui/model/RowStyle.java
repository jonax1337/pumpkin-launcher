package dev.laux.pumpkin.friends.ui.model;

/** How a row's text looks: the colour is the only difference, so a row never changes its layout with its style. */
public enum RowStyle {
	HEADING(0xFFFFAA00),
	NORMAL(0xFFFFFFFF),
	MUTED(0xFFAAAAAA);

	private final int argb;

	RowStyle(int argb) {
		this.argb = argb;
	}

	public int argb() {
		return argb;
	}
}
