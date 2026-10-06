package dev.laux.pumpkin.bridge.compat;

import dev.laux.pumpkin.bridge.ui.UiSession;
import dev.laux.pumpkin.bridge.ui.kit.BridgeIcons;
import dev.laux.pumpkin.bridge.ui.kit.BridgeModule;
import dev.laux.pumpkin.bridge.ui.model.Fit;
import dev.laux.pumpkin.bridge.ui.model.GuiMetrics;
import dev.laux.pumpkin.bridge.ui.model.PumpkinTheme;
import dev.laux.pumpkin.bridge.ui.model.Rect;
import java.util.List;
import java.util.function.Consumer;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
//? if >=1.19.3 {
import net.minecraft.client.gui.components.Tooltip;
//?}
//? if >=1.17 {
import net.minecraft.client.gui.narration.NarratedElementType;
import net.minecraft.client.gui.narration.NarrationElementOutput;
//?}
import net.minecraft.network.chat.Component;
//? if >=26.1 {
import net.minecraft.client.gui.GuiGraphicsExtractor;
//?} else if >=1.20 {
/*import net.minecraft.client.gui.GuiGraphics;
*///?} else {
/*import com.mojang.blaze3d.vertex.PoseStack;
*///?}

/**
 * The widgets of the kit preserve vanilla input and narration while drawing the Pumpkin palette. They are created at
 * {@code (0, 0)}; the screen layout moves them. Their handlers run in the session's soft-failure guard (docs/bridge/README.md):
 * vanilla calls them from its own input dispatch, so a press that fails must not throw into the game.
 * docs/bridge/MINECRAFT-API.md, tables "Widgets: Button, Checkbox, text" and "Widgets: EditBox".
 */
public final class Widgets {
	private Widgets() {
	}

	public static int x(AbstractWidget widget) {
		//? if >=1.19.3 {
		return widget.getX();
		//?} else {
		/*return widget.x;
		*///?}
	}

	public static int y(AbstractWidget widget) {
		//? if >=1.19.3 {
		return widget.getY();
		//?} else {
		/*return widget.y;
		*///?}
	}

	public static void setPosition(AbstractWidget widget, int x, int y) {
		//? if >=1.19.3 {
		widget.setX(x);
		widget.setY(y);
		//?} else {
		/*widget.x = x;
		widget.y = y;
		*///?}
	}

	public static void setFocused(AbstractWidget widget, boolean focused) {
		//? if >=1.19.4 {
		widget.setFocused(focused);
		//?} else {
		/*if (widget instanceof EditBox) {
			((EditBox) widget).setFocus(focused);
		} else if (widget.isFocused() != focused) {
			widget.changeFocus(true);
		}
		*///?}
	}

	/** Button's protected constructor and default narration exist in every supported era. */
	public static AbstractWidget button(String label, int width, Runnable onPress) {
		return new PumpkinButton(label, width, false, onPress);
	}

	public static AbstractWidget tab(String label, int width, boolean selected, Runnable onPress) {
		return new PumpkinButton(label, width, selected, onPress);
	}

	public static AbstractWidget pumpkinLogo(Runnable onPress) {
		return new PumpkinLogo(onPress);
	}

	public static AbstractWidget moduleTile(BridgeModule module, Rect bounds, Runnable onPress) {
		return new ModuleTile(module, bounds, onPress);
	}

	/**
	 * Legacy EditBoxes draw the hint explicitly; newer ones provide {@code setHint}. All retain vanilla input handling.
	 * The box keeps its vanilla look — the black field with the grey frame that vanilla also puts on its dark screens.
	 */
	public static EditBox editBox(String hint, int width, int maxLength) {
		//? if >=1.19.3 {
		EditBox box = new EditBox(font(), 0, 0, width, GuiMetrics.BUTTON_HEIGHT, Text.literal(hint));
		//?} else {
		/*EditBox box = new LegacyEditBox(hint, width);
		*///?}
		//? if >=1.19.3 {
		box.setHint(Text.literal(hint));
		//?}
		box.setMaxLength(maxLength);
		return box;
	}

