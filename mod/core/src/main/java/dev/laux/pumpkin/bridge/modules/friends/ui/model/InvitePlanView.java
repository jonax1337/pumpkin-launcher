package dev.laux.pumpkin.bridge.modules.friends.ui.model;

import java.util.Objects;

import dev.laux.pumpkin.bridge.modules.friends.protocol.Results.PlanVerdict;

/**
 * What the InviteScreen does with a plan verdict (docs/bridge/README.md, "In-game navigation and world behavior"): only {@code ready} is joined from the
 * running game; every other verdict is the launcher's to solve, so the screen shows the reason and offers
 * "Im Launcher öffnen" alone ("Passende Instanz starten" runs there; the direct joinLaunch flow is later polish).
 *
 * @param reasonKey the language key of the verdict's text, {@code null} when the invite can be joined
 */
public final class InvitePlanView {
	private final boolean joinFromHere;
	private final String reasonKey;

	public InvitePlanView(boolean joinFromHere, String reasonKey) {
		this.joinFromHere = joinFromHere;
		this.reasonKey = reasonKey;
	}

	public boolean joinFromHere() {
		return joinFromHere;
	}

	public String reasonKey() {
		return reasonKey;
	}

	@Override
	public boolean equals(Object other) {
		if (this == other) {
			return true;
		}
		if (!(other instanceof InvitePlanView)) {
			return false;
		}
		InvitePlanView that = (InvitePlanView) other;
		return joinFromHere == that.joinFromHere
			&& Objects.equals(reasonKey, that.reasonKey);
	}

	@Override
	public int hashCode() {
		int hash = Boolean.hashCode(joinFromHere);
		hash = 31 * hash + Objects.hashCode(reasonKey);
		return hash;
	}

	@Override
	public String toString() {
		return "InvitePlanView[joinFromHere=" + joinFromHere + ", reasonKey=" + reasonKey + "]";
	}

	private static final String REASON = "pumpkin_bridge.invite.verdict.";

	public static InvitePlanView of(PlanVerdict verdict) {
		switch (verdict) {
			case READY:
				return new InvitePlanView(true, null);
			case MISSING_CONTENT:
				return new InvitePlanView(false, REASON + "missingContent");
			case VERSION_UNSUPPORTED:
				return new InvitePlanView(false, REASON + "versionUnsupported");
			case NO_INSTANCE:
				return new InvitePlanView(false, REASON + "noInstance");
			default:
				throw new IncompatibleClassChangeError();
		}
	}
}
