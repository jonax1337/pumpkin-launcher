package dev.laux.pumpkin.bridge.modules.friends.compat;

import dev.laux.pumpkin.bridge.compat.Toasts;

import dev.laux.pumpkin.bridge.modules.friends.FriendsClient;
import dev.laux.pumpkin.bridge.transport.BridgeListener;
import dev.laux.pumpkin.bridge.protocol.NotifyKind;
import dev.laux.pumpkin.bridge.modules.friends.state.Friend;
import java.util.Optional;

/** Shows the launcher's notices as toasts, with the friend's head when the friends list knows the name (SPEC 11.3). */
public final class NoticeToasts implements BridgeListener {
	private final FriendsClient client;

	public NoticeToasts(FriendsClient client) {
		this.client = client;
	}

	@Override
	public void notice(NotifyKind kind, Optional<String> name) {
		Optional<String> mcUuid = name.flatMap(client.topics()::friendNamed).flatMap(Friend::mcUuid);
		Toasts.showNotice(kind, name, mcUuid);
	}
}
