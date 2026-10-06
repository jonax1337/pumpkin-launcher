package dev.laux.pumpkin.bridge.modules.friends.ui.model;

import java.util.Optional;

/**
 * One yes/no decision of a ConfirmFlow screen (docs/bridge/README.md, "In-game navigation and world behavior"): the first answer decides, every later one — the escape key
 * after the confirm button, a second click after closing — changes nothing. Destructive actions run only from the single
 * decision.
 */
public final class ConfirmFlow {
	public enum Answer {
		YES,
		NO
	}

	private Optional<Answer> answer = Optional.empty();

	public Optional<Answer> answer() {
		return answer;
	}

	public boolean decided() {
		return answer.isPresent();
	}

	public void decide(Answer given) {
		if (!answer.isPresent()) {
			answer = Optional.of(given);
		}
	}
}
