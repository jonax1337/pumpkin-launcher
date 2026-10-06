package dev.laux.pumpkin.bridge.ui.model;

import java.awt.image.BufferedImage;
import java.util.ArrayList;
import java.util.List;

/** Immutable horizontal pixel runs, decoded once and drawn without per-frame image work. */
public final class PixelIcon {
	private final int width;
	private final int height;
	private final int[] runs;

	private PixelIcon(int width, int height, int[] runs) {
		this.width = width;
		this.height = height;
		this.runs = runs;
	}

	public static PixelIcon image(BufferedImage image) {
		List<Integer> runs = new ArrayList<>();
		for (int y = 0; y < image.getHeight(); y++) {
			for (int x = 0; x < image.getWidth();) {
				int start = x;
				int color = image.getRGB(x++, y);
				while (x < image.getWidth() && image.getRGB(x, y) == color) {
					x++;
				}
				if ((color >>> 24) != 0) {
					runs.add(start);
					runs.add(y);
					runs.add(x - start);
					runs.add(color);
				}
			}
		}
		return new PixelIcon(image.getWidth(), image.getHeight(), runs.stream().mapToInt(Integer::intValue).toArray());
	}

	public static PixelIcon mask(String[] rows, int color) {
		BufferedImage image = new BufferedImage(rows[0].length(), rows.length, BufferedImage.TYPE_INT_ARGB);
		for (int y = 0; y < rows.length; y++) {
			for (int x = 0; x < rows[y].length(); x++) {
				if (rows[y].charAt(x) == '#') {
					image.setRGB(x, y, color);
				}
			}
		}
		return image(image);
	}

	public void paint(Painter painter, int x, int y, int size) {
		int scale = Math.max(1, size / Math.max(width, height));
		int left = x + (size - width * scale) / 2;
		int top = y + (size - height * scale) / 2;
		for (int index = 0; index < runs.length; index += 4) {
			painter.fill(left + runs[index] * scale, top + runs[index + 1] * scale,
				runs[index + 2] * scale, scale, runs[index + 3]);
		}
	}
}
