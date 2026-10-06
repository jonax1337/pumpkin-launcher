package dev.laux.pumpkin.bridge.platform.shared;

import dev.laux.pumpkin.bridge.compat.MinecraftMainThread;
import dev.laux.pumpkin.bridge.modules.friends.FriendsClient;
import dev.laux.pumpkin.bridge.modules.friends.compat.LanWatcher;
import dev.laux.pumpkin.bridge.modules.friends.compat.NoticeToasts;
import dev.laux.pumpkin.bridge.modules.friends.ui.FriendsModule;
import dev.laux.pumpkin.bridge.runtime.MainThread;
import dev.laux.pumpkin.bridge.transport.BridgeClient;
import dev.laux.pumpkin.bridge.transport.HostPlatform;
import dev.laux.pumpkin.bridge.transport.Timing;
import dev.laux.pumpkin.bridge.ui.UiSession;
import dev.laux.pumpkin.bridge.ui.demo.HubDemo;
import dev.laux.pumpkin.bridge.ui.demo.KitDemo;
import dev.laux.pumpkin.bridge.ui.home.BridgeHomeScreen;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

/** Loader-independent client lifecycle; loader adapters supply metadata and development status. */
public final class BridgeBootstrap {
	private static final Logger LOG = LogManager.getLogger("pumpkin_bridge");
	private static final List<String> SCREENS = Collections.unmodifiableList(Arrays.asList("home", "friends"));
	private static final long POSTER_MILLIS = 1000;

	private BridgeBootstrap() {
	}

	public static void initialize(HostPlatform platform, boolean development) {
		MainThread mainThread = new MinecraftMainThread();
		if (development) {
			KitDemo.startIfRequested(mainThread);
		}
		Optional<BridgeClient> client = BridgeClient.startIfLaunched(System.getenv(), platform, Timing.production());
		if (client.isPresent()) {
			attachToGame(client.get(), mainThread, development);
		} else {
			LOG.info("Nicht vom Pumpkin Launcher gestartet; Pumpkin Bridge bleibt inaktiv");
		}
	}

	private static void attachToGame(BridgeClient client, MainThread mainThread, boolean development) {
		FriendsClient friends = new FriendsClient(client);
		PumpkinMenuButton.attach(parent -> new BridgeHomeScreen(parent, client,
			Collections.singletonList(new FriendsModule(friends))));
		if (development) {
			HubDemo.attach(friends);
		}
		friends.addListener(new NoticeToasts(friends));
		client.announceReady(SCREENS);
		startPoster(mainThread, new LanWatcher(friends));
	}

	private static void startPoster(MainThread mainThread, LanWatcher lanWatcher) {
		Thread poster = new Thread(() -> postEverySecond(mainThread, lanWatcher), "pumpkin-bridge-poster");
		poster.setDaemon(true);
		poster.start();
	}

	private static void postEverySecond(MainThread mainThread, LanWatcher lanWatcher) {
		while (true) {
			try {
				Thread.sleep(POSTER_MILLIS);
			} catch (InterruptedException interrupted) {
				Thread.currentThread().interrupt();
				return;
			}
			mainThread.execute(() -> guarded(lanWatcher::tick));
		}
	}

	private static void guarded(Runnable action) {
		try {
			action.run();
		} catch (RuntimeException failure) {
			LOG.warn("Pumpkin Bridge: Fehler übergangen", failure);
		} catch (LinkageError failure) {
			UiSession.disable(failure);
		}
	}
}
