package dev.laux.pumpkin.friends.compat;

import dev.laux.pumpkin.friends.ui.UiSession;
import dev.laux.pumpkin.friends.ui.model.GuiMetrics;
import java.util.function.Consumer;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.Checkbox;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.components.StringWidget;

/**
 * The widgets of the kit, all vanilla and none overriding an input method (INGAME 4.4). They are created at
 * {@code (0, 0)}; the screen layout moves them. Their handlers run in the session's soft-failure guard (INGAME 4.2):
 * vanilla calls them from its own input dispatch, so a press that fails must not throw into the game.
 * INGAME-API.md 3, tables "Widgets: Button, Checkbox, text" and "Widgets: EditBox".
 */
public final class Widgets {
	private Widgets() {
	}

	/** {@code Button#builder(Component, OnPress)} and {@code Button.Builder#bounds} exist in every era. */
	public static AbstractWidget button(String label, int width, Runnable onPress) {
		return Button.builder(Text.literal(label), pressed -> UiSession.run(onPress))
			.bounds(0, 0, width, GuiMetrics.BUTTON_HEIGHT).build();
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
