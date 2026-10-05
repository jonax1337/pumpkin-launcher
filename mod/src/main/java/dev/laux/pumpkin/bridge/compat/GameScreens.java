package dev.laux.pumpkin.bridge.compat;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;

/** Which screen the game shows and how to change it. */
public final class GameScreens {
	private GameScreens() {
	}

	/** INGAME-API.md 3, "Minecraft: screens, main thread, leaving a world": {@code Gui#screen()} from 26.2, the field {@code Minecraft#screen} before. */
	public static Screen current() {
		Minecraft minecraft = Minecraft.getInstance();
		//? if >=26.2 {
		return minecraft.gui.screen();
		//?} else {
		/*return minecraft.screen;
		*///?}
	}

	/** INGAME-API.md 3, same table: {@code Gui#setScreen(Screen)} from 26.2, {@code Minecraft#setScreen(Screen)} before. */
	public static void show(Screen screen) {
		Minecraft minecraft = Minecraft.getInstance();
		//? if >=26.2 {
		minecraft.gui.setScreen(screen);
		//?} else {
		/*minecraft.setScreen(screen);
		*///?}
	}

	public static boolean titleScreenIsShown() {
		return current() instanceof TitleScreen;
	}
}
