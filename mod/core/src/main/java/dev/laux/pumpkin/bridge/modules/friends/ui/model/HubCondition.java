package dev.laux.pumpkin.bridge.modules.friends.ui.model;

import java.util.Objects;
import dev.laux.pumpkin.bridge.runtime.Immutable;

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
 * What the hub explains in its status line (docs/bridge/README.md, "In-game navigation and world behavior"), as a pure function of the link, the pending dialog, the
 * {@code me} topic and whether every awaited topic has arrived. While the condition is not {@link Ready} every tab's
 * body shows the explanation instead of content. Texts are language keys; the screen translates them.
 */
public interface HubCondition {
	/** The topics whose first push the hub waits for before it shows content (docs/bridge/README.md, "In-game navigation and world behavior"); codes and blocked are R-B. */
	List<Topic> AWAITED = Immutable.list(Topic.ME, Topic.FRIENDS, Topic.REQUESTS, Topic.INVITES, Topic.SESSION, Topic.JOIN, Topic.GAME);

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
	 * The states of docs/bridge/README.md, "In-game navigation and world behavior" in their order: a link that is not there yet (or asked to try again), a launcher dialog
	 * that waits, the terminal refusals, Friends switched off, the identities the launcher cannot serve, the missing
	 * state, and the ready case.
	 */
	static HubCondition of(LinkState link, boolean awaitingLauncherDialog, Optional<Me> me, Predicate<Topic> received) {
		if (link instanceof LinkState.Rejected) {
			LinkState.Rejected refused = (LinkState.Rejected) link;
			return refused.reason().isTerminal() ? new Refused(refused.reason()) : new Connecting();
		}
		if (!link.isConnected()) {
			return new Connecting();
		}
		if (awaitingLauncherDialog) {
			return new AwaitingConsent();
		}
		if (!me.isPresent()) {
			return new Loading();
		}
		Me identity = me.get();
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
	public static final class Connecting implements HubCondition {
		public Connecting() {
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Connecting)) {
				return false;
			}
			return true;
		}

		@Override
		public int hashCode() {
			return 0;
		}

		@Override
		public String toString() {
			return "Connecting[]";
		}

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
	public static final class AwaitingConsent implements HubCondition {
		public AwaitingConsent() {
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof AwaitingConsent)) {
				return false;
			}
			return true;
		}

		@Override
		public int hashCode() {
			return 0;
		}

		@Override
		public String toString() {
			return "AwaitingConsent[]";
		}

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
	public static final class Refused implements HubCondition {
		private final RejectReason reason;

		public Refused(RejectReason reason) {
			this.reason = reason;
		}

		public RejectReason reason() {
			return reason;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Refused)) {
				return false;
			}
			Refused that = (Refused) other;
			return Objects.equals(reason, that.reason);
		}

		@Override
		public int hashCode() {
			int hash = Objects.hashCode(reason);
			return hash;
		}

		@Override
		public String toString() {
			return "Refused[reason=" + reason + "]";
		}

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
	public static final class SwitchedOff implements HubCondition {
		public SwitchedOff() {
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof SwitchedOff)) {
				return false;
			}
			return true;
		}

		@Override
		public int hashCode() {
			return 0;
		}

		@Override
		public String toString() {
			return "SwitchedOff[]";
		}

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
	public static final class WithoutIdentity implements HubCondition {
		private final Me.Availability availability;

		public WithoutIdentity(Me.Availability availability) {
			this.availability = availability;
		}

		public Me.Availability availability() {
			return availability;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof WithoutIdentity)) {
				return false;
			}
			WithoutIdentity that = (WithoutIdentity) other;
			return Objects.equals(availability, that.availability);
		}

		@Override
		public int hashCode() {
			int hash = Objects.hashCode(availability);
			return hash;
		}

		@Override
		public String toString() {
			return "WithoutIdentity[availability=" + availability + "]";
		}

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
	public static final class Loading implements HubCondition {
		public Loading() {
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Loading)) {
				return false;
			}
			return true;
		}

		@Override
		public int hashCode() {
			return 0;
		}

		@Override
		public String toString() {
			return "Loading[]";
		}

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
	public static final class Ready implements HubCondition {
		public Ready() {
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof Ready)) {
				return false;
			}
			return true;
		}

		@Override
		public int hashCode() {
			return 0;
		}

		@Override
		public String toString() {
			return "Ready[]";
		}

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
