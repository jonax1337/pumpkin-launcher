package dev.laux.pumpkin.friends.mc;

import dev.laux.pumpkin.friends.bridge.BridgeClient;
import dev.laux.pumpkin.friends.state.StateStore;
import java.util.List;
import net.fabricmc.fabric.api.client.screen.v1.Screens;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

/**
 * Knopf „Pumpkin Friends“ im Pausemenü (SPEC 11.3): unter den vorhandenen Knöpfen, sichtbar nur bei Verbindung zum
 * Launcher. {@code AFTER_INIT} läuft bei jedem Neuaufbau und jeder Größenänderung, daher das idempotente Hinzufügen.
 */
public final class PauseMenuButton {
	private static final Component LABEL = Component.translatable("pumpkin_friends.button");
	private static final int GAP = 4;

	private final StateStore store;
	private final BridgeClient client;

	public PauseMenuButton(StateStore store, BridgeClient client) {
		this.store = store;
		this.client = client;
	}

	public void afterInit(Minecraft minecraft, Screen screen) {
		if (!(screen instanceof PauseScreen pause) || !pause.showsPauseMenu()) {
			return;
		}
		List<AbstractWidget> widgets = Screens.getWidgets(pause);
		if (widgets.isEmpty() || widgets.stream().anyMatch(PauseMenuButton::isOurs)) {
			return;
		}
		Button button = Button.builder(LABEL, pressed -> open(minecraft, pause)).build();
		placeBelow(button, widgets, pause.height);
		button.visible = store.isConnected();
		widgets.add(button);
	}

	public void tick(Minecraft minecraft) {
		if (minecraft.gui.screen() instanceof PauseScreen pause) {
			Screens.getWidgets(pause).stream().filter(PauseMenuButton::isOurs)
				.forEach(button -> button.visible = store.isConnected());
		}
	}

	private void open(Minecraft minecraft, PauseScreen pause) {
		minecraft.gui.setScreen(new FriendsScreen(pause, store, client));
	}

	/** Unter alle vorhandenen Knöpfe, in deren Breite; reicht der Platz nicht, darüber. */
	private static void placeBelow(Button button, List<AbstractWidget> widgets, int screenHeight) {
		int left = widgets.stream().mapToInt(AbstractWidget::getX).min().orElseThrow();
		int right = widgets.stream().mapToInt(widget -> widget.getX() + widget.getWidth()).max().orElseThrow();
		int top = widgets.stream().mapToInt(AbstractWidget::getY).min().orElseThrow();
		int bottom = widgets.stream().mapToInt(AbstractWidget::getBottom).max().orElseThrow();
		int below = bottom + GAP;
		boolean fitsBelow = below + Button.DEFAULT_HEIGHT <= screenHeight;
		button.setRectangle(right - left, Button.DEFAULT_HEIGHT, left, fitsBelow ? below : top - GAP - Button.DEFAULT_HEIGHT);
	}

	private static boolean isOurs(AbstractWidget widget) {
		return LABEL.equals(widget.getMessage());
	}
}
