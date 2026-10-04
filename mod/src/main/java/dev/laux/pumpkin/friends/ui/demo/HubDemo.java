package dev.laux.pumpkin.friends.ui.demo;

import dev.laux.pumpkin.friends.bridge.BridgeClient;
import dev.laux.pumpkin.friends.compat.GameScreens;
import dev.laux.pumpkin.friends.compat.MinecraftMainThread;
import dev.laux.pumpkin.friends.runtime.MainThread;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Opens the {@link HubDemoScreen} once, right after the title screen, when the game runs with
 * {@code -Dpumpkin.dev.hubdemo=true} (or the environment {@code PUMPKIN_DEV_HUBDEMO=true}, which a Gradle dev run can
 * set): the owner's visual check path for the hub, against the state a {@code FakeLauncher} pushes. A dev thread polls
 * through the main thread, like the kit demo; it waits for a link and for a title screen that stays, so a kit demo that
 * runs at the same time opens and closes first.
 */
public final class HubDemo {
	private static final Logger LOG = LoggerFactory.getLogger("pumpkin_friends");
	private static final String PROPERTY = "pumpkin.dev.hubdemo";
	private static final String ENVIRONMENT = "PUMPKIN_DEV_HUBDEMO";
	private static final long POLL_MILLIS = 250;

	private static volatile BridgeClient client;

	private HubDemo() {
	}

	/** Registers the running client; from here the demo run can open the hub. */
	public static void attach(BridgeClient attached) {
		client = attached;
		if (requested()) {
			MainThread mainThread = new MinecraftMainThread();
			Thread poller = new Thread(() -> pollUntilOpened(mainThread), "pumpkin-hubdemo");
			poller.setDaemon(true);
			poller.start();
		}
	}

	private static boolean requested() {
		return Boolean.getBoolean(PROPERTY) || "true".equals(System.getenv(ENVIRONMENT));
	}

	private static void pollUntilOpened(MainThread mainThread) {
		AtomicBoolean opened = new AtomicBoolean();
		TitleGate gate = new TitleGate();
		try {
			while (!opened.get()) {
				mainThread.execute(() -> openOnStableTitleScreen(gate, opened));
				Thread.sleep(POLL_MILLIS);
			}
		} catch (InterruptedException interrupted) {
			Thread.currentThread().interrupt();
		}
	}

	private static void openOnStableTitleScreen(TitleGate gate, AtomicBoolean opened) {
		try {
			BridgeClient link = client;
			if (gate.titleIsStable() && link != null && link.isConnected()) {
				GameScreens.show(new HubDemoScreen(GameScreens.current(), link));
				opened.set(true);
			}
		} catch (RuntimeException failure) {
			LOG.error("pumpkin_friends hub demo failed to open", failure);
			opened.set(true);
		}
	}

	/** The title screen counted in two consecutive polls; only the main thread touches it. */
	private static final class TitleGate {
		private boolean seenBefore;

		boolean titleIsStable() {
			boolean shown = GameScreens.titleScreenIsShown();
			boolean stable = shown && seenBefore;
			seenBefore = shown;
			return stable;
		}
	}
}
