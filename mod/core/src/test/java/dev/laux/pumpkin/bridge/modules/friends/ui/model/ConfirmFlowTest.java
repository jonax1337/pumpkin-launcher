package dev.laux.pumpkin.bridge.modules.friends.ui.model;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.laux.pumpkin.bridge.modules.friends.ui.model.ConfirmFlow.Answer;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** The one decision of a ConfirmFlow screen: the first answer decides, later ones change nothing. */
class ConfirmFlowTest {
	@Test
	void anUndecidedFlowHasNoAnswer() {
		ConfirmFlow decision = new ConfirmFlow();

		assertFalse(decision.decided());
		assertEquals(Optional.empty(), decision.answer());
	}

	@Test
	void theFirstAnswerDecides() {
		ConfirmFlow decision = new ConfirmFlow();

		decision.decide(Answer.YES);

		assertTrue(decision.decided());
		assertEquals(Optional.of(Answer.YES), decision.answer());
	}

	@Test
	void theEscapeKeyAfterTheConfirmButtonDoesNotChangeTheDecision() {
		ConfirmFlow decision = new ConfirmFlow();
		decision.decide(Answer.YES);

		decision.decide(Answer.NO);

		assertEquals(Optional.of(Answer.YES), decision.answer(), "closing the screen routes the escape key into the same decision");
	}

	@Test
	void aSecondConfirmClickDoesNotDecideAgain() {
		ConfirmFlow decision = new ConfirmFlow();
		decision.decide(Answer.NO);

		decision.decide(Answer.NO);

		assertTrue(decision.decided());
		assertEquals(Optional.of(Answer.NO), decision.answer());
	}
}
