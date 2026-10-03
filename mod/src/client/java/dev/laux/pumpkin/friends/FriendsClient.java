package dev.laux.pumpkin.friends;

import dev.laux.pumpkin.friends.bridge.BridgeClient;
import dev.laux.pumpkin.friends.mc.LanWatcher;
import dev.laux.pumpkin.friends.mc.PauseMenuButton;
import dev.laux.pumpkin.friends.mc.Toasts;
import dev.laux.pumpkin.friends.state.StateStore;
import java.util.Optional;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.fabricmc.loader.api.FabricLoader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Einstieg der Mod (SPEC 11.2): ohne die Umgebungsvariablen des Launchers bleibt sie ganz inaktiv, ohne Thread und
 * ohne Oberfläche; sonst verbindet sie sich und hängt sich an Tick und Pausemenü.
 */
public final class FriendsClient implements ClientModInitializer {
	private static final Logger LOG = LoggerFactory.getLogger("pumpkin_friends");

	@Override
	public void onInitializeClient() {
		StateStore store = new StateStore();
		Optional<BridgeClient> client =
			BridgeClient.startIfLaunched(System.getenv(), versions(), store, BridgeClient.Timing.production());
		client.ifPresentOrElse(
			bridge -> attachToGame(bridge, store),
			() -> LOG.info("Nicht vom Pumpkin Launcher mit Freunden gestartet; Pumpkin Friends bleibt inaktiv"));
	}

	private static void attachToGame(BridgeClient client, StateStore store) {
		LanWatcher lanWatcher = new LanWatcher(client, store);
		PauseMenuButton pauseMenuButton = new PauseMenuButton(store, client);
		ClientTickEvents.END_CLIENT_TICK.register(minecraft -> guarded(() -> {
			store.drain().forEach(alert -> Toasts.show(minecraft, alert));
			lanWatcher.tick(minecraft);
			pauseMenuButton.tick(minecraft);
		}));
		ScreenEvents.AFTER_INIT.register((minecraft, screen, width, height) ->
			guarded(() -> pauseMenuButton.afterInit(minecraft, screen)));
	}

	private static BridgeClient.Versions versions() {
		return new BridgeClient.Versions(versionOf("pumpkin_friends"), versionOf("minecraft"));
	}

	private static String versionOf(String modId) {
		return FabricLoader.getInstance().getModContainer(modId)
			.map(mod -> mod.getMetadata().getVersion().getFriendlyString())
			.orElse("unknown");
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
