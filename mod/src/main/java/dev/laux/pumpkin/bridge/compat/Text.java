package dev.laux.pumpkin.bridge.compat;

import net.minecraft.client.Minecraft;
import net.minecraft.network.chat.Component;

/**
 * Text as plain strings for the UI layer. Player-controlled strings are only ever turned into literals, so no formatting
 * or translation code inside them takes effect.
 */
public final class Text {
	private Text() {
	}

	/** Literal text uses the pre-1.19 concrete component or the modern factory, never a translation key. */
	public static Component literal(String text) {
		//? if >=1.19 {
		return Component.literal(text);
		//?} else {
		/*return new net.minecraft.network.chat.TextComponent(text);
		*///?}
	}

	public static Component component(String key, Object... arguments) {
		//? if >=1.19 {
		return Component.translatable(key, arguments);
		//?} else {
		/*return new net.minecraft.network.chat.TranslatableComponent(key, arguments);
		*///?}
	}

	public static String translate(String key, Object... arguments) {
		return component(key, arguments).getString();
	}

	/** docs/bridge/MINECRAFT-API.md, same table: {@code Minecraft#font} (table "Minecraft: screens...") and {@code Font#width(String)}. */
	public static int width(String text) {
		return Minecraft.getInstance().font.width(text);
	}
}
