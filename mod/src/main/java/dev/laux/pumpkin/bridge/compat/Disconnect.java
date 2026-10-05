package dev.laux.pumpkin.bridge.compat;

import net.minecraft.client.Minecraft;
//? if >=1.21.9 {
import net.minecraft.client.multiplayer.ClientLevel;
//?} else if >=1.21.6 {
/*import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.multiplayer.ClientLevel;
*///?} else if >=1.20.5 {
/*import net.minecraft.client.gui.screens.GenericMessageScreen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.network.chat.Component;
*///?} else {
/*import net.minecraft.client.gui.screens.GenericDirtMessageScreen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.network.chat.Component;
*///?}

/**
 * Leaves the current world the way the pause menu's "Save and Quit" does: the same calls in the same order, so the world
 * is saved and the game ends on the title screen. INGAME-API.md 3.2, "Leave the world": four implementations, one per era.
 */
public final class Disconnect {
	private Disconnect() {
	}

	/** Call it on the main thread, in a world. */
	public static void leaveWorld() {
		Minecraft minecraft = Minecraft.getInstance();
		//? if >=1.21.9 {
		// 3.2 row 1.21.9 to 26.3: the public Minecraft#disconnectFromWorld(Component) does all of it.
		minecraft.disconnectFromWorld(ClientLevel.DEFAULT_QUIT_MESSAGE);
		//?} else if >=1.21.6 {
		/*// 3.2 row 1.21.6 to 1.21.8: the static PauseScreen#disconnectFromWorld(Minecraft, Component), then the title screen.
		PauseScreen.disconnectFromWorld(minecraft, ClientLevel.DEFAULT_QUIT_MESSAGE);
		GameScreens.show(new TitleScreen());
		*///?} else if >=1.20.5 {
		/*// 3.2 row 1.20.2 to 1.21.5: ClientLevel#disconnect(), Minecraft#disconnect(Screen) in a singleplayer world and
		// Minecraft#disconnect() on a server (GenericMessageScreen exists from 1.20.5), then the title screen.
		boolean local = minecraft.isLocalServer();
		minecraft.level.disconnect();
		if (local) {
			minecraft.disconnect(new GenericMessageScreen(Component.translatable("menu.savingLevel")));
		} else {
			minecraft.disconnect();
		}
		GameScreens.show(new TitleScreen());
		*///?} else if >=1.20.2 {
		/*// 3.2 row 1.20.2 to 1.20.4: like 1.20.5, but the saving screen is the GenericDirtMessageScreen of that era
		// (table "Pause menu, title screen, other screens": GenericMessageScreen first exists in 1.20.5).
		boolean local = minecraft.isLocalServer();
		minecraft.level.disconnect();
		if (local) {
			minecraft.disconnect(new GenericDirtMessageScreen(Component.translatable("menu.savingLevel")));
		} else {
			minecraft.disconnect();
		}
		GameScreens.show(new TitleScreen());
		*///?} else {
		/*// 3.2 row 1.20 to 1.20.1: Minecraft#clearLevel(Screen) / #clearLevel() instead of #disconnect (same table,
		// "Minecraft: screens, main thread, leaving a world").
		boolean local = minecraft.isLocalServer();
		minecraft.level.disconnect();
		if (local) {
			minecraft.clearLevel(new GenericDirtMessageScreen(Component.translatable("menu.savingLevel")));
		} else {
			minecraft.clearLevel();
		}
		GameScreens.show(new TitleScreen());
		*///?}
	}
}
