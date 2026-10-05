package dev.laux.pumpkin.bridge.modules.friends.ui.model;

import dev.laux.pumpkin.bridge.ui.model.Rect;

import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class FriendCardLayoutTest {
	@ParameterizedTest
	@ValueSource(ints = {120, 180, 294, 304})
	void identityStatusAndActionDoNotOverlap(int width) {
		Rect row = new Rect(10, 40, width, FriendCardLayout.ACTION_HEIGHT);
		FriendCardLayout card = FriendCardLayout.of(row, 96, List.of(60));

		assertTrue(card.portrait().right() <= card.name().x());
		assertTrue(card.name().right() <= card.status().x());
		assertTrue(card.status().right() <= row.right());
		assertTrue(card.detail().y() >= card.name().bottom());
		for (Rect action : card.actions()) {
			assertTrue(action.y() >= card.detail().bottom());
			assertTrue(action.x() >= row.x() && action.right() <= row.right());
			assertTrue(action.bottom() <= row.bottom());
		}
	}

	@ParameterizedTest
	@ValueSource(ints = {120, 180, 294, 304})
	void longStatusCannotDisplaceTheNameOrPortrait(int width) {
		Rect row = new Rect(10, 40, width, FriendCardLayout.HEIGHT);
		FriendCardLayout card = FriendCardLayout.of(row, 1000, List.of());

		assertTrue(card.name().width() > 0, "the name retains space even when a translated status is long");
		assertTrue(card.name().right() <= card.status().x());
		assertTrue(card.portrait().right() <= card.name().x());
		assertTrue(card.detail().bottom() <= row.bottom());
	}
}
