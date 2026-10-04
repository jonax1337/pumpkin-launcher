package dev.laux.pumpkin.friends.ui.hub;

import dev.laux.pumpkin.friends.bridge.BridgeClient;
import dev.laux.pumpkin.friends.compat.GameScreens;
import dev.laux.pumpkin.friends.compat.Text;
import dev.laux.pumpkin.friends.compat.Toasts;
import dev.laux.pumpkin.friends.compat.Widgets;
import dev.laux.pumpkin.friends.request.Ops;
import dev.laux.pumpkin.friends.state.Invite;
import dev.laux.pumpkin.friends.ui.InviteScreen;
import dev.laux.pumpkin.friends.ui.kit.Row;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.gui.screens.Screen;

/**
 * The Einladungen tab of the hub (INGAME 6.2): one row per invite with [Ansehen] (the InviteScreen decides whether this
 * game can join) and [Ablehnen] ({@code invite.decline}); "Keine Einladungen" when the list is empty (6.3).
 */
public final class InvitesTab {
	private static final int ACTION_WIDTH = 62;

	private final BridgeClient client;
	private final Screen hub;

	/** {@code hub} is the parent the InviteScreen returns to. */
	public InvitesTab(BridgeClient client, Screen hub) {
		this.client = client;
		this.hub = hub;
	}

	public List<Row> rows() {
		List<Invite> invites = client.topics().invites();
		if (invites.isEmpty()) {
			return List.of(Row.text(Text.translate("pumpkin_friends.invites.empty")));
		}
		List<Row> rows = new ArrayList<>();
		for (Invite invite : invites) {
			rows.add(Row.text(Text.translate("pumpkin_friends.invites.row", invite.fromName(), invite.title()))
				.withAction("invite.view." + invite.id(), Widgets.button(Text.translate("pumpkin_friends.invites.view"),
					ACTION_WIDTH, () -> view(invite)))
				.withAction("invite.decline." + invite.id(), Widgets.button(Text.translate("pumpkin_friends.invites.decline"),
					ACTION_WIDTH, () -> decline(invite))));
		}
		return rows;
	}

	private void view(Invite invite) {
		GameScreens.show(new InviteScreen(hub, client, invite));
	}

	private void decline(Invite invite) {
		client.request(Ops.inviteDecline(invite.id())).reply()
			.thenAccept(reply -> reply.error().ifPresent(Toasts::showError));
	}
}
