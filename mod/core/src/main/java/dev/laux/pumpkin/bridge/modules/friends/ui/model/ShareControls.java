package dev.laux.pumpkin.bridge.modules.friends.ui.model;

import dev.laux.pumpkin.bridge.runtime.Immutable;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * What the player chose in the Teilen tab's invite section: the toggled friends (never more than the guest limit allows)
 * and whether the world's name is shown to the guests (docs/bridge/README.md, "In-game navigation and world behavior", "Weltname zeigen"). Lives longer than one widget
 * build, so a resize keeps the choices.
 */
public final class ShareControls {
	private final Set<String> selected = new LinkedHashSet<>();
	private boolean showWorldName;

	/** Sets a friend's toggle; a selection that would exceed the guest limit stays off and returns {@code false}. */
	public boolean set(String friend, boolean selected) {
		if (!selected) {
			this.selected.remove(friend);
			return true;
		}
		if (this.selected.contains(friend) || this.selected.size() >= Invitees.GUEST_LIMIT) {
			return this.selected.contains(friend);
		}
		this.selected.add(friend);
		return true;
	}

	public boolean isSelected(String friend) {
		return selected.contains(friend);
	}

	public void toggleShowWorldName() {
		showWorldName = !showWorldName;
	}

	public boolean showsWorldName() {
		return showWorldName;
	}

	public boolean canInvite() {
		return !selected.isEmpty();
	}

	public List<String> selection() {
		return Immutable.copyList(selected);
	}

	/** Drops friends that are no longer invitable, for example after they went offline or became guests. */
	public void retainAll(Collection<String> stillInvitable) {
		selected.retainAll(stillInvitable);
	}
}
