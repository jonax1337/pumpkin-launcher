package dev.laux.pumpkin.friends.ui.hub;

import dev.laux.pumpkin.friends.compat.Text;
import dev.laux.pumpkin.friends.protocol.Scope;
import dev.laux.pumpkin.friends.ui.kit.PumpkinScreen;
import dev.laux.pumpkin.friends.ui.kit.Row;
import dev.laux.pumpkin.friends.ui.model.Fit;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.gui.screens.Screen;

/**
 * "Bestätige im Pumpkin Launcher" (INGAME 5.5, 6.2): shown while a request of this game waits for the player's answer
 * in the launcher. [Abbrechen] — like the escape key — only stops waiting; the operation runs to its answer, and the
 * screen closes by itself as soon as waiting ends.
 */
final class LauncherWaitScreen extends PumpkinScreen {
	private final LauncherWait wait;

	LauncherWaitScreen(Screen parent, LauncherWait wait) {
		super(Text.translate("pumpkin_friends.wait.title"), parent);
		this.wait = wait;
	}

	@Override
	protected List<Row> rows(int tab) {
		List<Row> rows = new ArrayList<>();
		rows.add(Row.text(Text.translate("pumpkin_friends.wait.waiting")));
		Fit.wrap(scopeText(), wrappedTextWidth(), Text::width).forEach(line -> rows.add(Row.muted(line)));
		return rows;
	}

	private String scopeText() {
		String key = wait.awaitedScope().map(LauncherWaitScreen::keyOf).orElse("pumpkin_friends.wait.scope.social");
		return Text.translate(key);
	}

	private static String keyOf(Scope scope) {
		return "pumpkin_friends.wait.scope." + scope.name().toLowerCase(java.util.Locale.ROOT);
	}

	@Override
	protected String statusLine() {
		return Text.translate("pumpkin_friends.wait.waiting");
	}

	@Override
	protected String doneKey() {
		return "pumpkin_friends.cancel";
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
