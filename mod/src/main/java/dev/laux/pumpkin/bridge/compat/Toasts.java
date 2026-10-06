package dev.laux.pumpkin.bridge.compat;

import dev.laux.pumpkin.bridge.protocol.json.WireNames;
import dev.laux.pumpkin.bridge.protocol.ErrorCode;
import dev.laux.pumpkin.bridge.protocol.NotifyKind;
import dev.laux.pumpkin.bridge.protocol.OpError;
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
	// docs/bridge/MINECRAFT-API.md, "Toasts": from 1.20.3 SystemToast.SystemToastId is a class with a public constructor, so the mod owns one id.
	private static final SystemToast.SystemToastId PUMPKIN_FRIENDS = new SystemToast.SystemToastId();
	//?} else if >=1.18 {
	/*private static final SystemToast.SystemToastIds PUMPKIN_FRIENDS = SystemToast.SystemToastIds.PERIODIC_NOTIFICATION;
	*///?} else {
	/*private static final Object PUMPKIN_FRIENDS = new Object();
	*///?}
	private static final int HEX_RADIX = 16;
	private static final int HALF_UUID_HEX = 16;

	private Toasts() {
	}

	public static void showNotice(NotifyKind kind, Optional<String> name, Optional<String> mcUuid) {
		// Namen nur als Literal einsetzen: so wirkt kein Formatierungs- oder Übersetzungscode darin.
		Component who = name.<Component>map(Text::literal).orElseGet(() -> Text.component("pumpkin_bridge.someone"));
		Component message = Text.component("pumpkin_bridge.notify." + WireNames.of(kind), who);
		if (mcUuid.isPresent()) showWithHead(uuid(mcUuid.get()), message);
		else showSystem(message);
	}

	/** Ein Fehlercode ohne eigenen Text (ein neuerer Launcher) erscheint als allgemeiner Fehler. */
	public static void showError(OpError error) {
		ErrorCode code = error.code() == ErrorCode.UNRECOGNIZED ? ErrorCode.INTERNAL : error.code();
		showSystem(Text.component("pumpkin_bridge.error." + WireNames.of(code)));
	}

	public static void showSystem(String message) {
		showSystem(Text.literal(message));
	}

	private static void showSystem(Component message) {
		Minecraft minecraft = Minecraft.getInstance();
		Component title = Text.component("pumpkin_bridge.title");
		//? if >=26.2 {
		// docs/bridge/MINECRAFT-API.md, "Toasts": {@code Gui#toastManager()} and {@code SystemToast#add(ToastManager, SystemToastId, Component, Component)}.
		SystemToast.add(minecraft.gui.toastManager(), PUMPKIN_FRIENDS, title, message);
		//?} else if >=1.21.2 {
		/*// Same table, 1.21.2 to 26.1.2: {@code Minecraft#getToastManager()}.
		SystemToast.add(minecraft.getToastManager(), PUMPKIN_FRIENDS, title, message);
		*///?} else if >=1.18 {
		/*SystemToast.add(minecraft.getToasts(), PUMPKIN_FRIENDS, title, message);
		*///?} else {
		/*minecraft.getToasts().addToast(new LegacyNoticeToast(
			SystemToast.multiline(minecraft, SystemToast.SystemToastIds.TUTORIAL_HINT, title, message)));
		*///?}
	}

	private static void showWithHead(UUID uuid, Component message) {
		//? if >=26.2 {
		// docs/bridge/MINECRAFT-API.md, "Toasts": {@code FriendToast} exists from 26.2 (absent in 26.1.2). {@code FriendToast#add(ToastManager, Font, ResolvableProfile, Component)}
		// and {@code ResolvableProfile.createUnresolved(UUID)} stand in no table of docs/bridge/MINECRAFT-API.md; both were probed with
		// mc-api-probe as public on 26.3, the only version that compiles this branch.
		Minecraft minecraft = Minecraft.getInstance();
		FriendToast.add(minecraft.gui.toastManager(), minecraft.font, ResolvableProfile.createUnresolved(uuid), message);
		//?} else {
		/*showSystem(message);
		*///?}
	}

	//? if <1.18 {
	/*private static final class LegacyNoticeToast implements net.minecraft.client.gui.components.toasts.Toast {
		private final SystemToast delegate;

		LegacyNoticeToast(SystemToast delegate) {
			this.delegate = delegate;
		}

		@Override
		public Visibility render(com.mojang.blaze3d.vertex.PoseStack graphics,
				net.minecraft.client.gui.components.toasts.ToastComponent toasts, long elapsed) {
			return delegate.render(graphics, toasts, elapsed);
		}

		@Override
		public Object getToken() {
			return PUMPKIN_FRIENDS;
		}

		@Override
		public int width() {
			return delegate.width();
		}

		@Override
		public int height() {
			return delegate.height();
		}
	}
	*///?}

	/** {@code mcUuid} ist schon als 32 Kleinbuchstaben-Hex geprüft. */
	private static UUID uuid(String mcUuid) {
		return new UUID(
			Long.parseUnsignedLong(mcUuid.substring(0, HALF_UUID_HEX), HEX_RADIX),
			Long.parseUnsignedLong(mcUuid.substring(HALF_UUID_HEX), HEX_RADIX));
	}
}
