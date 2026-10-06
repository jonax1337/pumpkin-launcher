package dev.laux.pumpkin.bridge.ui.demo;

import dev.laux.pumpkin.bridge.modules.friends.FriendsClient;
import dev.laux.pumpkin.bridge.modules.friends.ui.FriendsScreen;
import dev.laux.pumpkin.bridge.ui.model.Painter;
import net.minecraft.client.gui.screens.Screen;
import org.apache.logging.log4j.Logger;
import org.apache.logging.log4j.LogManager;

/**
 * The hub as the dev run proves it (see {@link HubDemo}): after its first three rendered frames it logs one line and
 * closes itself unless the development-only demoHold switch is set. The screen is the real hub.
 */
final class HubDemoScreen extends FriendsScreen {
	private static final Logger LOG = LogManager.getLogger("pumpkin_bridge");
	private static final int FRAMES_BEFORE_PROOF = 3;

	private int renderedFrames;
	private boolean proofLogged;
	private boolean closing;

	HubDemoScreen(Screen parent, FriendsClient client) {
		super(parent, client);
	}

	@Override
	protected void paint(Painter painter) {
		super.paint(painter);
		renderedFrames++;
		if (renderedFrames == FRAMES_BEFORE_PROOF && !proofLogged) {
			proofLogged = true;
			LOG.info("pumpkin_bridge hub demo rendered {} frames at {}x{}", renderedFrames, width, height);
		}
	}

	/** Closing happens in the tick, not in the middle of drawing. */
	@Override
	protected void onTick() {
		super.onTick();
		if (proofLogged && !closing && !Boolean.getBoolean("pumpkin.dev.demoHold")
			&& !"true".equalsIgnoreCase(System.getenv("PUMPKIN_DEV_DEMO_HOLD"))) {
			closing = true;
			onClose();
		}
	}
}
