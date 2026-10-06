package dev.laux.pumpkin.bridge.ui.demo;

import dev.laux.pumpkin.bridge.compat.GameScreens;
import dev.laux.pumpkin.bridge.runtime.MainThread;
import java.util.concurrent.atomic.AtomicBoolean;
import org.apache.logging.log4j.Logger;
import org.apache.logging.log4j.LogManager;

/**
 * Opens the {@link KitDemoScreen} once, when the title screen first shows, if the game runs with
 * {@code -Dpumpkin.dev.kitdemo=true}. A dev thread polls through the main thread; no Mixin is involved, so the demo
 * also proves the kit on a node without the pause-menu hook. With the environment variable {@code PUMPKIN_SHARE_DEMO}
 * set instead, the same entry point opens the {@link ShareDemoScreen}: the render proof of the Teilen tab.
 */
public final class KitDemo {
	private static final Logger LOG = LogManager.getLogger("pumpkin_bridge");
	private static final String PROPERTY = "pumpkin.dev.kitdemo";
	private static final String SHARE_DEMO_ENVIRONMENT = "PUMPKIN_SHARE_DEMO";
	private static final long POLL_MILLIS = 250;

	private KitDemo() {
	}

	public static void startIfRequested(MainThread mainThread) {
		if (System.getenv(SHARE_DEMO_ENVIRONMENT) != null) {
			ShareDemo.start(mainThread);
			return;
		}
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
			LOG.error("pumpkin_bridge kit demo failed to open", failure);
			opened.set(true);
		}
	}
}
