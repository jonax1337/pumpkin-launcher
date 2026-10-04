package dev.laux.pumpkin.friends.ui.model;

/** An axis-aligned rectangle in GUI pixels: top-left corner plus size. */
public record Rect(int x, int y, int width, int height) {
	public int right() {
		return x + width;
	}

	public int bottom() {
		return y + height;
	}

	public Rect withY(int newY) {
		return new Rect(x, newY, width, height);
	}

	/** The golden-file notation: {@code x,y WxH}. */
	@Override
	public String toString() {
		return x + "," + y + " " + width + "x" + height;
	}
}
