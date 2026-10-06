package dev.laux.pumpkin.bridge.compat;

import dev.laux.pumpkin.bridge.ui.UiSession;
import dev.laux.pumpkin.bridge.ui.model.Painter;
import dev.laux.pumpkin.bridge.ui.model.StateKeeper;
import dev.laux.pumpkin.bridge.ui.model.TrackedField;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import net.minecraft.client.gui.components.AbstractWidget;
//? if >=1.17 {
import net.minecraft.client.gui.narration.NarratedElementType;
import net.minecraft.client.gui.narration.NarrationElementOutput;
//?}
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.locale.Language;
import net.minecraft.network.chat.Component;
//? if >=26.1 {
import net.minecraft.client.gui.GuiGraphicsExtractor;
//?} else if >=1.20 {
/*import net.minecraft.client.gui.GuiGraphics;
*///?} else {
/*import com.mojang.blaze3d.vertex.PoseStack;
*///?}
//? if >=1.21.9 {
import net.minecraft.client.input.KeyEvent;
//?}

/**
 * The screen boundary for era-specific drawing, input, narration and lifecycle APIs. Legacy screens capture state
 * before resize and rebuild explicitly where vanilla does not provide {@code rebuildWidgets()}.
 *
 * <p>Vanilla runs {@code init()} again on every window resize and builds all widgets anew. {@link #build()} therefore
 * must create every widget; text, focus, scroll position and tab survive through the {@link StateKeeper}.
 *
 * <p>Every override is the soft-failure boundary of docs/bridge/README.md: it runs inside {@link UiSession}, so a failure of the
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
	private boolean widgetsBuilt;

	protected CompatScreen(String titleKey, Object... titleArguments) {
		super(Text.component(titleKey, titleArguments));
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
	 * The main Enter key, before the focused widget sees it (docs/bridge/README.md, "In-game navigation and world behavior"): a screen that
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
		return java.util.Collections.emptyList();
	}

	protected final StateKeeper state() {
		return state;
	}

	protected final <W extends AbstractWidget> W add(W widget) {
		//? if >=1.17 {
		return addRenderableWidget(widget);
		//?} else {
		/*return addButton(widget);
		*///?}
	}

	/** Makes the widget's text and focus survive a rebuild; {@code id} must be the same on every build. */
	protected final void track(String id, AbstractWidget widget) {
		tracked.add(new TrackedWidget(id, widget, this::setFocused));
	}

	/** The widget with the keyboard focus, if it is one of ours. */
	protected final Optional<AbstractWidget> focusedWidget() {
		return getFocused() instanceof AbstractWidget ? Optional.of((AbstractWidget) getFocused()) : Optional.empty();
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

	/** Vanilla 1.19 opens a screen through rebuildWidgets before its first widget build. */
	private void captureState() {
		if (widgetsBuilt) {
			state.capture(tracked);
			rememberState(state);
		}
	}

	/** docs/bridge/MINECRAFT-API.md, "Screen: lifecycle and rendering": {@code init()} is {@code protected () → void} in every era. */
	@Override
	protected final void init() {
		UiSession.run(() -> {
			widgetsBuilt = false;
			tracked.clear();
			lastFocused = null;
			build();
			state.restore(tracked);
			widgetsBuilt = true;
		});
	}

	//? if >=1.19 {
	@Override
	//?}
	protected void rebuildWidgets() {
		UiSession.run(() -> {
			captureState();
			//? if >=1.19 {
			super.rebuildWidgets();
			//?} else if >=1.17 {
			/*clearWidgets();
			init();
			*///?} else {
			/*buttons.clear();
			children.clear();
			setFocused(null);
			init();
			*///?}
			state.restoreFocus(tracked);
		});
	}


	//? if <1.20 {
	/*@Override
	public void resize(net.minecraft.client.Minecraft minecraft, int width, int height) {
		UiSession.run(() -> {
			captureState();
		});
		super.resize(minecraft, width, height);
	}
	*///?}
	@Override
	public void removed() {
		UiSession.run(() -> {
			captureState();
		});
		super.removed();
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
	//?} else if >=1.20 {
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
	//? if <1.20 {
	/*@Override
	public void render(PoseStack graphics, int mouseX, int mouseY, float partialTick) {
		UiSession.run(() -> {
			renderBackground(graphics);
			super.render(graphics, mouseX, mouseY, partialTick);
			paint(new CompatPainter(graphics, font));
		});
	}

	@Override
	public void renderBackground(PoseStack graphics) {
		UiSession.run(() -> {
			super.renderBackground(graphics);
			paintBackdrop(new CompatPainter(graphics, font));
		});
	}
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

	//? if >=1.17 {
	@Override
	protected void updateNarrationState(NarrationElementOutput output) {
		UiSession.run(() -> {
			super.updateNarrationState(output);
			String supplementary = String.join(". ", narration()).trim();
			if (!supplementary.isEmpty()) {
				output.nest().nest().add(NarratedElementType.TITLE, Text.literal(supplementary));
			}
		});
	}
	//?} else {
	/*@Override
	public String getNarrationMessage() {
		String supplementary = String.join(". ", narration()).trim();
		return supplementary.isEmpty() ? super.getNarrationMessage()
			: super.getNarrationMessage() + ". " + supplementary;
	}
	*///?}
}
