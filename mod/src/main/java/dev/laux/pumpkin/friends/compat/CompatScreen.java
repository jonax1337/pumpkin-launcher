package dev.laux.pumpkin.friends.compat;

import dev.laux.pumpkin.friends.ui.UiSession;
import dev.laux.pumpkin.friends.ui.model.Painter;
import dev.laux.pumpkin.friends.ui.model.StateKeeper;
import dev.laux.pumpkin.friends.ui.model.TrackedField;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.narration.NarratedElementType;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.locale.Language;
import net.minecraft.network.chat.Component;
//? if >=26.1 {
import net.minecraft.client.gui.GuiGraphicsExtractor;
//?} else {
/*import net.minecraft.client.gui.GuiGraphics;
*///?}
//? if >=1.21.9 {
import net.minecraft.client.input.KeyEvent;
//?}

/**
 * The one screen base class of the mod, and the only place where a Screen's era-specific methods are overridden: drawing,
 * the wheel and the page keys. Everything else a screen needs comes from signatures that did not change between 1.20 and
 * 26.3 (INGAME-API.md 3.1: override {@code init()} and {@code rebuildWidgets()}, never {@code resize}).
 *
 * <p>Vanilla runs {@code init()} again on every window resize and builds all widgets anew. {@link #build()} therefore
 * must create every widget; text, focus, scroll position and tab survive through the {@link StateKeeper}.
 *
 * <p>Every override is the soft-failure boundary of INGAME 4.2: it runs inside {@link UiSession}, so a failure of the
 * mod's UI is logged and switches the UI off for the session instead of reaching the game. Drawing stops then, while
 * the input overrides keep the vanilla half of their expression alive, above all the escape key.
 */
public abstract class CompatScreen extends Screen {
	// GLFW key codes; the LWJGL classes are not on the compile class path of a node.
	private static final int KEY_ENTER = 257;
	private static final int KEY_PAGE_UP = 266;
	private static final int KEY_PAGE_DOWN = 267;

	private final StateKeeper state = new StateKeeper();
	private final List<TrackedField> tracked = new ArrayList<>();
	private AbstractWidget lastFocused;
	private Language titleLanguage;
	private String translatedTitle = "";

	protected CompatScreen(String titleKey, Object... titleArguments) {
		super(Component.translatable(titleKey, titleArguments));
	}

	/** Cache only within one language instance; resource reloads must not freeze early untranslated keys. */
	protected final String titleText() {
		Language language = Language.getInstance();
		if (language != titleLanguage) {
			titleLanguage = language;
			translatedTitle = title.getString();
		}
		return translatedTitle;
	}

	/** Creates and adds every widget of the screen; runs on the first open and after every resize or rebuild. */
	protected abstract void build();

	/** Drawn on the dimmed background, behind the widgets. */
	protected void paintBackdrop(Painter painter) {
	}

	/** Drawn over the widgets. */
	protected void paint(Painter painter) {
	}

	protected void onTick() {
	}

	/** Called just before a rebuild; the place to store values the screen keeps besides text and focus. */
	protected void rememberState(StateKeeper keeper) {
	}

	/** One notch of the wheel; a positive delta is wheel up. Return true if the screen used it. */
	protected boolean onWheel(double verticalDelta) {
		return false;
	}

	/**
	 * The main Enter key, before the focused widget sees it (INGAME 6.2 "Enter in an EditBox submits"): a screen that
	 * submits on Enter answers true. The numpad Enter (335) stays with vanilla.
	 */
	protected boolean onEnter() {
		return false;
	}

	protected boolean onPageUp() {
		return false;
	}

	protected boolean onPageDown() {
		return false;
	}

	/** Text the narrator reads in addition to the focused widget, for example a status line the screen draws itself. */
	protected List<String> narration() {
		return List.of();
	}

	protected final StateKeeper state() {
		return state;
	}

	protected final <W extends AbstractWidget> W add(W widget) {
		return addRenderableWidget(widget);
	}

	/** Makes the widget's text and focus survive a rebuild; {@code id} must be the same on every build. */
	protected final void track(String id, AbstractWidget widget) {
		tracked.add(new TrackedWidget(id, widget, this::setFocused));
	}

	/** The widget with the keyboard focus, if it is one of ours. */
	protected final Optional<AbstractWidget> focusedWidget() {
		return getFocused() instanceof AbstractWidget widget ? Optional.of(widget) : Optional.empty();
	}

	/** True once for each change of the focused widget; lets a screen react to focus without fighting the wheel. */
	protected final Optional<AbstractWidget> newlyFocusedWidget() {
		Optional<AbstractWidget> focused = focusedWidget();
		AbstractWidget current = focused.orElse(null);
		if (current == lastFocused) {
			return Optional.empty();
		}
		lastFocused = current;
		return focused;
	}

	protected final void showScreen(Screen screen) {
		GameScreens.show(screen);
	}

