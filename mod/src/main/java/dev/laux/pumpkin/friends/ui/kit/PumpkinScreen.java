package dev.laux.pumpkin.friends.ui.kit;

import dev.laux.pumpkin.friends.compat.CompatScreen;
import dev.laux.pumpkin.friends.compat.Text;
import dev.laux.pumpkin.friends.compat.Widgets;
import dev.laux.pumpkin.friends.ui.model.GuiMetrics;
import dev.laux.pumpkin.friends.ui.model.HubChrome;
import dev.laux.pumpkin.friends.ui.model.HubLayout;
import dev.laux.pumpkin.friends.ui.model.Painter;
import dev.laux.pumpkin.friends.ui.model.PumpkinTheme;
import dev.laux.pumpkin.friends.ui.model.Rect;
import dev.laux.pumpkin.friends.ui.model.StateKeeper;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.screens.Screen;

/**
 * The frame of every Pumpkin Friends screen (INGAME 6.2): title and status line, an optional tab bar, the scrolling
 * body and a footer with "Fertig", optionally joined by one action of the shown tab ("Freund hinzufügen", "Jetzt
 * zustellen"). A subclass says which tabs it has and which rows a tab shows; the frame lays them out for the window
 * size, and keeps text, focus, scroll position and selected tab across a rebuild (INGAME 6.5).
 */
public abstract class PumpkinScreen extends CompatScreen {
	private static final String DONE_ID = "footer.done";

	/** The one action a tab adds to the footer, left of "Fertig". */
	public record FooterButton(String label, Runnable onPress) {
	}

	private final Screen parent;
	private final HubChrome chrome = new HubChrome();
	private HubLayout layout;
	private ScrollPane body;
	private Optional<AbstractWidget> extraFooter = Optional.empty();
	private int selectedTab;

	protected PumpkinScreen(String titleKey, Screen parent, Object... titleArguments) {
		super(titleKey, titleArguments);
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

	/** The action the shown tab adds to the footer; most tabs have none. */
	protected Optional<FooterButton> extraFooterButton() {
		return Optional.empty();
	}

	/** The language key of the footer's right button; screens that cancel rename it. */
	protected String doneKey() {
		return "pumpkin_friends.done";
	}

	/** The width a wrapped sentence may use inside a text row, so wrapping and clipping agree. */
	protected final int wrappedTextWidth() {
		int contentWidth = Math.min(GuiMetrics.MAX_CONTENT_WIDTH, width - 2 * GuiMetrics.MIN_SIDE_MARGIN);
		return contentWidth - GuiMetrics.SCROLLBAR_GUTTER - 2 * GuiMetrics.ROW_PADDING;
	}

	protected final int selectedTab() {
		return selectedTab;
	}

	@Override
	protected final void build() {
		layout = HubLayout.of(width, height, tabLabels().size());
		selectedTab = Math.max(0, Math.min(state().selectedTab(), tabLabels().size() - 1));
		addAll(new TabBar(tabLabels(), layout.tabs(), selectedTab, this::selectTab).tabs());
		addFooterButtons();
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

	private void addFooterButtons() {
		Optional<FooterButton> extra = extraFooterButton();
		List<Rect> buttons = layout.footerButtons(extra.isPresent() ? 2 : 1);
		extraFooter = extra.map(action -> footerButton(action, buttons.get(0), "footer.extra"));
		addDoneButton(buttons.get(buttons.size() - 1));
	}

	private AbstractWidget footerButton(FooterButton action, Rect bounds, String id) {
		AbstractWidget widget = Widgets.button(action.label(), bounds.width(), action.onPress());
		widget.setX(bounds.x());
		widget.setY(bounds.y());
		add(widget);
		track(id, widget);
		return widget;
	}

	private void addDoneButton(Rect button) {
		footerButton(new FooterButton(Text.translate(doneKey()), this::onClose), button, DONE_ID);
	}

	/** The footer action of the shown tab, for changes while the screen is up (the deliver cooldown). */
	protected final Optional<AbstractWidget> extraFooterWidget() {
		return extraFooter;
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
		body.paintBackdrop(painter);
		paintTabConnector(painter);
	}

	/** Opens the body behind the selected tab, so the tab bar reads as tabs of one panel, not as buttons above it. */
	private void paintTabConnector(Painter painter) {
		if (selectedTab >= layout.tabs().size()) {
			return;
		}
		Rect tab = layout.tabs().get(selectedTab);
		Rect body = layout.body();
		int gapHeight = body.y() - tab.bottom();
		// A wrapped tab bar opens the body only under its last row; a tab above would draw through the row below.
		int lowestBottom = layout.tabs().stream().mapToInt(Rect::bottom).max().orElse(Integer.MIN_VALUE);
		if (gapHeight <= 0 || tab.bottom() != lowestBottom) {
			return;
		}
		painter.fill(tab.x() + 1, tab.bottom() - 1, tab.width() - 2, gapHeight + 2, PumpkinTheme.SUNK);
		painter.fill(tab.x(), tab.bottom(), 1, gapHeight, PumpkinTheme.EDGE);
		painter.fill(tab.right() - 1, tab.bottom(), 1, gapHeight, PumpkinTheme.EDGE);
	}

	@Override
	protected void paint(Painter painter) {
		chrome.paintHeader(painter, layout, titleText(), statusLine());
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

	/** The narrator reads the status line and then the shown rows, so painted text is not silent (INGAME 6.2). */
	@Override
	protected List<String> narration() {
		List<String> lines = new ArrayList<>();
		lines.add(statusLine());
		lines.addAll(body.narrationLines());
		return lines;
	}
}
