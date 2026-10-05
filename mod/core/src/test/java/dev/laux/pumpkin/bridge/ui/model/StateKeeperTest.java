package dev.laux.pumpkin.bridge.ui.model;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/**
 * Vanilla re-runs {@code Screen.init} on every resize: all widgets are new objects. These tests play such a rebuild with
 * fake widgets and check what the player would notice: typed text, focus, scroll position and the selected tab.
 */
class StateKeeperTest {
	private static final String NAME_BOX = "add.name";
	private static final String NOTE_BOX = "add.note";

	private final StateKeeper keeper = new StateKeeper();

	@Test
	void typedTextAndFocusSurviveARebuild() {
		List<FakeField> before = screenWidgets();
		before.get(0).setText("Notch");
		before.get(1).setText("hello");
		before.get(1).focus();

		List<FakeField> after = rebuild(before);

		assertEquals(Optional.of("Notch"), after.get(0).text());
		assertEquals(Optional.of("hello"), after.get(1).text());
		assertTrue(after.get(1).isFocused());
		assertFalse(after.get(0).isFocused());
		assertFalse(after.get(2).isFocused());
	}

	@Test
	void aFocusedButtonKeepsItsFocusAndGetsNoText() {
		List<FakeField> before = screenWidgets();
		before.get(2).focus();

		List<FakeField> after = rebuild(before);

		assertTrue(after.get(2).isFocused());
		assertEquals(Optional.empty(), after.get(2).text());
	}

	@Test
	void focusIsForgottenWhenNothingHadIt() {
		List<FakeField> before = screenWidgets();
		before.get(0).focus();
		List<FakeField> second = rebuild(before);
		second.get(0).unfocus();

		List<FakeField> third = rebuild(second);

		assertTrue(third.stream().noneMatch(FakeField::isFocused));
	}

	@Test
	void textSurvivesTwoRebuildsInARow() {
		List<FakeField> before = screenWidgets();
		before.get(0).setText("Alex");

		List<FakeField> twice = rebuild(rebuild(before));

		assertEquals(Optional.of("Alex"), twice.get(0).text());
	}

	@Test
	void scrollPositionAndSelectedTabAreKept() {
		keeper.rememberFirstRow(12);
		keeper.rememberSelectedTab(3);

		assertEquals(12, keeper.firstRow());
		assertEquals(3, keeper.selectedTab());
	}

	@Test
	void restoringFocusAfterVanillaInitializationDoesNotReplayOldText() {
		List<FakeField> before = screenWidgets();
		before.get(1).setText("saved note");
		before.get(1).focus();
		keeper.capture(before);
		List<FakeField> rebuilt = screenWidgets();
		keeper.restore(rebuilt);
		rebuilt.get(1).unfocus();
		rebuilt.get(1).setText("current note");

		keeper.restoreFocus(rebuilt);

		assertTrue(rebuilt.get(1).isFocused());
		assertEquals(Optional.of("current note"), rebuilt.get(1).text());
	}

	@Test
	void aRestoredScrollPositionIsClampedWhenTheWindowGotBigger() {
		keeper.rememberFirstRow(35);
		ScrollModel smallWindow = new ScrollModel(Collections.nCopies(40, GuiMetrics.ROW_HEIGHT), 5 * GuiMetrics.ROW_HEIGHT);
		ScrollModel bigWindow = new ScrollModel(Collections.nCopies(40, GuiMetrics.ROW_HEIGHT), 20 * GuiMetrics.ROW_HEIGHT);

		smallWindow.scrollTo(keeper.firstRow());
		bigWindow.scrollTo(keeper.firstRow());

		assertEquals(35, smallWindow.firstRow());
		assertEquals(20, bigWindow.firstRow(), "40 rows, 20 shown: the last first row is 20");
	}

	/** Captures the old widgets, builds new ones, and restores into them: what a screen does around {@code init()}. */
	private List<FakeField> rebuild(List<FakeField> old) {
		keeper.capture(old);
		List<FakeField> fresh = screenWidgets();
		keeper.restore(fresh);
		return fresh;
	}

	private static List<FakeField> screenWidgets() {
		return new ArrayList<>(List.of(new FakeField(NAME_BOX, true), new FakeField(NOTE_BOX, true), new FakeField("add.send", false)));
	}

	private static final class FakeField implements TrackedField {
		private final String id;
		private final boolean hasText;
		private String text = "";
		private boolean focused;

		FakeField(String id, boolean hasText) {
			this.id = id;
			this.hasText = hasText;
		}

		@Override
		public String id() {
			return id;
		}

		@Override
		public Optional<String> text() {
			return hasText ? Optional.of(text) : Optional.empty();
		}

		@Override
		public void setText(String newText) {
			text = newText;
		}

		@Override
		public boolean isFocused() {
			return focused;
		}

		@Override
		public void focus() {
			focused = true;
		}

		void unfocus() {
			focused = false;
		}
	}
}
