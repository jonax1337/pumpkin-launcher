package dev.laux.pumpkin.friends.compat;

import dev.laux.pumpkin.friends.bridge.BridgeClient;
import dev.laux.pumpkin.friends.bridge.BridgeListener;
import dev.laux.pumpkin.friends.protocol.NotifyKind;
import dev.laux.pumpkin.friends.state.Friend;
import java.util.Optional;
import net.minecraft.client.Minecraft;

/** Shows the launcher's notices as toasts, with the friend's head when the friends list knows the name (SPEC 11.3). */
public final class NoticeToasts implements BridgeListener {
	private final BridgeClient client;

	public NoticeToasts(BridgeClient client) {
		this.client = client;
	}

	@Override
	public void notice(NotifyKind kind, Optional<String> name) {
		Optional<String> mcUuid = name.flatMap(client.topics()::friendNamed).flatMap(Friend::mcUuid);
		Toasts.showNotice(Minecraft.getInstance(), kind, name, mcUuid);
	}
}
