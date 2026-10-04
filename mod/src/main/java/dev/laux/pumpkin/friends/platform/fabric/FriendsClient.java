package dev.laux.pumpkin.friends.platform.fabric;

import dev.laux.pumpkin.friends.bridge.BridgeClient;
import dev.laux.pumpkin.friends.bridge.Timing;
import dev.laux.pumpkin.friends.compat.LanWatcher;
import dev.laux.pumpkin.friends.compat.NoticeToasts;
import java.util.List;
import java.util.Optional;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Einstieg der Mod (SPEC 11.2): ohne die Umgebungsvariablen des Launchers bleibt sie ganz inaktiv, ohne Thread und
 * ohne Oberfläche; sonst verbindet sie sich und hängt sich an Tick und Pausemenü.
 */
public final class FriendsClient implements ClientModInitializer {
	private static final Logger LOG = LoggerFactory.getLogger("pumpkin_friends");
	// The one screen of this mod is the friends list, which the next UI package replaces with the hub.
	private static final List<String> SCREENS = List.of("hub");

	@Override
	public void onInitializeClient() {
		Optional<BridgeClient> client = BridgeClient.startIfLaunched(System.getenv(), new FabricPlatform(), Timing.production());
		client.ifPresentOrElse(
			FriendsClient::attachToGame,
			() -> LOG.info("Nicht vom Pumpkin Launcher mit Freunden gestartet; Pumpkin Friends bleibt inaktiv"));
	}

	private static void attachToGame(BridgeClient client) {
		LanWatcher lanWatcher = new LanWatcher(client);
		PauseMenuButton pauseMenuButton = new PauseMenuButton(client);
		client.addListener(new NoticeToasts(client));
		client.announceReady(SCREENS);
		ClientTickEvents.END_CLIENT_TICK.register(minecraft -> guarded(() -> {
			lanWatcher.tick(minecraft);
			pauseMenuButton.tick(minecraft);
		}));
		ScreenEvents.AFTER_INIT.register((minecraft, screen, width, height) ->
			guarded(() -> pauseMenuButton.afterInit(minecraft, screen)));
	}

	// Ein Fehler der Mod darf weder den Client-Thread noch das Spiel abbrechen (SPEC 7.5).
	private static void guarded(Runnable action) {
		try {
			action.run();
		} catch (RuntimeException failure) {
			LOG.warn("Pumpkin Friends: Fehler übergangen", failure);
		}
	}
}
