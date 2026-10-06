package dev.laux.pumpkin.bridge.ui.kit;

import dev.laux.pumpkin.bridge.ui.model.PixelIcon;
import net.minecraft.client.gui.screens.Screen;

/** A module supplies its own tile content and screen; the Bridge home knows no feature state. */
public interface BridgeModule {
	String id();

	String title();

	String description();

	String summary();

	PixelIcon icon();

	Screen screen(Screen parent);
}
