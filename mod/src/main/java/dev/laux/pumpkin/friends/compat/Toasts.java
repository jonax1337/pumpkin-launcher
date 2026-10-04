package dev.laux.pumpkin.friends.compat;

import dev.laux.pumpkin.friends.json.WireNames;
import dev.laux.pumpkin.friends.protocol.ErrorCode;
import dev.laux.pumpkin.friends.protocol.NotifyKind;
import dev.laux.pumpkin.friends.protocol.OpError;
import java.util.Optional;
import java.util.UUID;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.toasts.SystemToast;
//? if >=26.2 {
import net.minecraft.client.gui.components.toasts.FriendToast;
import net.minecraft.world.item.component.ResolvableProfile;
//?}
import net.minecraft.network.chat.Component;

/**
 * Notices from the launcher as toasts. A friend's head is shown where the game has a friend toast (26.2 and later); every
 * other version gets the plain system toast. The mod never reuses Mojang's {@code FRIEND_SYSTEM_NOTIFICATION} id (A10).
 */
public final class Toasts {
	//? if >=1.20.3 {
	// INGAME-API.md 3, "Toasts": from 1.20.3 SystemToast.SystemToastId is a class with a public constructor, so the mod owns one id.
	private static final SystemToast.SystemToastId PUMPKIN_FRIENDS = new SystemToast.SystemToastId();
	//?} else {
	/*// Same table: up to 1.20.2 the id is the enum SystemToastIds; only PERIODIC_NOTIFICATION may be used (A10). Not compiled by any U1 node.
	private static final SystemToast.SystemToastIds PUMPKIN_FRIENDS = SystemToast.SystemToastIds.PERIODIC_NOTIFICATION;
	*///?}
	private static final int HEX_RADIX = 16;
	private static final int HALF_UUID_HEX = 16;

	private Toasts() {
	}

	public static void showNotice(NotifyKind kind, Optional<String> name, Optional<String> mcUuid) {
		// Namen nur als Literal einsetzen: so wirkt kein Formatierungs- oder Übersetzungscode darin.
		Component who = name.<Component>map(Component::literal).orElseGet(() -> Component.translatable("pumpkin_friends.someone"));
		Component message = Component.translatable("pumpkin_friends.notify." + WireNames.of(kind), who);
		mcUuid.map(Toasts::uuid).ifPresentOrElse(uuid -> showWithHead(uuid, message), () -> showSystem(message));
	}

	/** Ein Fehlercode ohne eigenen Text (ein neuerer Launcher) erscheint als allgemeiner Fehler. */
	public static void showError(OpError error) {
		ErrorCode code = error.code() == ErrorCode.UNRECOGNIZED ? ErrorCode.INTERNAL : error.code();
		showSystem(Component.translatable("pumpkin_friends.error." + WireNames.of(code)));
	}

	public static void showSystem(String message) {
		showSystem(Component.literal(message));
	}

	private static void showSystem(Component message) {
		Minecraft minecraft = Minecraft.getInstance();
		Component title = Component.translatable("pumpkin_friends.title");
		//? if >=26.2 {
		// INGAME-API.md 3, "Toasts": {@code Gui#toastManager()} and {@code SystemToast#add(ToastManager, SystemToastId, Component, Component)}.
		SystemToast.add(minecraft.gui.toastManager(), PUMPKIN_FRIENDS, title, message);
		//?} else if >=1.21.2 {
		/*// Same table, 1.21.2 to 26.1.2: {@code Minecraft#getToastManager()}.
		SystemToast.add(minecraft.getToastManager(), PUMPKIN_FRIENDS, title, message);
		*///?} else {
		/*// Same table, up to 1.21.1: {@code Minecraft#getToasts()} returns the ToastComponent.
		SystemToast.add(minecraft.getToasts(), PUMPKIN_FRIENDS, title, message);
		*///?}
	}

	private static void showWithHead(UUID uuid, Component message) {
		//? if >=26.2 {
		// INGAME-API.md 3, "Toasts": {@code FriendToast} exists from 26.2 (absent in 26.1.2). {@code FriendToast#add(ToastManager, Font, ResolvableProfile, Component)}
		// and {@code ResolvableProfile.createUnresolved(UUID)} stand in no table of INGAME-API.md; both were probed with
		// mc-api-probe as public on 26.3, the only version that compiles this branch.
		Minecraft minecraft = Minecraft.getInstance();
		FriendToast.add(minecraft.gui.toastManager(), minecraft.font, ResolvableProfile.createUnresolved(uuid), message);
		//?} else {
		/*showSystem(message);
		*///?}
	}

	/** {@code mcUuid} ist schon als 32 Kleinbuchstaben-Hex geprüft. */
	private static UUID uuid(String mcUuid) {
		return new UUID(
			Long.parseUnsignedLong(mcUuid.substring(0, HALF_UUID_HEX), HEX_RADIX),
			Long.parseUnsignedLong(mcUuid.substring(HALF_UUID_HEX), HEX_RADIX));
	}
}
