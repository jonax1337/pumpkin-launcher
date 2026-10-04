package dev.laux.pumpkin.friends.ui.kit;

import dev.laux.pumpkin.friends.compat.CompatScreen;
import dev.laux.pumpkin.friends.compat.Text;
import dev.laux.pumpkin.friends.compat.Widgets;
import dev.laux.pumpkin.friends.ui.model.HubChrome;
import dev.laux.pumpkin.friends.ui.model.HubLayout;
import dev.laux.pumpkin.friends.ui.model.Painter;
import dev.laux.pumpkin.friends.ui.model.Rect;
import dev.laux.pumpkin.friends.ui.model.StateKeeper;
import java.util.List;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.screens.Screen;

/**
 * The frame of every Pumpkin Friends screen (INGAME 6.2): title and status line, an optional tab bar, the scrolling
 * body and a footer with "Fertig". A subclass says which tabs it has and which rows a tab shows; the frame lays them
 * out for the window size, and keeps text, focus, scroll position and selected tab across a rebuild (INGAME 6.5).
 */
public abstract class PumpkinScreen extends CompatScreen {
	private static final String DONE_ID = "footer.done";

	private final String titleText;
	private final Screen parent;
	private HubLayout layout;
	private ScrollPane body;
	private int selectedTab;

	protected PumpkinScreen(String title, Screen parent) {
		super(title);
		this.titleText = title;
		this.parent = parent;
	}

	/** The rows of the selected tab, with fresh widgets; called once per build. */
	protected abstract List<Row> rows(int tab);

	/** Labels of the tabs; none means a screen without a tab bar. */
	protected List<String> tabLabels() {
		return List.of();
	}

	protected String statusLine() {
		return "";
	}

	protected final int selectedTab() {
		return selectedTab;
	}

	@Override
	protected final void build() {
		layout = HubLayout.of(width, height, tabLabels().size());
		selectedTab = Math.max(0, Math.min(state().selectedTab(), tabLabels().size() - 1));
		addAll(new TabBar(tabLabels(), layout.tabs(), selectedTab, this::selectTab).tabs());
		addDoneButton();
		body = new ScrollPane(layout.body(), rows(selectedTab), state().firstRow());
		addAll(body.actions());
		body.layout();
	}

	private void addAll(List<Row.Action> actions) {
		for (Row.Action action : actions) {
			add(action.widget());
			track(action.id(), action.widget());
		}
	}

	private void addDoneButton() {
		Rect button = layout.footerButtons(1).get(0);
		AbstractWidget done = Widgets.button(Text.translate("pumpkin_friends.done"), button.width(), this::onClose);
		done.setX(button.x());
		done.setY(button.y());
		add(done);
		track(DONE_ID, done);
	}

	private void selectTab(int tab) {
		selectedTab = tab;
		body.scrollToTop();
		rebuildWidgets();
	}

	@Override
	protected void rememberState(StateKeeper keeper) {
		keeper.rememberFirstRow(body.firstRow());
		keeper.rememberSelectedTab(selectedTab);
	}

	@Override
	public void onClose() {
		showScreen(parent);
	}

	@Override
	protected void onTick() {
		newlyFocusedWidget().ifPresent(body::reveal);
	}

	@Override
	protected void paintBackdrop(Painter painter) {
		HubChrome.paintBackdrop(painter, layout);
	}

	@Override
	protected void paint(Painter painter) {
		HubChrome.paintHeader(painter, layout, titleText, statusLine());
		body.paint(painter);
	}

	@Override
	protected boolean onWheel(double verticalDelta) {
		return body.wheel(verticalDelta);
	}

	@Override
	protected boolean onPageUp() {
		return body.pageUp();
	}

	@Override
	protected boolean onPageDown() {
		return body.pageDown();
	}

	@Override
	protected List<String> narration() {
		return List.of(statusLine());
	}
}
