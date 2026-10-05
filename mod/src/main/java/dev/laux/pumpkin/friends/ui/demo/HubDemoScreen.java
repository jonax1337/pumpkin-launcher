package dev.laux.pumpkin.friends.ui.demo;

import dev.laux.pumpkin.friends.bridge.BridgeClient;
import dev.laux.pumpkin.friends.ui.hub.HubScreen;
import dev.laux.pumpkin.friends.ui.model.Painter;
import net.minecraft.client.gui.screens.Screen;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The hub as the dev run proves it (see {@link HubDemo}): after its first three rendered frames it logs one line and
 * closes itself unless the development-only demoHold switch is set. The screen is the real hub.
 */
final class HubDemoScreen extends HubScreen {
	private static final Logger LOG = LoggerFactory.getLogger("pumpkin_friends");
	private static final int FRAMES_BEFORE_PROOF = 3;

	private int renderedFrames;
	private boolean proofLogged;
	private boolean closing;

	HubDemoScreen(Screen parent, BridgeClient client) {
		super(parent, client);
	}

	@Override
	protected void paint(Painter painter) {
		super.paint(painter);
		renderedFrames++;
		if (renderedFrames == FRAMES_BEFORE_PROOF && !proofLogged) {
			proofLogged = true;
			LOG.info("pumpkin_friends hub demo rendered {} frames at {}x{}", renderedFrames, width, height);
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
