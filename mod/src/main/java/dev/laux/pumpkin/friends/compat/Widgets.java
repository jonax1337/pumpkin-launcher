package dev.laux.pumpkin.friends.compat;

import dev.laux.pumpkin.friends.ui.UiSession;
import dev.laux.pumpkin.friends.ui.model.GuiMetrics;
import dev.laux.pumpkin.friends.ui.model.Fit;
import dev.laux.pumpkin.friends.ui.model.PumpkinTheme;
import java.util.function.Consumer;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.Checkbox;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.components.StringWidget;
//? if >=26.1 {
import net.minecraft.client.gui.GuiGraphicsExtractor;
//?} else {
/*import net.minecraft.client.gui.GuiGraphics;
*///?}

/**
 * The widgets of the kit preserve vanilla input and narration while buttons draw the Pumpkin palette. They are created at
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

	private static final class PumpkinButton extends Button {
		private final CompatPainter painter = new CompatPainter(font());
		private final String label;
		private final boolean selected;
		private int fittedWidth = -1;
		private String fittedLabel = "";

		PumpkinButton(String label, int width, boolean selected, Runnable onPress) {
			super(0, 0, width, GuiMetrics.BUTTON_HEIGHT, Text.literal(label),
				pressed -> UiSession.run(onPress), DEFAULT_NARRATION);
			this.label = label;
			this.selected = selected;
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
			paintButton(mouseX, mouseY);
		}

		private void paintButton(int mouseX, int mouseY) {
			int x = getX();
			int y = getY();
			int width = getWidth();
			int height = getHeight();
			boolean hover = active && isMouseOver(mouseX, mouseY);
			int surface = selected ? PumpkinTheme.ACCENT
				: !active ? PumpkinTheme.PANEL : hover ? PumpkinTheme.HOVER : PumpkinTheme.SURFACE;
			int border = isFocused() ? PumpkinTheme.FOCUS
				: selected || hover ? PumpkinTheme.ACCENT : active ? PumpkinTheme.BORDER : PumpkinTheme.SURFACE;
			PumpkinTheme.plate(painter, x, y, width, height, border, surface);
			if (selected) {
				painter.fill(x + 3, y + height - 3, Math.max(0, width - 6), 2, PumpkinTheme.INK);
			} else if (active) {
				painter.fill(x + 2, y + 2, Math.max(0, width - 4), 1, hover ? PumpkinTheme.BORDER : PumpkinTheme.HOVER);
				painter.fill(x + 2, y + height - 2, Math.max(0, width - 4), 1, PumpkinTheme.EDGE);
			}
			if (isFocused()) {
				painter.fill(x + 2, y + 2, 2, Math.max(0, height - 4), PumpkinTheme.FOCUS);
				painter.fill(x + width - 4, y + 2, 2, Math.max(0, height - 4), PumpkinTheme.FOCUS);
			}
			if (fittedWidth != width) {
				fittedWidth = width;
				fittedLabel = Fit.clip(label, Math.max(0, width - 12), painter::codePointWidth);
			}
			int textColor = selected ? PumpkinTheme.INK : active ? PumpkinTheme.TEXT : PumpkinTheme.DISABLED;
			painter.text(fittedLabel, x + (width - painter.textWidth(fittedLabel)) / 2,
				y + (height - painter.lineHeight()) / 2, textColor);
		}
	}

	/** The six-argument {@code EditBox} constructor exists in every era; {@code setHint} and {@code setMaxLength} too. */
	public static EditBox editBox(String hint, int width, int maxLength) {
		EditBox box = new EditBox(font(), 0, 0, width, GuiMetrics.BUTTON_HEIGHT, Text.literal(hint));
		box.setHint(Text.literal(hint));
		box.setMaxLength(maxLength);
		return box;
	}

	/** {@code StringWidget(int, int, int, int, Component, Font)} exists in every era. */
	public static AbstractWidget label(String text, int width) {
		return new StringWidget(0, 0, width, font().lineHeight, Text.literal(text), font());
	}

	/**
	 * {@code Checkbox#builder(Component, Font)} exists from 1.20.3 (1.20.2 and older: constructor only, no change
	 * callback); {@code Checkbox.Builder#pos}, {@code #selected(boolean)}, {@code #onValueChange} are table rows of the
	 * same era. The builder has no width here: {@code Checkbox.Builder#maxWidth} first exists in 1.21 (probed with
	 * mc-api-probe), which is above the 1.20.5 end of the 1.21.1-fabric node - the kit sizes widgets itself through
	 * {@code AbstractWidget#setWidth} (every era) when it places a row.
	 */
	public static AbstractWidget toggle(String label, boolean selected, Consumer<Boolean> onChange) {
		//? if >=1.20.3 {
		return Checkbox.builder(Text.literal(label), font())
			.pos(0, 0)
			.selected(selected)
			.onValueChange((checkbox, value) -> UiSession.run(() -> onChange.accept(value)))
			.build();
		//?} else {
		/*return new EarlyToggle(label, selected, onChange);
		*///?}
	}

	//? if <1.20.3 {
	/**
	 * The checkbox of the eras without a builder, INGAME-API.md 3, "Widgets: Button, Checkbox, text": up to 1.20.2 only
	 * the constructors {@code Checkbox(int, int, int, int, Component, boolean)} exist, and they have no change callback,
	 * so the wrapper reports {@code Checkbox#selected()} (a row of every era) after every press.
	 */
	private static final class EarlyToggle extends Checkbox {
		private final Consumer<Boolean> onChange;

		EarlyToggle(String label, boolean selected, Consumer<Boolean> onChange) {
			super(0, 0, 1, GuiMetrics.BUTTON_HEIGHT, Text.literal(label), selected);
			this.onChange = onChange;
		}

		@Override
		public void onPress() {
			super.onPress();
			UiSession.run(() -> onChange.accept(selected()));
		}
	}
	//?}

	private static Font font() {
		return Minecraft.getInstance().font;
	}
}
