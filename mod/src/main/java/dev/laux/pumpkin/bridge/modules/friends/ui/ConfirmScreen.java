package dev.laux.pumpkin.bridge.modules.friends.ui;

import dev.laux.pumpkin.bridge.runtime.Immutable;

import dev.laux.pumpkin.bridge.modules.friends.ui.model.ConfirmFlow;

import dev.laux.pumpkin.bridge.compat.Text;
import dev.laux.pumpkin.bridge.ui.kit.PumpkinScreen;
import dev.laux.pumpkin.bridge.ui.kit.Row;
import dev.laux.pumpkin.bridge.ui.model.Fit;
import java.util.List;
import java.util.Optional;
import net.minecraft.client.gui.screens.Screen;

/**
 * ConfirmFlow (docs/bridge/README.md, "In-game navigation and world behavior"): the reusable yes/no screen for destructive in-game steps (leave the world, remove a
 * friend, block). The question wraps over the body, the confirm action sits left of the cancel button in the footer,
 * and the escape key decides like the cancel button — exactly once ({@link ConfirmFlow}).
 */
public final class ConfirmScreen extends PumpkinScreen {
	private final ConfirmFlow decision = new ConfirmFlow();
	private final String question;
	private final String confirmLabel;
	private final Runnable action;

	public ConfirmScreen(Screen parent, String question, String confirmLabel, Runnable action) {
		super("pumpkin_bridge.title", parent);
		this.question = question;
		this.confirmLabel = confirmLabel;
		this.action = action;
	}

	@Override
	protected List<Row> rows(int tab) {
		return Fit.wrap(question, wrappedTextWidth(), Text::width).stream().map(Row::text).collect(Immutable.toList());
	}

	@Override
	protected Optional<FooterButton> extraFooterButton() {
		return Optional.of(new FooterButton(confirmLabel, this::confirmed));
	}

	@Override
	protected String doneKey() {
		return "pumpkin_bridge.cancel";
	}

	private void confirmed() {
		decision.decide(ConfirmFlow.Answer.YES);
		action.run();
		onClose();
	}

	@Override
	public void onClose() {
		decision.decide(ConfirmFlow.Answer.NO);
		super.onClose();
	}
}
