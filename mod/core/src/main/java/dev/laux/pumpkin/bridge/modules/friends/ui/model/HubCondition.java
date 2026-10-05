package dev.laux.pumpkin.bridge.modules.friends.ui.model;

import dev.laux.pumpkin.bridge.transport.LinkState;
import dev.laux.pumpkin.bridge.protocol.json.WireNames;
import dev.laux.pumpkin.bridge.protocol.RejectReason;
import dev.laux.pumpkin.bridge.protocol.Topic;
import dev.laux.pumpkin.bridge.modules.friends.protocol.Ops.OpenTarget;
import dev.laux.pumpkin.bridge.modules.friends.state.Me;
import java.util.List;
import java.util.Optional;
import java.util.function.Predicate;

/**
 * What the hub explains in its status line (INGAME 6.3), as a pure function of the link, the pending dialog, the
 * {@code me} topic and whether every awaited topic has arrived. While the condition is not {@link Ready} every tab's
 * body shows the explanation instead of content. Texts are language keys; the screen translates them.
 */
public sealed interface HubCondition {
	/** The topics whose first push the hub waits for before it shows content (INGAME 6.3 "loading"); codes and blocked are R-B. */
	List<Topic> AWAITED = List.of(Topic.ME, Topic.FRIENDS, Topic.REQUESTS, Topic.INVITES, Topic.SESSION, Topic.JOIN, Topic.GAME);

	/** The language key of the status line; empty when there is nothing to explain. */
	String statusKey();

	/** Whether the tabs show their content. */
	boolean showsContent();

	/** The page the "Im Launcher öffnen" action ({@code launcher.open}) asks for. */
	OpenTarget openTarget();

	/** Whether the body offers the "Im Launcher öffnen" action. */
	default boolean offersLauncherOpen() {
		return true;
	}

	/**
	 * The states of INGAME 6.3 in their order: a link that is not there yet (or asked to try again), a launcher dialog
	 * that waits, the terminal refusals, Friends switched off, the identities the launcher cannot serve, the missing
	 * state, and the ready case.
	 */
	static HubCondition of(LinkState link, boolean awaitingLauncherDialog, Optional<Me> me, Predicate<Topic> received) {
		if (link instanceof LinkState.Rejected refused) {
			return refused.reason().isTerminal() ? new Refused(refused.reason()) : new Connecting();
		}
		if (!link.isConnected()) {
			return new Connecting();
		}
		if (awaitingLauncherDialog) {
			return new AwaitingConsent();
		}
		if (me.isEmpty()) {
			return new Loading();
		}
		Me identity = me.orElseThrow();
		if (!identity.enabled()) {
			return new SwitchedOff();
		}
		if (identity.availability() != Me.Availability.AVAILABLE) {
			return new WithoutIdentity(identity.availability());
		}
		if (AWAITED.stream().anyMatch(topic -> !received.test(topic))) {
			return new Loading();
		}
		return new Ready();
	}

	/** No link yet, or the launcher asked this game to try again shortly: the client keeps connecting. */
	record Connecting() implements HubCondition {
		private static final String KEY = "pumpkin_bridge.hub.state.connecting";

		@Override
		public String statusKey() {
			return KEY;
		}

		@Override
		public boolean showsContent() {
			return false;
		}

		@Override
		public OpenTarget openTarget() {
			return OpenTarget.FRIENDS;
		}

		@Override
		public boolean offersLauncherOpen() {
			return false;
		}
	}

	/** A dialog in the launcher waits for the player's answer to a request of this game. */
	record AwaitingConsent() implements HubCondition {
		private static final String KEY = "pumpkin_bridge.hub.state.awaiting";

		@Override
		public String statusKey() {
			return KEY;
		}

		@Override
		public boolean showsContent() {
			return false;
		}

		@Override
		public OpenTarget openTarget() {
			return OpenTarget.FRIENDS;
		}

		@Override
		public boolean offersLauncherOpen() {
			return false;
		}
	}

	/** The launcher refused this game for good; the text comes from the error catalogue, one key per reason. */
	record Refused(RejectReason reason) implements HubCondition {
		@Override
		public String statusKey() {
			return "pumpkin_bridge.hub.state.reject." + WireNames.of(reason);
		}

		@Override
		public boolean showsContent() {
			return false;
		}

		@Override
		public OpenTarget openTarget() {
			return OpenTarget.FRIENDS;
		}
	}

	/** Friends is switched off in the launcher; only there can it be switched on. */
	record SwitchedOff() implements HubCondition {
		private static final String KEY = "pumpkin_bridge.hub.state.disabled";

		@Override
		public String statusKey() {
			return KEY;
		}

		@Override
		public boolean showsContent() {
			return false;
		}

		@Override
		public OpenTarget openTarget() {
			return OpenTarget.SETTINGS;
		}
	}

	/** The launcher cannot serve friends at all right now: the identity is lost or there is no secret store. */
	record WithoutIdentity(Me.Availability availability) implements HubCondition {
		@Override
		public String statusKey() {
			return "pumpkin_bridge.hub.state.unavailable." + WireNames.of(availability);
		}

		@Override
		public boolean showsContent() {
			return false;
		}

		@Override
		public OpenTarget openTarget() {
			return OpenTarget.SETTINGS;
		}
	}

	/** Connected, but the first push of every awaited topic has not arrived yet (or the me topic is still missing). */
	record Loading() implements HubCondition {
		private static final String KEY = "pumpkin_bridge.hub.state.loading";

		@Override
		public String statusKey() {
			return KEY;
		}

		@Override
		public boolean showsContent() {
			return false;
		}

		@Override
		public OpenTarget openTarget() {
			return OpenTarget.FRIENDS;
		}
	}

	/** Everything is there; the tabs show their content. */
	record Ready() implements HubCondition {
		@Override
		public String statusKey() {
			return "";
		}

		@Override
		public boolean showsContent() {
			return true;
		}

		@Override
		public OpenTarget openTarget() {
			return OpenTarget.FRIENDS;
		}

		@Override
		public boolean offersLauncherOpen() {
			return false;
		}
	}
}
