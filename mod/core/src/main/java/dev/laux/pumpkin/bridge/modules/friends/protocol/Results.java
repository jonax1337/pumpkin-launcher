package dev.laux.pumpkin.bridge.modules.friends.protocol;

import dev.laux.pumpkin.bridge.protocol.json.JsonFields;
import dev.laux.pumpkin.bridge.modules.friends.state.Sanitize;
import java.util.List;

/** The results of the operations that return more than {@code {}}, read from the launcher's untrusted answer. */
public final class Results {
	private Results() {
	}

	/** Result of an operation without data. */
	public enum Done {
		DONE;

		static Done read(JsonFields ignored) {
			return DONE;
		}
	}

	public enum PlanVerdict {
		READY,
		MISSING_CONTENT,
		NO_INSTANCE,
		VERSION_UNSUPPORTED
	}

	/** How an invite fits the running game ({@code invite.plan}). */
	public record InvitePlan(PlanVerdict verdict, int missing, int extra, List<PlanAlternative> alternatives) {
		public InvitePlan {
			alternatives = List.copyOf(alternatives);
		}

		static InvitePlan read(JsonFields fields) {
			return new InvitePlan(fields.enumValue("verdict", PlanVerdict.class), fields.integer("missing"),
				fields.integer("extra"), fields.objects("alternatives").stream().map(PlanAlternative::read).toList());
		}
	}

	public record PlanAlternative(String name, boolean matches) {
		static PlanAlternative read(JsonFields fields) {
			return new PlanAlternative(Sanitize.name(fields.string("name")), fields.bool("matches"));
		}
	}

	/** Where the running game connects to join an invite ({@code invite.joinHere}): a loopback address. */
	public record JoinHere(String host, int port) {
		static JoinHere read(JsonFields fields) {
			return new JoinHere(fields.string("host"), fields.integer("port"));
		}
	}

	/** The one place the whole friend code is shown ({@code code.create}). */
	public record CodeCreated(String id, String code) {
		static CodeCreated read(JsonFields fields) {
			return new CodeCreated(fields.string("id"), fields.string("code"));
		}
	}
}
