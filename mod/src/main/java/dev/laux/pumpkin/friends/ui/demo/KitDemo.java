package dev.laux.pumpkin.friends.ui.demo;

import dev.laux.pumpkin.friends.compat.GameScreens;
import dev.laux.pumpkin.friends.runtime.MainThread;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Opens the {@link KitDemoScreen} once, when the title screen first shows, if the game runs with
 * {@code -Dpumpkin.dev.kitdemo=true}. A dev thread polls through the main thread; no Mixin is involved, so the demo
 * also proves the kit on a node without the pause-menu hook.
 */
public final class KitDemo {
	private static final Logger LOG = LoggerFactory.getLogger("pumpkin_friends");
	private static final String PROPERTY = "pumpkin.dev.kitdemo";
	private static final long POLL_MILLIS = 250;

	private KitDemo() {
	}

	public static void startIfRequested(MainThread mainThread) {
		if (Boolean.getBoolean(PROPERTY)) {
			Thread poller = new Thread(() -> pollUntilOpened(mainThread), "pumpkin-kitdemo");
			poller.setDaemon(true);
			poller.start();
		}
	}

	private static void pollUntilOpened(MainThread mainThread) {
		AtomicBoolean opened = new AtomicBoolean();
		try {
			while (!opened.get()) {
				mainThread.execute(() -> openOnTitleScreen(opened));
				Thread.sleep(POLL_MILLIS);
			}
		} catch (InterruptedException interrupted) {
			Thread.currentThread().interrupt();
		}
	}

	private static void openOnTitleScreen(AtomicBoolean opened) {
		try {
			if (GameScreens.titleScreenIsShown()) {
				GameScreens.show(new KitDemoScreen(GameScreens.current()));
				opened.set(true);
			}
		} catch (RuntimeException failure) {
			LOG.error("pumpkin_friends kit demo failed to open", failure);
			opened.set(true);
		}
	}
}
