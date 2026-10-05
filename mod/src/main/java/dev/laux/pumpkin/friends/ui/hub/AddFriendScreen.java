package dev.laux.pumpkin.friends.ui.hub;

import dev.laux.pumpkin.friends.bridge.BridgeClient;
import dev.laux.pumpkin.friends.compat.GameScreens;
import dev.laux.pumpkin.friends.compat.Text;
import dev.laux.pumpkin.friends.compat.Toasts;
import dev.laux.pumpkin.friends.compat.Widgets;
import dev.laux.pumpkin.friends.request.Ops;
import dev.laux.pumpkin.friends.request.Reply;
import dev.laux.pumpkin.friends.request.Request;
import dev.laux.pumpkin.friends.state.Me;
import dev.laux.pumpkin.friends.ui.kit.PumpkinScreen;
import dev.laux.pumpkin.friends.ui.kit.Row;
import dev.laux.pumpkin.friends.ui.model.Fit;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;

/**
 * "Freund hinzufügen" with the single R-A tab "Per Name" (INGAME 6.2, BYNAME 9.7): one field for a Minecraft name, the
 * launcher's hint sentence under it, the directory line the launcher would show, and the answer inline — a hint for a
 * name that is not findable, an error with "⚠" for everything else. The send runs {@code friend.addByName}; while the
 * launcher asks for consent the {@link LauncherWaitScreen} covers this screen. Text, focus and scroll survive a rebuild
 * (INGAME 6.5). Enter submits from the name field; a focused send button keeps its own vanilla Enter.
 */
public final class AddFriendScreen extends PumpkinScreen {
	private static final int FIELD_WIDTH = 120;
	private static final int SEND_WIDTH = 110;
	private static final int OPEN_WIDTH = 130;

	private final BridgeClient client;
	private final AddFriendForm form = new AddFriendForm();
	private Optional<AddFriendFailure> failure = Optional.empty();
	private Me.Directory shownDirectory;

	public AddFriendScreen(Screen parent, BridgeClient client) {
		super("pumpkin_friends.add.title", parent);
		this.client = client;
		shownDirectory = client.topics().me().map(Me::directory).orElse(null);
	}

	@Override
	protected List<String> tabLabels() {
		return List.of(Text.translate("pumpkin_friends.add.tab.name"));
	}

	@Override
	protected List<Row> rows(int tab) {
		List<Row> rows = new ArrayList<>();
		addDirectoryNotice(rows);
		EditBox name = Widgets.editBox(Text.translate("pumpkin_friends.add.field.hint"), FIELD_WIDTH,
			AddFriendForm.NAME_MAX_LENGTH);
		name.setResponder(form::edit);
		rows.add(Row.fullWidth("add.name", name));
		Fit.wrap(Text.translate("pumpkin_friends.add.hint"), wrappedTextWidth(), Text::width)
			.forEach(line -> rows.add(Row.muted(line)));
		failure.ifPresent(line -> rows.add(failureRow(line)));
		rows.add(Row.fullWidth("add.send",
			Widgets.button(Text.translate("pumpkin_friends.add.send"), SEND_WIDTH, this::send)));
		return rows;
	}

	@Override
	protected void onTick() {
		super.onTick();
		Me.Directory directory = client.topics().me().map(Me::directory).orElse(null);
		if (!Objects.equals(directory, shownDirectory)) {
			shownDirectory = directory;
			rebuildWidgets();
		}
	}

	/** INGAME 6.2: Enter in the name field sends the request; anything else focused leaves the key to vanilla. */
	@Override
	protected boolean onEnter() {
		boolean inNameField = focusedWidget().filter(EditBox.class::isInstance).isPresent();
		if (!inNameField) {
			return false;
		}
		send();
		return true;
	}

	private void addDirectoryNotice(List<Row> rows) {
		DirectoryNotice notice = Optional.ofNullable(shownDirectory).map(DirectoryNotice::of).orElse(DirectoryNotice.NONE);
		if (notice.key().isEmpty()) {
			return;
		}
		Fit.wrap(Text.translate(notice.key()), wrappedTextWidth(), Text::width).forEach(line -> rows.add(Row.muted(line)));
		if (notice.offersLauncherOpen()) {
			rows.add(Row.fullWidth("add.openLauncher", Widgets.button(Text.translate("pumpkin_friends.open_launcher"),
				OPEN_WIDTH, () -> client.request(Ops.launcherOpen(Ops.OpenTarget.FRIENDS)))));
		}
	}

	private static Row failureRow(AddFriendFailure line) {
		String text = Text.translate(line.key(), line.arguments().toArray());
		return line.hint() ? Row.muted(text) : Row.text("⚠ " + text);
	}

	private void send() {
		Optional<String> name = form.nameToSend();
		if (name.isEmpty() || !AddFriendForm.isMcName(name.get())) {
			failure = Optional.of(new AddFriendFailure("pumpkin_friends.add.error.nameInvalid", List.of(), false));
			rebuildWidgets();
			return;
		}
		Request<?> request = client.request(Ops.friendAddByName(name.get()));
		LauncherWait wait = LauncherWait.of(request);
		wait.whenLauncherAsks(() -> GameScreens.show(new LauncherWaitScreen(this, wait)));
		request.reply().thenAccept(reply -> answered(name.get(), reply));
	}

	private void answered(String name, Reply<?> reply) {
		if (reply.error().isPresent()) {
			failure = Optional.of(AddFriendFailure.of(reply.error().orElseThrow(), name));
			rebuildWidgets();
			return;
		}
		Toasts.showSystem(Text.translate("pumpkin_friends.add.sent", name));
		onClose();
	}
}
