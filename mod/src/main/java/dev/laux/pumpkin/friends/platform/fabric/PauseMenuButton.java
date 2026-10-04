package dev.laux.pumpkin.friends.platform.fabric;

import dev.laux.pumpkin.friends.bridge.BridgeClient;
import dev.laux.pumpkin.friends.compat.GameScreens;
import dev.laux.pumpkin.friends.ui.UiSession;
import dev.laux.pumpkin.friends.ui.demo.HubDemo;
import dev.laux.pumpkin.friends.ui.hub.HubScreen;
import dev.laux.pumpkin.friends.ui.model.GuiMetrics;
import dev.laux.pumpkin.friends.ui.model.Rect;
import java.util.List;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.network.chat.Component;

/**
 * Knopf „Pumpkin Friends“ im Pausemenü (INGAME 6.1): unter der Vanilla-Knopfspalte, in deren Breite, überschneidungsfrei.
 * Er steht wann immer die Mod nicht inaktiv ist, auch ohne Verbindung zum Launcher (der Hub erklärt es dann). Eingehängt
 * wird er vom {@code PauseScreenMixin} am Ende von {@code PauseScreen#init()}; {@link #attach(BridgeClient)} schaltet ihn
 * frei, sobald die Mod vom Launcher gestartet wurde. Nach einem Fehler der Mod schaltet {@link UiSession} die UI der
 * Sitzung ab (INGAME 4.2), und der Knopf bleibt dann aus.
 */
public final class PauseMenuButton {
	private static final Component LABEL = Component.translatable("pumpkin_friends.button");
	private static final int GAP = 4;

	private static volatile BridgeClient client;

	private PauseMenuButton() {
	}

	/** Meldet den laufenden Client an; erst ab hier setzt der Mixin den Knopf ins Pausemenü. */
	public static void attach(BridgeClient attached) {
		client = attached;
		// Der visuelle Prüfpfad des Owners: -Dpumpkin.dev.hubdemo (siehe HubDemo).
		HubDemo.attach(attached);
	}

	/**
	 * Der Knopf für dieses Pausemenü, oder null: wenn die Mod inaktiv ist, ihre UI nach einem Fehler für diese Sitzung
	 * abgeschaltet ist (INGAME 4.2), der Bildschirm keine Pausemenü-Spalte hat ({@code showsPauseMenu}, mit mc-api-probe
	 * auf 1.21.1, 1.21.8, 1.21.11 und 26.3 als public verifiziert) oder kein Platz bleibt. Aufrufer ist allein der
	 * {@code PauseScreenMixin} (daher öffentlich: sein Mixin-Paket liegt tiefer).
	 */
	public static Button buttonFor(PauseScreen pause) {
		//? if >=1.20.2 {
		if (client == null || UiSession.off() || !pause.showsPauseMenu()) {
			return null;
		}
		//?} else {
		/*// Same table: showsPauseMenu first exists in 1.20.2; 1.20 to 1.20.1 has no accessor for the save state,
		// so beyond inactivity only the free-slot rule decides.
		if (client == null || UiSession.off()) {
			return null;
		}
		*///?}
		Rect slot = slotBelow(buttonsOf(pause), pause.height);
		if (slot == null) {
			return null;
		}
		return Button.builder(LABEL, pressed -> UiSession.run(() -> GameScreens.show(new HubScreen(pause, client))))
			.bounds(slot.x(), slot.y(), slot.width(), slot.height()).build();
	}

	/**
	 * INGAME-API.md 3, „Screen: widgets and narration“ ({@code Screen#children()}) und „Widgets: Button, Checkbox, text“
	 * ({@code AbstractWidget#getX/getY/getWidth/getHeight}, jede Ära): der Slot aus den Maßen der vorhandenen Knöpfe.
	 */
	private static List<AbstractWidget> buttonsOf(PauseScreen pause) {
		return pause.children().stream().filter(AbstractWidget.class::isInstance).map(AbstractWidget.class::cast).toList();
	}

	/** Unter alle vorhandenen Knöpfe; reicht der Platz weder darunter noch darüber, bleibt der Knopf aus. */
	private static Rect slotBelow(List<AbstractWidget> widgets, int screenHeight) {
		if (widgets.isEmpty()) {
			return null;
		}
		int left = widgets.stream().mapToInt(AbstractWidget::getX).min().orElseThrow();
		int right = widgets.stream().mapToInt(widget -> widget.getX() + widget.getWidth()).max().orElseThrow();
		int top = widgets.stream().mapToInt(AbstractWidget::getY).min().orElseThrow();
		int bottom = widgets.stream().mapToInt(widget -> widget.getY() + widget.getHeight()).max().orElseThrow();
		int below = bottom + GAP;
		if (below + GuiMetrics.BUTTON_HEIGHT <= screenHeight) {
			return new Rect(left, below, right - left, GuiMetrics.BUTTON_HEIGHT);
		}
		int above = top - GAP - GuiMetrics.BUTTON_HEIGHT;
		return above >= 0 ? new Rect(left, above, right - left, GuiMetrics.BUTTON_HEIGHT) : null;
	}
}
