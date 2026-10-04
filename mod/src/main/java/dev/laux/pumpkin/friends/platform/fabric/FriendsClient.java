package dev.laux.pumpkin.friends.platform.fabric;

import dev.laux.pumpkin.friends.bridge.BridgeClient;
import dev.laux.pumpkin.friends.bridge.Timing;
import dev.laux.pumpkin.friends.compat.LanWatcher;
import dev.laux.pumpkin.friends.compat.MinecraftMainThread;
import dev.laux.pumpkin.friends.compat.NoticeToasts;
import dev.laux.pumpkin.friends.runtime.MainThread;
import dev.laux.pumpkin.friends.ui.UiSession;
import dev.laux.pumpkin.friends.ui.demo.KitDemo;
import java.util.List;
import java.util.Optional;
import net.fabricmc.api.ClientModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Einstieg der Mod (SPEC 11.2): ohne die Umgebungsvariablen des Launchers bleibt sie ganz inaktiv, ohne Thread und ohne
 * Oberfläche; sonst verbindet sie sich und hängt Knopf und LAN-Beobachtung an das Spiel. Keine Fabric-API nötig
 * (INGAME 4.2, Entscheidung 3): der einzige Hook ist der weiche Mixin auf {@code PauseScreen#init}, die wiederkehrende
 * Arbeit kommt über {@code Minecraft.execute} auf den Hauptthread.
 */
public final class FriendsClient implements ClientModInitializer {
	private static final Logger LOG = LoggerFactory.getLogger("pumpkin_friends");
	// Der Hub (Paket U2) ersetzt die Freunde-Liste; gemeldet wird er schon jetzt (INGAME 5.3, ready).
	private static final List<String> SCREENS = List.of("hub");
	private static final long POSTER_MILLIS = 1000;

	@Override
	public void onInitializeClient() {
		MainThread mainThread = new MinecraftMainThread();
		KitDemo.startIfRequested(mainThread);
		Optional<BridgeClient> client = BridgeClient.startIfLaunched(System.getenv(), new FabricPlatform(), Timing.production());
		client.ifPresentOrElse(
			started -> attachToGame(started, mainThread),
			() -> LOG.info("Nicht vom Pumpkin Launcher mit Freunden gestartet; Pumpkin Friends bleibt inaktiv"));
	}

	private static void attachToGame(BridgeClient client, MainThread mainThread) {
		PauseMenuButton.attach(client);
		client.addListener(new NoticeToasts(client));
		client.announceReady(SCREENS);
		startPoster(mainThread, new LanWatcher(client));
	}

	/**
	 * Der Sekunden-Poster (INGAME 4.2): kein Tick-Hook, sondern ein Daemon-Thread, der die wiederkehrende Arbeit einmal
	 * pro Sekunde auf den Hauptthread des Spiels postet. Er deckt den LAN-Watcher ab.
	 */
	private static void startPoster(MainThread mainThread, LanWatcher lanWatcher) {
		Thread poster = new Thread(() -> postEverySecond(mainThread, lanWatcher), "pumpkin-friends-poster");
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
			LOG.warn("Pumpkin Friends: Fehler übergangen", failure);
		} catch (LinkageError failure) {
			UiSession.disable(failure);
		}
	}
}
