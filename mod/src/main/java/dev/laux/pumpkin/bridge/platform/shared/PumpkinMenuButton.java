package dev.laux.pumpkin.bridge.platform.shared;

import dev.laux.pumpkin.bridge.compat.GameScreens;
import dev.laux.pumpkin.bridge.compat.Widgets;
import dev.laux.pumpkin.bridge.ui.UiSession;
import dev.laux.pumpkin.bridge.ui.model.CornerButtonLayout;
import dev.laux.pumpkin.bridge.ui.model.Rect;
import java.util.List;
import java.util.function.Function;
import java.util.stream.Collectors;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.Screen;

/** Detached logo entry shared by the title and pause menus; vanilla widgets are never moved. */
public final class PumpkinMenuButton {
	private static volatile Function<Screen, Screen> home;

	private PumpkinMenuButton() {
	}

	public static void attach(Function<Screen, Screen> openHome) {
		home = openHome;
	}

	public static AbstractWidget buttonFor(Screen screen) {
		Function<Screen, Screen> factory = home;
		if (factory == null || UiSession.off()) {
			return null;
		}
		//? if >=1.20.2 {
		if (screen instanceof PauseScreen && !((PauseScreen) screen).showsPauseMenu()) {
			return null;
		}
		//?}
		List<Rect> occupied = screen.children().stream()
			.filter(AbstractWidget.class::isInstance).map(AbstractWidget.class::cast)
			.filter(widget -> widget.visible)
			.map(widget -> new Rect(Widgets.x(widget), Widgets.y(widget), widget.getWidth(), widget.getHeight()))
			.collect(Collectors.toList());
		return CornerButtonLayout.find(screen.width, screen.height, occupied).map(slot -> {
			AbstractWidget button = Widgets.pumpkinLogo(() -> GameScreens.show(factory.apply(screen)));
			Widgets.setPosition(button, slot.x(), slot.y());
			return button;
		}).orElse(null);
	}
}
