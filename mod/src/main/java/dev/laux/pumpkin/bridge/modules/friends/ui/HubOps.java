package dev.laux.pumpkin.bridge.modules.friends.ui;

import dev.laux.pumpkin.bridge.modules.friends.ui.model.LauncherWait;

import dev.laux.pumpkin.bridge.modules.friends.FriendsClient;
import dev.laux.pumpkin.bridge.compat.GameScreens;
import dev.laux.pumpkin.bridge.compat.Toasts;
import dev.laux.pumpkin.bridge.transport.request.Op;
import dev.laux.pumpkin.bridge.transport.request.Request;
import net.minecraft.client.gui.screens.Screen;

/**
 * How the hub runs an operation: while the launcher asks the player, the {@link LauncherWaitScreen} covers the hub; a
 * failure arrives as a toast (INGAME 6.2), a success needs no words because the state topic shows it.
 */
final class HubOps {
	private HubOps() {
	}

	static void run(Screen hub, FriendsClient client, Op<?> operation) {
		Request<?> request = client.request(operation);
		LauncherWait wait = LauncherWait.of(request);
		wait.whenLauncherAsks(() -> GameScreens.show(new LauncherWaitScreen(hub, wait)));
		request.reply().thenAccept(reply -> reply.error().ifPresent(Toasts::showError));
	}
}
