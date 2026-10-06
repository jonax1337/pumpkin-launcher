package dev.laux.pumpkin.bridge.ui.model;

import java.util.Objects;
import dev.laux.pumpkin.bridge.runtime.Immutable;

import java.util.ArrayList;
import java.util.List;

/** The Bridge home uses the shared chrome around a responsive grid of module tiles. */
public final class HomeLayout {
	private final HubLayout chrome;
	private final List<Rect> tiles;

	public HomeLayout(HubLayout chrome, List<Rect> tiles) {
		tiles = Immutable.copyList(tiles);
		this.chrome = chrome;
		this.tiles = tiles;
	}

	public HubLayout chrome() {
		return chrome;
	}

	public List<Rect> tiles() {
		return tiles;
	}

	@Override
	public boolean equals(Object other) {
		if (this == other) {
			return true;
		}
		if (!(other instanceof HomeLayout)) {
			return false;
		}
		HomeLayout that = (HomeLayout) other;
		return Objects.equals(chrome, that.chrome)
			&& Objects.equals(tiles, that.tiles);
	}

	@Override
	public int hashCode() {
		int hash = Objects.hashCode(chrome);
		hash = 31 * hash + Objects.hashCode(tiles);
		return hash;
	}

	@Override
	public String toString() {
		return "HomeLayout[chrome=" + chrome + ", tiles=" + tiles + "]";
	}

	private static final int MAX_WIDTH = 470;
	private static final int PADDING = 10;
	private static final int GAP = 10;
	private static final int TILE_WIDTH = 210;
	private static final int TILE_HEIGHT = 100;


	public static HomeLayout of(int width, int height, int count) {
		int contentWidth = Math.max(0, Math.min(MAX_WIDTH, width - 2 * GuiMetrics.MIN_SIDE_MARGIN));
		int left = (width - contentWidth) / 2;
		Rect title = new Rect(left, 12, contentWidth, 18);
		Rect status = new Rect(left, title.bottom() + 2, contentWidth, 14);
		Rect footer = new Rect(left, height - GuiMetrics.FOOTER_HEIGHT, contentWidth, GuiMetrics.FOOTER_HEIGHT);
		Rect body = new Rect(left, status.bottom() + 6, contentWidth,
			Math.max(0, footer.y() - status.bottom() - 10));
		HubLayout chrome = new HubLayout(title, status, Immutable.list(), body, footer);
		return new HomeLayout(chrome, grid(body, count));
	}

	private static List<Rect> grid(Rect body, int count) {
		if (count == 0) {
			return Immutable.list();
		}
		int available = Math.max(0, body.width() - 2 * PADDING);
		int columns = available >= 2 * TILE_WIDTH + GAP ? 2 : 1;
		int rows = (count + columns - 1) / columns;
		int tileWidth = Math.min(TILE_WIDTH, Math.max(0, (available - (columns - 1) * GAP) / columns));
		int tileHeight = Math.min(TILE_HEIGHT, Math.max(0, (body.height() - 2 * PADDING - (rows - 1) * GAP) / rows));
		List<Rect> tiles = new ArrayList<>(count);
		for (int index = 0; index < count; index++) {
			tiles.add(new Rect(body.x() + PADDING + (index % columns) * (tileWidth + GAP),
				body.y() + PADDING + (index / columns) * (tileHeight + GAP), tileWidth, tileHeight));
		}
		return tiles;
	}
}
