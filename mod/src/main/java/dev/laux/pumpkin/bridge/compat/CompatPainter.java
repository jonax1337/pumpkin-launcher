package dev.laux.pumpkin.bridge.compat;

import dev.laux.pumpkin.bridge.ui.model.Painter;
import dev.laux.pumpkin.bridge.ui.model.Rect;
import java.util.Optional;
import net.minecraft.client.gui.Font;
//? if >=26.1 {
import net.minecraft.client.gui.GuiGraphicsExtractor;
//?} else {
/*import net.minecraft.client.gui.GuiGraphics;
*///?}

/**
 * The {@link Painter} over the graphics object of the running Minecraft version. INGAME-API.md 3, "Font, drawing, text
 * components": up to 1.21.11 {@code GuiGraphics#fill(int, int, int, int, int)} and {@code #drawString(Font, String, int,
 * int, int, boolean)} (its return type changes from {@code int} to {@code void} at 1.21.6; the result is not used here),
 * from 26.1 {@code GuiGraphicsExtractor#fill} and {@code #text(Font, String, int, int, int, boolean)}.
 */
final class CompatPainter implements Painter {
	//? if >=26.1 {
	private GuiGraphicsExtractor graphics;
	//?} else {
	/*private GuiGraphics graphics;
	*///?}
	private final Font font;

	//? if >=26.1 {
	CompatPainter(GuiGraphicsExtractor graphics, Font font) {
	//?} else {
	/*CompatPainter(GuiGraphics graphics, Font font) {
	*///?}
		this.graphics = graphics;
		this.font = font;
	}

	CompatPainter(Font font) {
		this.font = font;
	}

	//? if >=26.1 {
	void bind(GuiGraphicsExtractor graphics) {
	//?} else {
	/*void bind(GuiGraphics graphics) {
	*///?}
		this.graphics = graphics;
	}

	@Override
	public void fill(Rect area, int argb) {
		graphics.fill(area.x(), area.y(), area.right(), area.bottom(), argb);
	}

	@Override
	public void fill(int x, int y, int width, int height, int argb) {
		graphics.fill(x, y, x + width, y + height, argb);
	}

	@Override
	public void head(String name, Optional<String> uuid, Rect bounds) {
		PlayerHeads.draw(graphics, name, uuid, bounds);
	}

	@Override
	public int textWidth(String text) {
		return font.width(text);
	}

	@Override
	public void text(String text, int x, int y, int argb) {
		//? if >=26.1 {
		graphics.text(font, text, x, y, argb, false);
		//?} else {
		/*graphics.drawString(font, text, x, y, argb, false);
	*///?}
	}

	//? if >=26.1 {
	@Override
	public void text(String text, int x, int y, int argb, boolean shadow) {
		graphics.text(font, text, x, y, argb, shadow);
	}
	//?} else {
	/*@Override
	public void text(String text, int x, int y, int argb, boolean shadow) {
		graphics.drawString(font, text, x, y, argb, shadow);
	}
	*///?}

	/** {@code enableScissor(int, int, int, int)} and {@code disableScissor()} exist in every era. */
	@Override
	public void beginClip(Rect area) {
		graphics.enableScissor(area.x(), area.y(), area.right(), area.bottom());
	}

	@Override
	public void endClip() {
		graphics.disableScissor();
	}

	/** {@code Font#width(String)} exists in every era (same table). */
	@Override
	public int codePointWidth(int codePoint) {
		return font.width(new String(Character.toChars(codePoint)));
	}

	/** {@code Font#lineHeight} is a field in every era (same table). */
	@Override
	public int lineHeight() {
		return font.lineHeight;
	}
}
