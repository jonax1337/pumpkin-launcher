package dev.laux.pumpkin.bridge.ui.model;

/** An axis-aligned rectangle in GUI pixels: top-left corner plus size. */
public final class Rect {
	private final int x;
	private final int y;
	private final int width;
	private final int height;

	public Rect(int x, int y, int width, int height) {
		this.x = x;
		this.y = y;
		this.width = width;
		this.height = height;
	}

	public int x() {
		return x;
	}

	public int y() {
		return y;
	}

	public int width() {
		return width;
	}

	public int height() {
		return height;
	}

	@Override
	public boolean equals(Object other) {
		if (this == other) {
			return true;
		}
		if (!(other instanceof Rect)) {
			return false;
		}
		Rect that = (Rect) other;
		return x == that.x
			&& y == that.y
			&& width == that.width
			&& height == that.height;
	}

	@Override
	public int hashCode() {
		int hash = Integer.hashCode(x);
		hash = 31 * hash + Integer.hashCode(y);
		hash = 31 * hash + Integer.hashCode(width);
		hash = 31 * hash + Integer.hashCode(height);
		return hash;
	}


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