	//? if <1.19.3 {
	/*private static final class LegacyEditBox extends EditBox {
		private final String hint;

		LegacyEditBox(String hint, int width) {
			super(font(), 0, 0, width, GuiMetrics.BUTTON_HEIGHT, Text.literal(hint));
			this.hint = hint;
		}

		@Override
		public void renderButton(PoseStack graphics, int mouseX, int mouseY, float partialTick) {
			super.renderButton(graphics, mouseX, mouseY, partialTick);
			if (visible && getValue().isEmpty() && !isFocused()) {
				font().draw(graphics, font().plainSubstrByWidth(hint, getInnerWidth()),
					x(this) + 4, y(this) + (getHeight() - 8) / 2, PumpkinTheme.MUTED);
			}
		}
	}
	*///?}

	/**
	 * A toggle drawn as a small sunken field with a pumpkin marker, in place of vanilla's checkbox whose light sprite
	 * would clash with the dark panel. It stays a {@code Button}: era-specific constructors and the {@code OnPress}
	 * lambda keep vanilla's clicks, click sound, focus and key handling; only the drawing and the
	 * checkbox narration are ours.
	 */
	public static AbstractWidget toggle(String label, boolean selected, Consumer<Boolean> onChange) {
		return new PumpkinToggle(label, selected, onChange);
	}

	private static Font font() {
		return Minecraft.getInstance().font;
	}

	/** Everything the two Pumpkin buttons share: the painter, the era-specific render hook and the fitted label. */
	private abstract static class PumpkinWidget extends Button {
		protected final CompatPainter painter = new CompatPainter(font());
		private final String label;
		private int fittedWidth = -1;
		private String fittedLabel = "";

		protected PumpkinWidget(String label, int width, Runnable action) {
			this(label, width, GuiMetrics.BUTTON_HEIGHT, action);
		}

		protected PumpkinWidget(String label, int width, int height, Runnable action) {
			//? if >=1.19.3 {
			super(0, 0, width, height, Text.literal(label),
				pressed -> UiSession.run(action), DEFAULT_NARRATION);
			//?} else {
			/*super(0, 0, width, height, Text.literal(label), pressed -> UiSession.run(action));
			*///?}
			this.label = label;
		}

		// Input, click sound, tooltips and narration stay inherited from Button.
		//? if >=26.1 {
		@Override
		protected void extractContents(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float partialTick) {
		//?} else if >=1.21.11 {
		/*@Override
		protected void renderContents(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
		*///?} else if >=1.20 {
		/*@Override
		public void renderWidget(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
		*///?} else {
		/*@Override
		public void renderButton(PoseStack graphics, int mouseX, int mouseY, float partialTick) {
		*///?}
			painter.bind(graphics);
			paint(mouseX, mouseY);
		}

		/** Clips the label to {@code maxWidth}, fitted again only when the width changes; screens redraw every frame. */
		protected final String fittedLabel(int maxWidth) {
			if (fittedWidth != maxWidth) {
				fittedWidth = maxWidth;
				fittedLabel = Fit.clip(label, Math.max(0, maxWidth), painter::codePointWidth);
			}
			return fittedLabel;
		}

		protected final void paintOutline(int x, int y, int width, int height, int color) {
			if (width <= 0 || height <= 0) {
				return;
			}
			painter.fill(x, y, width, 1, color);
			painter.fill(x, y + height - 1, width, 1, color);
			painter.fill(x, y, 1, height, color);
			painter.fill(x + width - 1, y, 1, height, color);
		}

		protected final int labelY() {
			// Vanilla centres the eight-pixel glyph, not Font's nine-pixel line spacing.
			return y(this) + (getHeight() - 8) / 2;
		}

		protected abstract void paint(int mouseX, int mouseY);
	}

	private static final class PumpkinButton extends PumpkinWidget {
		private final boolean selected;

		PumpkinButton(String label, int width, boolean selected, Runnable onPress) {
			super(label, width, onPress);
			this.selected = selected;
		}

