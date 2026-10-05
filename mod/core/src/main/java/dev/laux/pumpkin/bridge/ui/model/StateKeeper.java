package dev.laux.pumpkin.bridge.ui.model;

import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

/**
 * What a screen keeps across {@code Screen.init} re-runs (INGAME 6.5): vanilla clears every widget and builds them again
 * on each window resize. Before the rebuild the screen captures its widgets, after it the keeper puts text and focus
 * back into the new ones; the scroll position and the selected tab are plain values the new screen reads again.
 */
public final class StateKeeper {
	private final Map<String, String> texts = new HashMap<>();
	private Optional<String> focusedId = Optional.empty();
	private int firstRow;
	private int selectedTab;

	public void capture(Collection<? extends TrackedField> fields) {
		focusedId = Optional.empty();
		for (TrackedField field : fields) {
			field.text().ifPresent(text -> texts.put(field.id(), text));
			if (field.isFocused()) {
				focusedId = Optional.of(field.id());
			}
		}
	}

	public void restore(Collection<? extends TrackedField> fields) {
		for (TrackedField field : fields) {
			Optional.ofNullable(texts.get(field.id())).ifPresent(field::setText);
		}
		restoreFocus(fields);
	}

	/** Vanilla may choose a new initial focus after rebuilding; reapply only focus, not field text. */
	public void restoreFocus(Collection<? extends TrackedField> fields) {
		for (TrackedField field : fields) {
			if (focusedId.filter(field.id()::equals).isPresent()) {
				field.focus();
				return;
			}
		}
	}

	public int firstRow() {
		return firstRow;
	}

	public void rememberFirstRow(int row) {
		firstRow = row;
	}

	public int selectedTab() {
		return selectedTab;
	}

	public void rememberSelectedTab(int tab) {
		selectedTab = tab;
	}
}
