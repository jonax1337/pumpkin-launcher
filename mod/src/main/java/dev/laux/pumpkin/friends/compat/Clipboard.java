package dev.laux.pumpkin.friends.compat;

import net.minecraft.client.Minecraft;

/**
 * The system clipboard through the game's own keyboard handler. INGAME-API.md 3, "Clipboard": {@code Minecraft#keyboardHandler}
 * with {@code KeyboardHandler#setClipboard(String)} and {@code #getClipboard()} is the same in every era; only the
 * {@code ClipboardManager} below it changes, and the mod does not touch that.
 */
public final class Clipboard {
	private Clipboard() {
	}

	public static void copy(String text) {
		Minecraft.getInstance().keyboardHandler.setClipboard(text);
	}

	public static String paste() {
		return Minecraft.getInstance().keyboardHandler.getClipboard();
	}
}