		@Override
		protected void paint(int mouseX, int mouseY) {
			int x = x(this);
			int y = y(this);
			int width = getWidth();
			int height = getHeight();
			boolean hover = active && isMouseOver(mouseX, mouseY);
			int face = selected ? PumpkinTheme.ACCENT
				: !active ? PumpkinTheme.PANEL : hover ? PumpkinTheme.HOVER : PumpkinTheme.SURFACE;
			int outline = isFocused() ? PumpkinTheme.FOCUS
				: selected || hover ? PumpkinTheme.ACCENT : active ? PumpkinTheme.BORDER : PumpkinTheme.SURFACE;
			PumpkinTheme.plate(painter, x, y, width, height, active && !selected, outline, face);
			paintOutline(x, y, width, height, outline);
			int textColor = selected ? PumpkinTheme.INK : active ? PumpkinTheme.TEXT : PumpkinTheme.DISABLED;
			String label = fittedLabel(width - 12);
			painter.text(label, x + (width - painter.textWidth(label)) / 2,
				labelY(), textColor, !selected);
		}
	}

	private static final class PumpkinLogo extends PumpkinWidget {
		PumpkinLogo(Runnable onPress) {
			super(Text.translate("pumpkin_bridge.button"), 36, 36, onPress);
			//? if >=1.19.3 {
			setTooltip(Tooltip.create(Text.literal(Text.translate("pumpkin_bridge.button"))));
			//?}
		}

		//? if <1.19.3 {
		/*@Override
		public void renderButton(PoseStack graphics, int mouseX, int mouseY, float partialTick) {
			super.renderButton(graphics, mouseX, mouseY, partialTick);
			if (isMouseOver(mouseX, mouseY) && GameScreens.current() != null) {
				GameScreens.current().renderTooltip(graphics,
					Text.literal(Text.translate("pumpkin_bridge.button")), mouseX, mouseY);
			}
		}
		*///?}

		@Override
		protected void paint(int mouseX, int mouseY) {
			int outline = isFocused() ? PumpkinTheme.FOCUS
				: isMouseOver(mouseX, mouseY) ? PumpkinTheme.ACCENT : PumpkinTheme.BORDER;
			PumpkinTheme.plate(painter, x(this), y(this), getWidth(), getHeight(), true, outline, PumpkinTheme.SUNK);
			paintOutline(x(this), y(this), getWidth(), getHeight(), outline);
			BridgeIcons.PUMPKIN.paint(painter, x(this) + 2, y(this) + 2, 32);
		}
	}

	private static final class ModuleTile extends PumpkinWidget {
		private final BridgeModule module;
		private final String title;
		private final List<String> description;
		private final String summary;
		private final Rect clip;

		ModuleTile(BridgeModule module, Rect bounds, Runnable onPress) {
			super(module.title() + ", " + module.description() + ", " + module.summary(), bounds.width(), bounds.height(), onPress);
			this.module = module;
			Widgets.setPosition(this, bounds.x(), bounds.y());
			clip = new Rect(bounds.x() + 2, bounds.y() + 2, Math.max(0, bounds.width() - 4), Math.max(0, bounds.height() - 4));
			title = Fit.clip(module.title(), Math.max(0, bounds.width() - 58), painter::codePointWidth);
			description = Fit.wrap(module.description(), Math.max(1, bounds.width() - 24), painter::textWidth);
			summary = Fit.clip(module.summary(), Math.max(0, bounds.width() - 24), painter::codePointWidth);
		}

