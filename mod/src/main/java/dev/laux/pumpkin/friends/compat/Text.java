package dev.laux.pumpkin.friends.compat;

import net.minecraft.client.Minecraft;
import net.minecraft.network.chat.Component;

/**
 * Text as plain strings for the UI layer. Player-controlled strings are only ever turned into literals, so no formatting
 * or translation code inside them takes effect.
 */
public final class Text {
	private Text() {
	}

	/** INGAME-API.md 3, "Font, drawing, text components": {@code Component#literal(String)} is the same in every era. */
	static Component literal(String text) {
		return Component.literal(text);
	}

	/** INGAME-API.md 3, same table: {@code Component#translatable(String, Object[])} and {@code Component#getString()}. */
	public static String translate(String key, Object... arguments) {
		return Component.translatable(key, arguments).getString();
	}

	/** INGAME-API.md 3, same table: {@code Minecraft#font} (table "Minecraft: screens...") and {@code Font#width(String)}. */
	public static int width(String text) {
		return Minecraft.getInstance().font.width(text);
	}
}
