package dev.laux.pumpkin.friends.platform.fabric.mixin;

import dev.laux.pumpkin.friends.platform.fabric.PauseMenuButton;
import dev.laux.pumpkin.friends.ui.UiSession;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Der Pausemenü-Hook der Mod, ihr einziger Eingriff ins Spiel (INGAME 4.2): ein weiches {@code @Inject} am Ende von
 * {@code PauseScreen#init()}. Die Basisklasse {@link Screen} gibt dem Mixin Zugriff auf die geschützten Widget-Methoden
 * des Bildschirms.
 *
 * <p>INGAME-API.md 3, „Pause menu, title screen, other screens“: {@code PauseScreen#init} ist {@code protected () → void}
 * in jeder Ära, das Ziel lautet zur Laufzeit der verschleierten Knoten {@code class_433#method_25426()} (Abschnitt 6.1,
 * auf allen Versionen von 1.20 bis 1.21.11 gleich). {@code require = 0}: ändert Mojang die Methode, bleibt der Knopf
 * aus, statt das Spiel zu brechen.
 *
 * <p>Weiches Scheitern (INGAME 4.2): der Hook-Leib fängt {@code RuntimeException} und {@code LinkageError} (in
 * Zeitsprüngen zeigen sich fehlende Signaturen als Errors) und übergibt sie {@link UiSession#disable}, die einmal loggt
 * und die UI der Sitzung abschaltet; ins Spiel geworfen wird nichts. Ohne Lambda im Leib: der Handler darf nach dem
 * Merge keine synthetischen Methoden dieser Mixin-Klasse brauchen.
 */
@Mixin(PauseScreen.class)
public abstract class PauseScreenMixin extends Screen {
	protected PauseScreenMixin(Component title) {
		// INGAME-API.md 3, „Screen: lifecycle and rendering“: Screen#<init>(Component) ist protected in jeder Ära.
		super(title);
	}

	@Inject(method = "init()V", at = @At("TAIL"), require = 0)
	private void pumpkinFriends$addButton(CallbackInfo callback) {
		try {
			Button button = PauseMenuButton.buttonFor((PauseScreen) (Object) this);
			if (button != null) {
				// INGAME-API.md 3, „Screen: widgets and narration“: addRenderableWidget ist protected (GuiEventListener) → GuiEventListener
				// in jeder Ära; es zeichnet, fokussiert und erzählt den Knopf.
				this.addRenderableWidget(button);
			}
		} catch (RuntimeException | LinkageError failure) {
			UiSession.disable(failure);
		}
	}
}