		@Override
		protected void paint(int mouseX, int mouseY) {
			int outline = isFocused() ? PumpkinTheme.FOCUS
				: isMouseOver(mouseX, mouseY) ? PumpkinTheme.ACCENT : PumpkinTheme.BORDER;
			int face = isMouseOver(mouseX, mouseY) ? PumpkinTheme.HOVER : PumpkinTheme.SURFACE;
			PumpkinTheme.plate(painter, x(this), y(this), getWidth(), getHeight(), true, outline, face);
			paintOutline(x(this), y(this), getWidth(), getHeight(), outline);
			painter.beginClip(clip);
			module.icon().paint(painter, x(this) + 12, y(this) + 8, 28);
			painter.text(title, x(this) + 50, y(this) + 18, PumpkinTheme.TEXT, true);
			int bottom = y(this) + getHeight() - 24;
			for (int index = 0; index < description.size() && y(this) + 44 + index * 11 < bottom - 8; index++) {
				painter.text(description.get(index), x(this) + 12, y(this) + 44 + index * 11, PumpkinTheme.MUTED);
			}
			if (getHeight() >= 72) {
				painter.fill(x(this) + 12, bottom, Math.max(0, getWidth() - 24), 1, PumpkinTheme.BORDER);
				painter.text(summary, x(this) + 12, bottom + 8, PumpkinTheme.ACCENT, true);
			}
			painter.endClip();
		}
	}

	/** The toggle's state, held beside the widget so the era-stable {@code OnPress} lambda of {@code Button} runs it. */
	private static final class ToggleState {
		private boolean selected;
		private final Consumer<Boolean> onChange;

		ToggleState(boolean selected, Consumer<Boolean> onChange) {
			this.selected = selected;
			this.onChange = onChange;
		}

		void flip() {
			selected = !selected;
			onChange.accept(selected);
		}
	}

	private static final class PumpkinToggle extends PumpkinWidget {
		private static final int BOX_SIZE = 14;
		private static final int BOX_GAP = 6;
		private static final int MARKER_SIZE = 6;

		private final ToggleState state;

		PumpkinToggle(String label, boolean selected, Consumer<Boolean> onChange) {
			this(label, new ToggleState(selected, onChange));
		}

		private PumpkinToggle(String label, ToggleState state) {
			super(label, 1, state::flip);
			this.state = state;
		}

		@Override
		protected void paint(int mouseX, int mouseY) {
			int x = x(this);
			int y = y(this);
			int boxY = y + (getHeight() - BOX_SIZE) / 2;
			boolean hover = active && isMouseOver(mouseX, mouseY);
			int outline = isFocused() ? PumpkinTheme.FOCUS
				: hover || state.selected ? PumpkinTheme.ACCENT : PumpkinTheme.BORDER;
			PumpkinTheme.plate(painter, x, boxY, BOX_SIZE, BOX_SIZE, false, outline, PumpkinTheme.SUNK);
			paintOutline(x, boxY, BOX_SIZE, BOX_SIZE, outline);
			if (isFocused() || hover) {
				paintOutline(x, y, getWidth(), getHeight(), outline);
			}
			if (state.selected) {
				painter.fill(x + (BOX_SIZE - MARKER_SIZE) / 2, boxY + (BOX_SIZE - MARKER_SIZE) / 2, MARKER_SIZE,
					MARKER_SIZE, PumpkinTheme.ACCENT);
			}
			String label = fittedLabel(getWidth() - BOX_SIZE - BOX_GAP);
			painter.text(label, x + BOX_SIZE + BOX_GAP, labelY(),
				active ? PumpkinTheme.TEXT : PumpkinTheme.DISABLED, true);
		}

		//? if >=1.17 {
		@Override
		//? if >=1.19.3 {
		public void updateWidgetNarration(NarrationElementOutput output) {
		//?} else {
		/*public void updateNarration(NarrationElementOutput output) {
		*///?}
			Component value = Text.component(state.selected
				? "pumpkin_bridge.toggle.on" : "pumpkin_bridge.toggle.off");
			output.add(NarratedElementType.TITLE,
				Text.component("pumpkin_bridge.toggle.narration", getMessage(), value));
			output.add(NarratedElementType.USAGE, Text.component("pumpkin_bridge.toggle.usage"));
		}
		//?} else {
		/*@Override
		protected net.minecraft.network.chat.MutableComponent createNarrationMessage() {
			return new net.minecraft.network.chat.TranslatableComponent("pumpkin_bridge.toggle.narration",
				getMessage(), Text.component(state.selected ? "pumpkin_bridge.toggle.on" : "pumpkin_bridge.toggle.off"));
		}
		*///?}
	}
}
