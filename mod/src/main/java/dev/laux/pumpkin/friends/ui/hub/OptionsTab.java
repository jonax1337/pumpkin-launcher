package dev.laux.pumpkin.friends.ui.hub;

import dev.laux.pumpkin.friends.bridge.BridgeClient;
import dev.laux.pumpkin.friends.bridge.LinkState;
import dev.laux.pumpkin.friends.compat.Text;
import dev.laux.pumpkin.friends.compat.Toasts;
import dev.laux.pumpkin.friends.compat.Widgets;
import dev.laux.pumpkin.friends.protocol.Scopes;
import dev.laux.pumpkin.friends.request.Ops;
import dev.laux.pumpkin.friends.ui.kit.Row;
import dev.laux.pumpkin.friends.ui.model.OptionsLines;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * The Optionen tab of the hub (INGAME 6.2): read-only lines from the me topic and the welcome - nothing of it is
 * editable in R-A, the settings live in the launcher, and [Im Launcher öffnen] is the only action. The lines themselves
 * come from the Minecraft-free {@link OptionsLines}, so their shape is unit-tested there.
 */
public final class OptionsTab {
	private static final int FULL_ROW_WIDTH = 130;

	private final BridgeClient client;

	public OptionsTab(BridgeClient client) {
		this.client = client;
	}

	public List<Row> rows() {
		List<Row> rows = new ArrayList<>();
		for (OptionsLines.Line line : lines().lines()) {
			rows.add(Row.text(line.argument().map(value -> Text.translate(line.key(), value))
				.orElseGet(() -> Text.translate(line.key()))));
		}
		rows.add(Row.fullWidth("options.open_launcher", Widgets.button(Text.translate("pumpkin_friends.open_launcher"),
			FULL_ROW_WIDTH, () -> client.request(Ops.launcherOpen(Ops.OpenTarget.SETTINGS)).reply()
				.thenAccept(reply -> reply.error().ifPresent(Toasts::showError)))));
		return rows;
	}

	private OptionsLines lines() {
		Optional<String> launcherVersion = Optional.empty();
		Optional<Scopes> scopes = Optional.empty();
		if (client.state() instanceof LinkState.Connected connected) {
			launcherVersion = Optional.of(connected.launcherVersion());
			scopes = Optional.of(connected.scopes());
		}
		return OptionsLines.of(client.topics().me(), launcherVersion, scopes);
	}
}
