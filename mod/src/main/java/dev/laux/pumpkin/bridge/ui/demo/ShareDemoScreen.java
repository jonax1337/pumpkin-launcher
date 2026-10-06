package dev.laux.pumpkin.bridge.ui.demo;

import dev.laux.pumpkin.bridge.compat.Text;
import dev.laux.pumpkin.bridge.protocol.FrameCodec;
import dev.laux.pumpkin.bridge.protocol.LauncherFrame;
import dev.laux.pumpkin.bridge.transport.request.Op;
import dev.laux.pumpkin.bridge.transport.request.Reply;
import dev.laux.pumpkin.bridge.modules.friends.state.TopicStore;
import dev.laux.pumpkin.bridge.modules.friends.ui.ShareLink;
import dev.laux.pumpkin.bridge.modules.friends.ui.ShareTab;
import dev.laux.pumpkin.bridge.ui.kit.PumpkinScreen;
import dev.laux.pumpkin.bridge.ui.kit.Row;
import dev.laux.pumpkin.bridge.ui.model.Painter;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import net.minecraft.client.gui.screens.Screen;

/**
 * The Teilen tab in its two states without a world (the pure-UI proof of the dev run): the screen feeds a real
 * {@link TopicStore} through the production codec with the exact game and friends lines the FakeLauncher pushes
 * ({@code scripts/FakeLauncher.java}), renders the real {@link ShareTab} over them and logs one line per rendered state
 * ({@code ShareTab#onRendered}). Half a minute in, the verified port arrives as the launcher's push would; when both
 * states have rendered, the screen closes itself like the kit demo.
 */
final class ShareDemoScreen extends PumpkinScreen {
	/** FakeLauncher's game topic, once without and once with the verified LAN port. */
	private static final String GAME_UNPUBLISHED =
		"{\"type\":\"state\",\"topic\":\"game\",\"rev\":1,\"value\":{\"hostable\":true,\"reason\":null,\"lan\":null}}";
	private static final String GAME_PUBLISHED =
		"{\"type\":\"state\",\"topic\":\"game\",\"rev\":2,\"value\":{\"hostable\":true,\"reason\":null,\"lan\":{\"port\":50123}}}";
	private static final String FRIENDS =
		"{\"type\":\"state\",\"topic\":\"friends\",\"rev\":1,\"value\":[{\"id\":\"f1\",\"name\":\"jeb_\",\"mcUuid\":null,"
			+ "\"presence\":\"online\"},{\"id\":\"f2\",\"name\":\"Bea\",\"mcUuid\":null,\"presence\":\"online\"},"
			+ "{\"id\":\"f3\",\"name\":\"Notch\",\"mcUuid\":null,\"presence\":\"offline\"}]}";
	private static final int TICKS_BEFORE_THE_PORT = 50;
	private static final int TICKS_BEFORE_CLOSING = 150;

	private final TopicStore topics = new TopicStore();
	private final ShareTab tab = new ShareTab(new DemoShareLink());
	private int ticks;

	ShareDemoScreen(Screen parent) {
		super("pumpkin_bridge.share.demo.title", parent);
		feed(GAME_UNPUBLISHED);
		feed(FRIENDS);
	}

	@Override
	protected List<Row> rows(int ignored) {
		return tab.rows();
	}

	@Override
	protected void onTick() {
		super.onTick();
		ticks++;
		if (ticks == TICKS_BEFORE_THE_PORT) {
			feed(GAME_PUBLISHED);
			rebuildWidgets();
		}
		if (ticks == TICKS_BEFORE_CLOSING) {
			onClose();
		}
	}

	@Override
	protected void paint(Painter painter) {
		super.paint(painter);
		tab.onRendered(width, height);
	}

	private void feed(String line) {
		FrameCodec.decode(line).filter(LauncherFrame.State.class::isInstance)
			.map(LauncherFrame.State.class::cast)
			.ifPresent(topics::apply);
	}

	/** The topics of the fed lines; operations go nowhere, the demo has no launcher to ask. */
	private final class DemoShareLink implements ShareLink {
		@Override
		public TopicStore topics() {
			return topics;
		}

		@Override
		public <T> CompletableFuture<Reply<T>> ask(Op<T> op) {
			return new CompletableFuture<>();
		}
	}
}