	/** INGAME-API.md 3, "Screen: lifecycle and rendering": {@code init()} is {@code protected () → void} in every era. */
	@Override
	protected final void init() {
		UiSession.run(() -> {
			tracked.clear();
			lastFocused = null;
			build();
			state.restore(tracked);
		});
	}

	/** Same table: {@code rebuildWidgets()} is {@code protected () → void} in every era; it clears the widgets and calls {@code init()}. */
	@Override
	protected void rebuildWidgets() {
		UiSession.run(() -> {
			state.capture(tracked);
			rememberState(state);
			super.rebuildWidgets();
		});
	}

	@Override
	public void tick() {
		UiSession.run(() -> {
			super.tick();
			onTick();
		});
	}

	//? if >=26.1 {
	// Same table: extractRenderState replaces render from 26.1; the Screen draws background and widgets in it.
	@Override
	public void extractRenderState(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float partialTick) {
		UiSession.run(() -> {
			super.extractRenderState(graphics, mouseX, mouseY, partialTick);
			paint(new CompatPainter(graphics, font));
		});
	}

	@Override
	public void extractBackground(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float partialTick) {
		UiSession.run(() -> {
			super.extractBackground(graphics, mouseX, mouseY, partialTick);
			paintBackdrop(new CompatPainter(graphics, font));
		});
	}
	//?} else {
	/*// Same table: render(GuiGraphics, int, int, float) up to 1.21.11; renderBackground(GuiGraphics, int, int, float)
	// since 1.20.2, one parameter before.
	@Override
	public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
		UiSession.run(() -> {
			//? if <1.20.2 {
			// Vanilla never calls renderBackground from Screen.render here, so the Pumpkin panel needs its own call.
			renderBackground(graphics);
			//?}
			super.render(graphics, mouseX, mouseY, partialTick);
			paint(new CompatPainter(graphics, font));
		});
	}

	//? if >=1.20.2 {
	@Override
	public void renderBackground(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
		UiSession.run(() -> {
			super.renderBackground(graphics, mouseX, mouseY, partialTick);
			paintBackdrop(new CompatPainter(graphics, font));
		});
	}
	//?} else {
	@Override
	public void renderBackground(GuiGraphics graphics) {
		UiSession.run(() -> {
			super.renderBackground(graphics);
			paintBackdrop(new CompatPainter(graphics, font));
		});
	}
	//?}
	*///?}

	/** Same table, "Screen: input": {@code mouseScrolled} has four doubles since 1.20.2, three before (no horizontal delta). */
	//? if >=1.20.2 {
	@Override
	public boolean mouseScrolled(double mouseX, double mouseY, double scrollX, double scrollY) {
		return UiSession.attempt(() -> wheel(scrollY) || super.mouseScrolled(mouseX, mouseY, scrollX, scrollY));
	}
	//?} else {
	/*@Override
	public boolean mouseScrolled(double mouseX, double mouseY, double scrollY) {
		return UiSession.attempt(() -> wheel(scrollY) || super.mouseScrolled(mouseX, mouseY, scrollY));
	}
	*///?}

	//? if >=1.21.9 {
	// Same table: keyPressed(KeyEvent) from 1.21.9.
	@Override
	public boolean keyPressed(KeyEvent event) {
		return UiSession.attempt(() -> enterKey(event.key()) || pageKey(event.key()) || super.keyPressed(event));
	}
	//?} else {
	/*// Same table: keyPressed(int, int, int) up to 1.21.8.
	@Override
	public boolean keyPressed(int keyCode, int scanCode, int modifiers) {
		return UiSession.attempt(() -> enterKey(keyCode) || pageKey(keyCode) || super.keyPressed(keyCode, scanCode, modifiers));
	}
	*///?}

	/** The mod's Enter only while the UI is on; the vanilla half of the calling expression always runs. */
	private boolean enterKey(int glfwKey) {
		return !UiSession.off() && glfwKey == KEY_ENTER && onEnter();
	}

	/** The mod's page keys only while the UI is on; the vanilla half of the calling expression always runs. */
	private boolean pageKey(int glfwKey) {
		return !UiSession.off() && handlePageKey(glfwKey);
	}

	/** The mod's wheel only while the UI is on; the vanilla half of the calling expression always runs. */
	private boolean wheel(double verticalDelta) {
		return !UiSession.off() && onWheel(verticalDelta);
	}

	private boolean handlePageKey(int glfwKey) {
		if (glfwKey == KEY_PAGE_UP) {
			return onPageUp();
		}
		return glfwKey == KEY_PAGE_DOWN && onPageDown();
	}

	/** Same table, "Screen: widgets and narration": {@code updateNarrationState(NarrationElementOutput)} is the same in every era. */
	@Override
	protected void updateNarrationState(NarrationElementOutput output) {
		UiSession.run(() -> {
			super.updateNarrationState(output);
			for (String line : narration()) {
				if (!line.isBlank()) {
					output.nest().add(NarratedElementType.TITLE, Text.literal(line));
				}
			}
		});
	}
}
