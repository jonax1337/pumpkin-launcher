package dev.laux.pumpkin.bridge.ui.home;

import dev.laux.pumpkin.bridge.compat.CompatScreen;
import dev.laux.pumpkin.bridge.compat.Text;
import dev.laux.pumpkin.bridge.compat.Widgets;
import dev.laux.pumpkin.bridge.transport.BridgeClient;
import dev.laux.pumpkin.bridge.transport.LinkState;
import dev.laux.pumpkin.bridge.ui.kit.BridgeModule;
import dev.laux.pumpkin.bridge.ui.model.HomeLayout;
import dev.laux.pumpkin.bridge.ui.model.HubChrome;
import dev.laux.pumpkin.bridge.ui.model.Painter;
import dev.laux.pumpkin.bridge.ui.model.Rect;
import java.util.List;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.screens.Screen;

/** Shared entry screen. Modules own their tile information and all feature navigation. */
public final class BridgeHomeScreen extends CompatScreen {
	private final Screen parent;
	private final BridgeClient bridge;
	private final List<BridgeModule> modules;
	private final HubChrome chrome = new HubChrome();
	private final String[] shownSummaries;
	private HomeLayout layout;
	private LinkState shownLink;
	private String status = "";

	public BridgeHomeScreen(Screen parent, BridgeClient bridge, List<BridgeModule> modules) {
		super("pumpkin_bridge.home.title");
		this.parent = parent;
		this.bridge = bridge;
		this.modules = List.copyOf(modules);
		shownSummaries = new String[modules.size()];
	}

	@Override
	protected void build() {
		layout = HomeLayout.of(width, height, modules.size());
		shownLink = bridge.state();
		status = Text.translate(bridge.isConnected() ? "pumpkin_bridge.home.connected" : "pumpkin_bridge.home.disconnected");
		for (int index = 0; index < modules.size(); index++) {
			BridgeModule module = modules.get(index);
			shownSummaries[index] = module.summary();
			AbstractWidget tile = Widgets.moduleTile(module, layout.tiles().get(index), () -> showScreen(module.screen(this)));
			add(tile);
			track("module." + module.id(), tile);
		}
		Rect bounds = layout.chrome().footerButtons(1).get(0);
		AbstractWidget close = Widgets.button(Text.translate("pumpkin_bridge.back"), bounds.width(), this::onClose);
		close.setX(bounds.x());
		close.setY(bounds.y());
		add(close);
		track("home.back", close);
	}

	@Override
	protected void onTick() {
		if (!bridge.state().equals(shownLink)) {
			rebuildWidgets();
			return;
		}
		for (int index = 0; index < modules.size(); index++) {
			if (!modules.get(index).summary().equals(shownSummaries[index])) {
				rebuildWidgets();
				return;
			}
		}
	}

	@Override
	protected void paintBackdrop(Painter painter) {
		HubChrome.paintBackdrop(painter, layout.chrome());
	}

	@Override
	protected void paint(Painter painter) {
		chrome.paintHeader(painter, layout.chrome(), titleText(), status);
	}

	@Override
	protected List<String> narration() {
		return List.of(status);
	}

	@Override
	public void onClose() {
		showScreen(parent);
	}
}
