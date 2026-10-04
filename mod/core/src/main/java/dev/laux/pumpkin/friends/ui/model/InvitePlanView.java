package dev.laux.pumpkin.friends.ui.model;

import dev.laux.pumpkin.friends.request.Results.PlanVerdict;

/**
 * What the InviteScreen does with a plan verdict (INGAME 6.2 "Einladungen"): only {@code ready} is joined from the
 * running game; every other verdict is the launcher's to solve, so the screen shows the reason and offers
 * "Im Launcher öffnen" alone ("Passende Instanz starten" runs there; the direct joinLaunch flow is later polish).
 *
 * @param reasonKey the language key of the verdict's text, {@code null} when the invite can be joined
 */
public record InvitePlanView(boolean joinFromHere, String reasonKey) {
	private static final String REASON = "pumpkin_friends.invite.verdict.";

	public static InvitePlanView of(PlanVerdict verdict) {
		return switch (verdict) {
			case READY -> new InvitePlanView(true, null);
			case MISSING_CONTENT -> new InvitePlanView(false, REASON + "missingContent");
			case VERSION_UNSUPPORTED -> new InvitePlanView(false, REASON + "versionUnsupported");
			case NO_INSTANCE -> new InvitePlanView(false, REASON + "noInstance");
		};
	}
}
