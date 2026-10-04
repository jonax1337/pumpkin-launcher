package dev.laux.pumpkin.friends.compat;

import dev.laux.pumpkin.friends.ui.model.TrackedField;
import java.util.Optional;
import java.util.function.Consumer;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.EditBox;

/**
 * A vanilla widget as a {@link TrackedField}. INGAME-API.md 3, "Widgets: EditBox" ({@code getValue}, {@code setValue}) and
 * "Widgets: Button, Checkbox, text" ({@code AbstractWidget#isFocused}); focusing goes through the screen.
 */
final class TrackedWidget implements TrackedField {
	private final String id;
	private final AbstractWidget widget;
	private final Consumer<AbstractWidget> focusOnScreen;

	TrackedWidget(String id, AbstractWidget widget, Consumer<AbstractWidget> focusOnScreen) {
		this.id = id;
		this.widget = widget;
		this.focusOnScreen = focusOnScreen;
	}

	@Override
	public String id() {
		return id;
	}

	@Override
	public Optional<String> text() {
		return widget instanceof EditBox box ? Optional.of(box.getValue()) : Optional.empty();
	}

	@Override
	public void setText(String text) {
		if (widget instanceof EditBox box) {
			box.setValue(text);
		}
	}

	@Override
	public boolean isFocused() {
		return widget.isFocused();
	}

	@Override
	public void focus() {
		focusOnScreen.accept(widget);
	}
}
