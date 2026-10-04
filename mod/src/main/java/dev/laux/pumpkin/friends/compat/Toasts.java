package dev.laux.pumpkin.friends.compat;

import dev.laux.pumpkin.friends.json.WireNames;
import dev.laux.pumpkin.friends.protocol.ErrorCode;
import dev.laux.pumpkin.friends.protocol.NotifyKind;
import dev.laux.pumpkin.friends.protocol.OpError;
import java.util.Optional;
import java.util.UUID;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.toasts.FriendToast;
import net.minecraft.client.gui.components.toasts.SystemToast;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.component.ResolvableProfile;

/** Zeigt Hinweise vom Launcher als Toast: mit Kopf, wenn eine UUID bekannt ist (SPEC 11.3). */
public final class Toasts {
	private static final SystemToast.SystemToastId PUMPKIN_FRIENDS = new SystemToast.SystemToastId();
	private static final int HEX_RADIX = 16;
	private static final int HALF_UUID_HEX = 16;

	private Toasts() {
	}

	public static void showNotice(Minecraft minecraft, NotifyKind kind, Optional<String> name, Optional<String> mcUuid) {
		// Namen nur als Literal einsetzen: so wirkt kein Formatierungs- oder Übersetzungscode darin.
		Component who = name.<Component>map(Component::literal).orElseGet(() -> Component.translatable("pumpkin_friends.someone"));
		Component message = Component.translatable("pumpkin_friends.notify." + WireNames.of(kind), who);
		mcUuid.map(Toasts::uuid).ifPresentOrElse(
			uuid -> FriendToast.add(minecraft.gui.toastManager(), minecraft.font, ResolvableProfile.createUnresolved(uuid),
				message),
			() -> showSystem(minecraft, message));
	}

	/** Ein Fehlercode ohne eigenen Text (ein neuerer Launcher) erscheint als allgemeiner Fehler. */
	public static void showError(Minecraft minecraft, OpError error) {
		ErrorCode code = error.code() == ErrorCode.UNRECOGNIZED ? ErrorCode.INTERNAL : error.code();
		showSystem(minecraft, Component.translatable("pumpkin_friends.error." + WireNames.of(code)));
	}

	public static void showSystem(Minecraft minecraft, Component message) {
		SystemToast.add(minecraft.gui.toastManager(), PUMPKIN_FRIENDS, Component.translatable("pumpkin_friends.title"),
			message);
	}

	/** {@code mcUuid} ist schon als 32 Kleinbuchstaben-Hex geprüft. */
	private static UUID uuid(String mcUuid) {
		return new UUID(
			Long.parseUnsignedLong(mcUuid.substring(0, HALF_UUID_HEX), HEX_RADIX),
			Long.parseUnsignedLong(mcUuid.substring(HALF_UUID_HEX), HEX_RADIX));
	}
}
