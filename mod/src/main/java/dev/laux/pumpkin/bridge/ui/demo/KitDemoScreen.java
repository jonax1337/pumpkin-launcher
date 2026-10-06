package dev.laux.pumpkin.bridge.ui.demo;

import dev.laux.pumpkin.bridge.runtime.Immutable;

import dev.laux.pumpkin.bridge.compat.Clipboard;
import dev.laux.pumpkin.bridge.compat.Text;
import dev.laux.pumpkin.bridge.compat.Widgets;
import dev.laux.pumpkin.bridge.ui.kit.PumpkinScreen;
import dev.laux.pumpkin.bridge.ui.kit.Row;
import dev.laux.pumpkin.bridge.ui.model.Painter;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import org.apache.logging.log4j.Logger;
import org.apache.logging.log4j.LogManager;

/**
 * Throw-away screen that proves the widget kit renders on a Minecraft version: tabs, a scroll list of 40 rows, an edit
 * box, a toggle and buttons. Reachable only with {@code -Dpumpkin.dev.kitdemo=true} ({@link KitDemo}). After its first
 * three rendered frames it logs one line and closes itself unless the development-only demoHold switch is set.
 */
final class KitDemoScreen extends PumpkinScreen {
	private static final Logger LOG = LogManager.getLogger("pumpkin_bridge");
	private static final int LIST_ROW_COUNT = 40;
	private static final int TWO_LINE_EVERY = 5;
	private static final int ACTION_WIDTH = 50;
	private static final int FIELD_MAX_LENGTH = 64;
	private static final int FRAMES_BEFORE_PROOF = 3;
	private static final int LIST_TAB = 0;

	private int renderedFrames;
	private boolean proofLogged;
	private boolean closing;

	KitDemoScreen(Screen parent) {
		super("pumpkin_bridge.kitdemo.title", parent);
	}

	@Override
	protected List<String> tabLabels() {
		return Immutable.list(Text.translate("pumpkin_bridge.kitdemo.tab_list"), Text.translate("pumpkin_bridge.kitdemo.tab_form"));
	}

	@Override
	protected String statusLine() {
		return Text.translate("pumpkin_bridge.kitdemo.status", LIST_ROW_COUNT);
	}

	@Override
	protected List<Row> rows(int tab) {
		return tab == LIST_TAB ? listRows() : formRows();
	}

	private static List<Row> listRows() {
		List<Row> rows = new ArrayList<>();
		for (int number = 1; number <= LIST_ROW_COUNT; number++) {
			Row row = number % TWO_LINE_EVERY == 0
				? Row.twoLines(Text.translate("pumpkin_bridge.kitdemo.row", number), Text.translate("pumpkin_bridge.kitdemo.row_second"))
				: Row.text(Text.translate("pumpkin_bridge.kitdemo.row", number));
			rows.add(row.withAction("list.open." + number, Widgets.button(Text.translate("pumpkin_bridge.kitdemo.open"), ACTION_WIDTH, () -> { })));
		}
		return rows;
	}

	private static List<Row> formRows() {
		EditBox name = Widgets.editBox(Text.translate("pumpkin_bridge.kitdemo.name_hint"), 100, FIELD_MAX_LENGTH);
		return Immutable.list(
			Row.heading(Text.translate("pumpkin_bridge.kitdemo.form")),
			Row.fullWidth("form.name", name),
			Row.fullWidth("form.toggle", Widgets.toggle(Text.translate("pumpkin_bridge.kitdemo.toggle"), false, selected -> { })),
			Row.text(Text.translate("pumpkin_bridge.kitdemo.clipboard"))
				.withAction("form.copy", Widgets.button(Text.translate("pumpkin_bridge.kitdemo.copy"), ACTION_WIDTH,
					() -> Clipboard.copy(name.getValue())))
				.withAction("form.paste", Widgets.button(Text.translate("pumpkin_bridge.kitdemo.paste"), ACTION_WIDTH,
					() -> name.setValue(Clipboard.paste()))));
	}

	@Override
	protected void paint(Painter painter) {
		super.paint(painter);
		renderedFrames++;
		if (renderedFrames == FRAMES_BEFORE_PROOF && !proofLogged) {
			proofLogged = true;
			LOG.info("pumpkin_bridge kit demo rendered {} frames at {}x{}", renderedFrames, width, height);
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
