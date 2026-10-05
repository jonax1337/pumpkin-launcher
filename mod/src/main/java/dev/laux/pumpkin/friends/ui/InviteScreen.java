package dev.laux.pumpkin.friends.ui;

import dev.laux.pumpkin.friends.bridge.BridgeClient;
import dev.laux.pumpkin.friends.compat.MinecraftMainThread;
import dev.laux.pumpkin.friends.compat.Text;
import dev.laux.pumpkin.friends.compat.Toasts;
import dev.laux.pumpkin.friends.compat.Widgets;
import dev.laux.pumpkin.friends.request.Ops;
import dev.laux.pumpkin.friends.request.Reply;
import dev.laux.pumpkin.friends.request.Reply.Success;
import dev.laux.pumpkin.friends.request.Results.InvitePlan;
import dev.laux.pumpkin.friends.request.Results.PlanAlternative;
import dev.laux.pumpkin.friends.state.Invite;
import dev.laux.pumpkin.friends.ui.hub.JoinHereRunner;
import dev.laux.pumpkin.friends.ui.kit.PumpkinScreen;
import dev.laux.pumpkin.friends.ui.kit.Row;
import dev.laux.pumpkin.friends.ui.model.InvitePlanView;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;
import net.minecraft.client.gui.screens.Screen;

/**
 * One invite, examined (INGAME 6.2 "Einladungen"): the screen asks {@code invite.plan} once and shows the verdict. Only
 * {@code ready} offers [Beitreten] (the join flow of INGAME 7); every other verdict shows the launcher's reason and
 * [Im Launcher öffnen], because starting a matching instance is the launcher's to do. A failed or unanswered plan shows
 * the error inline (INGAME 6.2) and the same way out.
 */
public final class InviteScreen extends PumpkinScreen {
	private static final int FULL_ROW_WIDTH = 130;
	/** INGAME 6.2: inline errors carry the warning sign. */
	private static final String WARNING = "⚠";

	private final BridgeClient client;
	private final Invite invite;
	private Optional<InvitePlan> plan = Optional.empty();
	private boolean failed;
	private boolean askedForPlan;

	public InviteScreen(Screen parent, BridgeClient client, Invite invite) {
		super("pumpkin_friends.invite.title", parent, invite.fromName());
		this.client = client;
		this.invite = invite;
	}

	@Override
	protected List<Row> rows(int tab) {
		if (plan.isEmpty() && !failed) {
			askForPlanOnce();
			return List.of(Row.text(Text.translate("pumpkin_friends.invite.checking", invite.title())));
		}
		return plan.map(this::planRows).orElseGet(this::failedRows);
	}

	private List<Row> planRows(InvitePlan answer) {
		InvitePlanView view = InvitePlanView.of(answer.verdict());
		if (view.joinFromHere()) {
			return List.of(Row.text(Text.translate("pumpkin_friends.invite.verdict.ready")), joinRow());
		}
		List<Row> rows = new ArrayList<>();
		rows.add(Row.text(Text.translate(view.reasonKey())));
		addCountsAndAlternatives(rows, answer);
		rows.add(openLauncherRow());
		return rows;
	}

	private Row joinRow() {
		return Row.fullWidth("invite.join", Widgets.button(Text.translate("pumpkin_friends.invite.join"),
			FULL_ROW_WIDTH, () -> JoinHereRunner.begin(client, new MinecraftMainThread(), invite.id())));
	}

	private Row openLauncherRow() {
		return Row.fullWidth("invite.open_launcher", Widgets.button(Text.translate("pumpkin_friends.open_launcher"),
			FULL_ROW_WIDTH, () -> client.request(Ops.launcherOpen(Ops.OpenTarget.INVITES)).reply()
				.thenAccept(reply -> reply.error().ifPresent(Toasts::showError))));
	}

	private List<Row> failedRows() {
		return List.of(Row.text(WARNING + " " + Text.translate("pumpkin_friends.error.internal")), openLauncherRow());
	}

	private static void addCountsAndAlternatives(List<Row> rows, InvitePlan answer) {
		if (answer.missing() > 0) {
			rows.add(Row.text(Text.translate("pumpkin_friends.invite.missing", answer.missing())));
		}
		if (answer.extra() > 0) {
			rows.add(Row.text(Text.translate("pumpkin_friends.invite.extra", answer.extra())));
		}
		if (!answer.alternatives().isEmpty()) {
			rows.add(Row.text(Text.translate("pumpkin_friends.invite.alternatives", answer.alternatives().stream()
				.map(PlanAlternative::name).collect(Collectors.joining(", ")))));
		}
	}

	/** Asks once per screen; the answer arrives on the main thread and rebuilds the screen. */
	private void askForPlanOnce() {
		if (askedForPlan) {
			return;
		}
		askedForPlan = true;
		client.request(Ops.invitePlan(invite.id())).reply().thenAccept(this::onPlan);
	}

	private void onPlan(Reply<InvitePlan> reply) {
		reply.error().ifPresent(Toasts::showError);
		if (reply instanceof Success<InvitePlan> success) {
			plan = Optional.of(success.value());
		} else {
			failed = true;
		}
		rebuildWidgets();
	}
}
