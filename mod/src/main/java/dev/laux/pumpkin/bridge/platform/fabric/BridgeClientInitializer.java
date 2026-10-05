package dev.laux.pumpkin.bridge.platform.fabric;

import dev.laux.pumpkin.bridge.transport.BridgeClient;
import dev.laux.pumpkin.bridge.transport.Timing;
import dev.laux.pumpkin.bridge.modules.friends.FriendsClient;
import dev.laux.pumpkin.bridge.modules.friends.ui.FriendsModule;
import dev.laux.pumpkin.bridge.ui.demo.HubDemo;
import dev.laux.pumpkin.bridge.ui.home.BridgeHomeScreen;
import dev.laux.pumpkin.bridge.modules.friends.compat.LanWatcher;
import dev.laux.pumpkin.bridge.compat.MinecraftMainThread;
import dev.laux.pumpkin.bridge.modules.friends.compat.NoticeToasts;
import dev.laux.pumpkin.bridge.runtime.MainThread;
import dev.laux.pumpkin.bridge.ui.UiSession;
import dev.laux.pumpkin.bridge.ui.demo.KitDemo;
import java.util.List;
import java.util.Optional;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.loader.api.FabricLoader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Client-only Bridge entry. Launcher-issued environment variables start the shared connection.
 * The home registers feature modules; Friends owns LAN observation and its notifications.
 */
public final class BridgeClientInitializer implements ClientModInitializer {
	private static final Logger LOG = LoggerFactory.getLogger("pumpkin_bridge");
	private static final List<String> SCREENS = List.of("home", "friends");
	private static final long POSTER_MILLIS = 1000;

	@Override
	public void onInitializeClient() {
		MainThread mainThread = new MinecraftMainThread();
		if (FabricLoader.getInstance().isDevelopmentEnvironment()) {
			KitDemo.startIfRequested(mainThread);
		}
		Optional<BridgeClient> client = BridgeClient.startIfLaunched(System.getenv(), new FabricPlatform(), Timing.production());
		client.ifPresentOrElse(
			started -> attachToGame(started, mainThread),
			() -> LOG.info("Nicht vom Pumpkin Launcher gestartet; Pumpkin Bridge bleibt inaktiv"));
	}

	private static void attachToGame(BridgeClient client, MainThread mainThread) {
		FriendsClient friends = new FriendsClient(client);
		PumpkinMenuButton.attach(parent -> new BridgeHomeScreen(parent, client, List.of(new FriendsModule(friends))));
		if (FabricLoader.getInstance().isDevelopmentEnvironment()) {
			HubDemo.attach(friends);
		}
		friends.addListener(new NoticeToasts(friends));
		client.announceReady(SCREENS);
		startPoster(mainThread, new LanWatcher(friends));
	}

	/**
	 * Der Sekunden-Poster (INGAME 4.2): kein Tick-Hook, sondern ein Daemon-Thread, der die wiederkehrende Arbeit einmal
	 * pro Sekunde auf den Hauptthread des Spiels postet. Er deckt den LAN-Watcher ab.
	 */
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

	// Ein Fehler der Mod darf weder den Client-Thread noch das Spiel abbrechen (SPEC 7.5). Ein RuntimeException wird
	// übergangen (der nächste Sekundentick versucht es erneut); ein LinkageError (Zeitsprung) schaltet außerdem die UI
	// der Sitzung ab (INGAME 4.2), denn die Klasse bleibt gebrochen.
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
