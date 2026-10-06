package dev.laux.pumpkin.bridge.modules.friends.ui;

import dev.laux.pumpkin.bridge.modules.friends.ui.model.LauncherWait;

import dev.laux.pumpkin.bridge.compat.Text;
import dev.laux.pumpkin.bridge.protocol.Scope;
import dev.laux.pumpkin.bridge.ui.kit.PumpkinScreen;
import dev.laux.pumpkin.bridge.ui.kit.Row;
import dev.laux.pumpkin.bridge.ui.model.Fit;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.gui.screens.Screen;

/**
 * "Bestätige im Pumpkin Launcher" (docs/bridge/README.md, "Operations and consent"): shown while a request of this game waits for the player's answer
 * in the launcher. [Abbrechen] — like the escape key — only stops waiting; the operation runs to its answer, and the
 * screen closes by itself as soon as waiting ends.
 */
final class LauncherWaitScreen extends PumpkinScreen {
	private final LauncherWait wait;

	LauncherWaitScreen(Screen parent, LauncherWait wait) {
		super("pumpkin_bridge.wait.title", parent);
		this.wait = wait;
	}

	@Override
	protected List<Row> rows(int tab) {
		List<Row> rows = new ArrayList<>();
		rows.add(Row.text(Text.translate("pumpkin_bridge.wait.waiting")));
		Fit.wrap(scopeText(), wrappedTextWidth(), Text::width).forEach(line -> rows.add(Row.muted(line)));
		return rows;
	}

	private String scopeText() {
		String key = wait.awaitedScope().map(LauncherWaitScreen::keyOf).orElse("pumpkin_bridge.wait.scope.social");
		return Text.translate(key);
	}

	private static String keyOf(Scope scope) {
		return "pumpkin_bridge.wait.scope." + scope.name().toLowerCase(java.util.Locale.ROOT);
	}

	@Override
	protected String statusLine() {
		return Text.translate("pumpkin_bridge.wait.waiting");
	}

	@Override
	protected String doneKey() {
		return "pumpkin_bridge.cancel";
	}

	@Override
	protected void onTick() {
		super.onTick();
		if (wait.finished()) {
			onClose();
		}
	}

	@Override
	public void onClose() {
		wait.stopWaiting();
		super.onClose();
	}
}
