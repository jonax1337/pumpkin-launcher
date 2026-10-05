package dev.laux.pumpkin.bridge.ui.demo;

import dev.laux.pumpkin.bridge.compat.GameScreens;
import dev.laux.pumpkin.bridge.runtime.MainThread;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Opens the {@link ShareDemoScreen} once, when the title screen first shows, if the game runs with the environment
 * variable {@code PUMPKIN_SHARE_DEMO} set (the dev run sets it next to the launcher variables; a second system property
 * would need build wiring that is not this package's to add). The pure-UI render proof of the Teilen tab (INGAME 6.4):
 * no world, no clicks.
 */
public final class ShareDemo {
	private static final Logger LOG = LoggerFactory.getLogger("pumpkin_bridge");
	private static final long POLL_MILLIS = 250;

	private ShareDemo() {
	}

	static void start(MainThread mainThread) {
		Thread poller = new Thread(() -> pollUntilOpened(mainThread), "pumpkin-sharedemo");
		poller.setDaemon(true);
		poller.start();
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
				GameScreens.show(new ShareDemoScreen(GameScreens.current()));
				opened.set(true);
			}
		} catch (RuntimeException failure) {
			LOG.error("pumpkin_bridge share demo failed to open", failure);
			opened.set(true);
		}
	}
}
