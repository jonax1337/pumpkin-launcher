package dev.laux.pumpkin.bridge.modules.friends.ui;

import dev.laux.pumpkin.bridge.modules.friends.FriendsClient;
import dev.laux.pumpkin.bridge.transport.LinkState;
import dev.laux.pumpkin.bridge.compat.Text;
import dev.laux.pumpkin.bridge.compat.Toasts;
import dev.laux.pumpkin.bridge.compat.Widgets;
import dev.laux.pumpkin.bridge.protocol.Scopes;
import dev.laux.pumpkin.bridge.modules.friends.protocol.Ops;
import dev.laux.pumpkin.bridge.ui.kit.Row;
import dev.laux.pumpkin.bridge.modules.friends.ui.model.OptionsLines;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * The Optionen tab of the hub (docs/bridge/README.md, "In-game navigation and world behavior"): read-only lines from the me topic and the welcome - nothing of it is
 * editable in R-A, the settings live in the launcher, and [Im Launcher öffnen] is the only action. The lines themselves
 * come from the Minecraft-free {@link OptionsLines}, so their shape is unit-tested there.
 */
public final class OptionsTab {
	private static final int FULL_ROW_WIDTH = 130;

	private final FriendsClient client;

	public OptionsTab(FriendsClient client) {
		this.client = client;
	}

	public List<Row> rows() {
		List<Row> rows = new ArrayList<>();
		for (OptionsLines.Line line : lines().lines()) {
			rows.add(Row.text(line.argument().map(value -> Text.translate(line.key(), value))
				.orElseGet(() -> Text.translate(line.key()))));
		}
		rows.add(Row.fullWidth("options.open_launcher", Widgets.button(Text.translate("pumpkin_bridge.open_launcher"),
			FULL_ROW_WIDTH, () -> client.request(Ops.launcherOpen(Ops.OpenTarget.SETTINGS)).reply()
				.thenAccept(reply -> reply.error().ifPresent(Toasts::showError)))));
		return rows;
	}

	private OptionsLines lines() {
		Optional<String> launcherVersion = Optional.empty();
		Optional<Scopes> scopes = Optional.empty();
		LinkState state = client.state();
		if (state instanceof LinkState.Connected) {
			LinkState.Connected connected = (LinkState.Connected) state;
			launcherVersion = Optional.of(connected.launcherVersion());
			scopes = Optional.of(connected.scopes());
		}
		return OptionsLines.of(client.topics().me(), launcherVersion, scopes);
	}
}
