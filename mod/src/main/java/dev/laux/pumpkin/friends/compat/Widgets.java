package dev.laux.pumpkin.friends.compat;

import dev.laux.pumpkin.friends.ui.UiSession;
import dev.laux.pumpkin.friends.ui.model.Fit;
import dev.laux.pumpkin.friends.ui.model.GuiMetrics;
import dev.laux.pumpkin.friends.ui.model.PumpkinTheme;
import java.util.function.Consumer;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.narration.NarratedElementType;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.network.chat.Component;
//? if >=26.1 {
import net.minecraft.client.gui.GuiGraphicsExtractor;
//?} else {
/*import net.minecraft.client.gui.GuiGraphics;
*///?}

/**
 * The widgets of the kit preserve vanilla input and narration while drawing the Pumpkin palette. They are created at
 * {@code (0, 0)}; the screen layout moves them. Their handlers run in the session's soft-failure guard (INGAME 4.2):
 * vanilla calls them from its own input dispatch, so a press that fails must not throw into the game.
 * INGAME-API.md 3, tables "Widgets: Button, Checkbox, text" and "Widgets: EditBox".
 */
public final class Widgets {
	private Widgets() {
	}

	/** Button's protected constructor and default narration exist in every supported era. */
	public static AbstractWidget button(String label, int width, Runnable onPress) {
		return new PumpkinButton(label, width, false, onPress);
	}

	public static AbstractWidget tab(String label, int width, boolean selected, Runnable onPress) {
		return new PumpkinButton(label, width, selected, onPress);
	}

	/**
	 * The six-argument {@code EditBox} constructor exists in every era; {@code setHint} and {@code setMaxLength} too.
	 * The box keeps its vanilla look — the black field with the grey frame that vanilla also puts on its dark screens.
	 */
	public static EditBox editBox(String hint, int width, int maxLength) {
		EditBox box = new EditBox(font(), 0, 0, width, GuiMetrics.BUTTON_HEIGHT, Text.literal(hint));
		box.setHint(Text.literal(hint));
		box.setMaxLength(maxLength);
		return box;
	}

	/**
	 * A toggle drawn as a small sunken field with a pumpkin marker, in place of vanilla's checkbox whose light sprite
	 * would clash with the dark panel. It stays a {@code Button}: the era-stable constructor and {@code OnPress}
	 * lambda keep vanilla's clicks, click sound, focus and key handling in every era; only the drawing and the
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
			super(0, 0, width, GuiMetrics.BUTTON_HEIGHT, Text.literal(label),
				pressed -> UiSession.run(action), DEFAULT_NARRATION);
			this.label = label;
		}

		// Input, click sound, tooltips and narration stay inherited from Button.
		//? if >=26.1 {
		@Override
		protected void extractContents(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float partialTick) {
		//?} else if >=1.21.11 {
		/*@Override
		protected void renderContents(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
		*///?} else {
		/*@Override
		public void renderWidget(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
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
			return getY() + (getHeight() - 8) / 2;
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
			int x = getX();
			int y = getY();
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
			int x = getX();
			int y = getY();
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

		/** The narrator says the label and whether the toggle is on, like vanilla's checkbox. */
		@Override
		public void updateWidgetNarration(NarrationElementOutput output) {
			Component value = Component.translatable(state.selected
				? "pumpkin_friends.toggle.on" : "pumpkin_friends.toggle.off");
			output.add(NarratedElementType.TITLE,
				Component.translatable("pumpkin_friends.toggle.narration", getMessage(), value));
			output.add(NarratedElementType.USAGE, Component.translatable("pumpkin_friends.toggle.usage"));
		}
	}
}
