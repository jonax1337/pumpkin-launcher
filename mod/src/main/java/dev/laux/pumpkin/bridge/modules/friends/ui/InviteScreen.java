package dev.laux.pumpkin.bridge.modules.friends.ui;

import dev.laux.pumpkin.bridge.runtime.Immutable;

import dev.laux.pumpkin.bridge.modules.friends.FriendsClient;
import dev.laux.pumpkin.bridge.compat.MinecraftMainThread;
import dev.laux.pumpkin.bridge.compat.Text;
import dev.laux.pumpkin.bridge.compat.Toasts;
import dev.laux.pumpkin.bridge.compat.Widgets;
import dev.laux.pumpkin.bridge.modules.friends.protocol.Ops;
import dev.laux.pumpkin.bridge.transport.request.Reply;
import dev.laux.pumpkin.bridge.transport.request.Reply.Success;
import dev.laux.pumpkin.bridge.modules.friends.protocol.Results.InvitePlan;
import dev.laux.pumpkin.bridge.modules.friends.protocol.Results.PlanAlternative;
import dev.laux.pumpkin.bridge.modules.friends.state.Invite;
import dev.laux.pumpkin.bridge.modules.friends.ui.JoinHereRunner;
import dev.laux.pumpkin.bridge.ui.kit.PumpkinScreen;
import dev.laux.pumpkin.bridge.ui.kit.Row;
import dev.laux.pumpkin.bridge.modules.friends.ui.model.InvitePlanView;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;
import net.minecraft.client.gui.screens.Screen;

/**
 * One invite, examined (docs/bridge/README.md, "In-game navigation and world behavior"): the screen asks {@code invite.plan} once and shows the verdict. Only
 * {@code ready} offers [Beitreten] (the join flow of docs/bridge/README.md, "In-game navigation and world behavior"); every other verdict shows the launcher's reason and
 * [Im Launcher öffnen], because starting a matching instance is the launcher's to do. A failed or unanswered plan shows
 * the error inline (docs/bridge/README.md, "In-game navigation and world behavior") and the same way out.
 */
public final class InviteScreen extends PumpkinScreen {
	private static final int FULL_ROW_WIDTH = 130;
	/** docs/bridge/README.md, "In-game navigation and world behavior": inline errors carry the warning sign. */
	private static final String WARNING = "⚠";

	private final FriendsClient client;
	private final Invite invite;
	private Optional<InvitePlan> plan = Optional.empty();
	private boolean failed;
	private boolean askedForPlan;

	public InviteScreen(Screen parent, FriendsClient client, Invite invite) {
		super("pumpkin_bridge.invite.title", parent, invite.fromName());
		this.client = client;
		this.invite = invite;
	}

	@Override
	protected List<Row> rows(int tab) {
		if (!plan.isPresent() && !failed) {
			askForPlanOnce();
			return Immutable.list(Row.text(Text.translate("pumpkin_bridge.invite.checking", invite.title())));
		}
		return plan.map(this::planRows).orElseGet(this::failedRows);
	}

	private List<Row> planRows(InvitePlan answer) {
		InvitePlanView view = InvitePlanView.of(answer.verdict());
		if (view.joinFromHere()) {
			return Immutable.list(Row.text(Text.translate("pumpkin_bridge.invite.verdict.ready")), joinRow());
		}
		List<Row> rows = new ArrayList<>();
		rows.add(Row.text(Text.translate(view.reasonKey())));
		addCountsAndAlternatives(rows, answer);
		rows.add(openLauncherRow());
		return rows;
	}

	private Row joinRow() {
		return Row.fullWidth("invite.join", Widgets.button(Text.translate("pumpkin_bridge.invite.join"),
			FULL_ROW_WIDTH, () -> JoinHereRunner.begin(client, new MinecraftMainThread(), invite.id())));
	}

	private Row openLauncherRow() {
		return Row.fullWidth("invite.open_launcher", Widgets.button(Text.translate("pumpkin_bridge.open_launcher"),
			FULL_ROW_WIDTH, () -> client.request(Ops.launcherOpen(Ops.OpenTarget.INVITES)).reply()
				.thenAccept(reply -> reply.error().ifPresent(Toasts::showError))));
	}

	private List<Row> failedRows() {
		return Immutable.list(Row.text(WARNING + " " + Text.translate("pumpkin_bridge.error.internal")), openLauncherRow());
	}

	private static void addCountsAndAlternatives(List<Row> rows, InvitePlan answer) {
		if (answer.missing() > 0) {
			rows.add(Row.text(Text.translate("pumpkin_bridge.invite.missing", answer.missing())));
		}
		if (answer.extra() > 0) {
			rows.add(Row.text(Text.translate("pumpkin_bridge.invite.extra", answer.extra())));
		}
		if (!answer.alternatives().isEmpty()) {
			rows.add(Row.text(Text.translate("pumpkin_bridge.invite.alternatives", answer.alternatives().stream()
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
		if (reply instanceof Success<?>) {
			Success<InvitePlan> success = (Success<InvitePlan>) reply;
			plan = Optional.of(success.value());
		} else {
			failed = true;
		}
		rebuildWidgets();
	}
}
