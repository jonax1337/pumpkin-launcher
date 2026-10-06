package dev.laux.pumpkin.bridge.compat;

import dev.laux.pumpkin.bridge.ui.model.Painter;
import dev.laux.pumpkin.bridge.ui.model.Rect;
import java.util.Optional;
import net.minecraft.client.gui.Font;
//? if >=26.1 {
import net.minecraft.client.gui.GuiGraphicsExtractor;
//?} else if >=1.20 {
/*import net.minecraft.client.gui.GuiGraphics;
*///?} else {
/*import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.systems.RenderSystem;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiComponent;
*///?}

final class CompatPainter implements Painter {
	//? if >=26.1 {
	private GuiGraphicsExtractor graphics;
	//?} else if >=1.20 {
	/*private GuiGraphics graphics;
	*///?} else {
	/*private PoseStack graphics;
	*///?}
	private final Font font;

	//? if >=26.1 {
	CompatPainter(GuiGraphicsExtractor graphics, Font font) {
	//?} else if >=1.20 {
	/*CompatPainter(GuiGraphics graphics, Font font) {
	*///?} else {
	/*CompatPainter(PoseStack graphics, Font font) {
	*///?}
		this.graphics = graphics;
		this.font = font;
	}

	CompatPainter(Font font) {
		this.font = font;
	}

	//? if >=26.1 {
	void bind(GuiGraphicsExtractor graphics) {
	//?} else if >=1.20 {
	/*void bind(GuiGraphics graphics) {
	*///?} else {
	/*void bind(PoseStack graphics) {
	*///?}
		this.graphics = graphics;
	}

	@Override
	public void fill(Rect area, int argb) {
		fill(area.x(), area.y(), area.width(), area.height(), argb);
	}

	@Override
	public void fill(int x, int y, int width, int height, int argb) {
		//? if >=1.20 {
		graphics.fill(x, y, x + width, y + height, argb);
		//?} else {
		/*GuiComponent.fill(graphics, x, y, x + width, y + height, argb);
		*///?}
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
		text(text, x, y, argb, false);
	}

	@Override
	public void text(String text, int x, int y, int argb, boolean shadow) {
		//? if >=26.1 {
		graphics.text(font, text, x, y, argb, shadow);
		//?} else if >=1.20 {
		/*graphics.drawString(font, text, x, y, argb, shadow);
		*///?} else {
		/*if (shadow) font.drawShadow(graphics, text, x, y, argb);
		else font.draw(graphics, text, x, y, argb);
		*///?}
	}

	@Override
	public void beginClip(Rect area) {
		//? if >=1.20 {
		graphics.enableScissor(area.x(), area.y(), area.right(), area.bottom());
		//?} else {
		/*Minecraft minecraft = Minecraft.getInstance();
		double scale = minecraft.getWindow().getGuiScale();
		int left = (int) Math.floor(area.x() * scale);
		int right = (int) Math.ceil(area.right() * scale);
		int top = (int) Math.floor(area.y() * scale);
		int bottom = (int) Math.ceil(area.bottom() * scale);
		RenderSystem.enableScissor(left, minecraft.getWindow().getHeight() - bottom,
			Math.max(0, right - left), Math.max(0, bottom - top));
		*///?}
	}

	@Override
	public void endClip() {
		//? if >=1.20 {
		graphics.disableScissor();
		//?} else {
		/*RenderSystem.disableScissor();
		*///?}
	}

	@Override
	public int codePointWidth(int codePoint) {
		return font.width(new String(Character.toChars(codePoint)));
	}

	@Override
	public int lineHeight() {
		return font.lineHeight;
	}
}
