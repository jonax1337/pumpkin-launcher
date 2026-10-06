package dev.laux.pumpkin.bridge.platform.shared.mixin;

import dev.laux.pumpkin.bridge.platform.shared.PumpkinMenuButton;
import dev.laux.pumpkin.bridge.ui.UiSession;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Adds the same detached entry as the pause menu, after vanilla has laid out its buttons. */
@Mixin(TitleScreen.class)
public abstract class TitleScreenMixin extends Screen {
	protected TitleScreenMixin(Component title) {
		super(title);
	}

	@Inject(method = "init()V", at = @At("TAIL"), require = 0)
	private void pumpkinBridge$addButton(CallbackInfo callback) {
		try {
			AbstractWidget button = PumpkinMenuButton.buttonFor((TitleScreen) (Object) this);
			if (button != null) {
				//? if >=1.17 {
				addRenderableWidget(button);
				//?} else {
				/*addButton(button);
				*///?}
			}
		} catch (RuntimeException | LinkageError failure) {
			UiSession.disable(failure);
		}
	}
}
