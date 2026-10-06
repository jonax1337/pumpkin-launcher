package dev.laux.pumpkin.bridge.platform.shared.mixin;

import dev.laux.pumpkin.bridge.platform.shared.PumpkinMenuButton;
import dev.laux.pumpkin.bridge.ui.UiSession;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Adds a detached entry after vanilla layout without moving native menu widgets. */
@Mixin(PauseScreen.class)
public abstract class PauseScreenMixin extends Screen {
	protected PauseScreenMixin(Component title) {
		super(title);
	}

	@Inject(method = "init()V", at = @At("TAIL"), require = 0)
	private void pumpkinBridge$addButton(CallbackInfo callback) {
		try {
			AbstractWidget button = PumpkinMenuButton.buttonFor((PauseScreen) (Object) this);
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
