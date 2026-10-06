package dev.laux.pumpkin.bridge.modules.friends.protocol;

import java.util.Objects;
import dev.laux.pumpkin.bridge.runtime.Immutable;

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
	public static final class InvitePlan {
		private final PlanVerdict verdict;
		private final int missing;
		private final int extra;
		private final List<PlanAlternative> alternatives;

		public InvitePlan(PlanVerdict verdict, int missing, int extra, List<PlanAlternative> alternatives) {
			alternatives = Immutable.copyList(alternatives);
			this.verdict = verdict;
			this.missing = missing;
			this.extra = extra;
			this.alternatives = alternatives;
		}

		public PlanVerdict verdict() {
			return verdict;
		}

		public int missing() {
			return missing;
		}

		public int extra() {
			return extra;
		}

		public List<PlanAlternative> alternatives() {
			return alternatives;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof InvitePlan)) {
				return false;
			}
			InvitePlan that = (InvitePlan) other;
			return Objects.equals(verdict, that.verdict)
				&& missing == that.missing
				&& extra == that.extra
				&& Objects.equals(alternatives, that.alternatives);
		}

		@Override
		public int hashCode() {
			int hash = Objects.hashCode(verdict);
			hash = 31 * hash + Integer.hashCode(missing);
			hash = 31 * hash + Integer.hashCode(extra);
			hash = 31 * hash + Objects.hashCode(alternatives);
			return hash;
		}

		@Override
		public String toString() {
			return "InvitePlan[verdict=" + verdict + ", missing=" + missing + ", extra=" + extra + ", alternatives=" + alternatives + "]";
		}


		static InvitePlan read(JsonFields fields) {
			return new InvitePlan(fields.enumValue("verdict", PlanVerdict.class), fields.integer("missing"),
				fields.integer("extra"), fields.objects("alternatives").stream().map(PlanAlternative::read).collect(Immutable.toList()));
		}
	}

	public static final class PlanAlternative {
		private final String name;
		private final boolean matches;

		public PlanAlternative(String name, boolean matches) {
			this.name = name;
			this.matches = matches;
		}

		public String name() {
			return name;
		}

		public boolean matches() {
			return matches;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof PlanAlternative)) {
				return false;
			}
			PlanAlternative that = (PlanAlternative) other;
			return Objects.equals(name, that.name)
				&& matches == that.matches;
		}

		@Override
		public int hashCode() {
			int hash = Objects.hashCode(name);
			hash = 31 * hash + Boolean.hashCode(matches);
			return hash;
		}

		@Override
		public String toString() {
			return "PlanAlternative[name=" + name + ", matches=" + matches + "]";
		}

		static PlanAlternative read(JsonFields fields) {
			return new PlanAlternative(Sanitize.name(fields.string("name")), fields.bool("matches"));
		}
	}

	/** Where the running game connects to join an invite ({@code invite.joinHere}): a loopback address. */
	public static final class JoinHere {
		private final String host;
		private final int port;

		public JoinHere(String host, int port) {
			this.host = host;
			this.port = port;
		}

		public String host() {
			return host;
		}

		public int port() {
			return port;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof JoinHere)) {
				return false;
			}
			JoinHere that = (JoinHere) other;
			return Objects.equals(host, that.host)
				&& port == that.port;
		}

		@Override
		public int hashCode() {
			int hash = Objects.hashCode(host);
			hash = 31 * hash + Integer.hashCode(port);
			return hash;
		}

		@Override
		public String toString() {
			return "JoinHere[host=" + host + ", port=" + port + "]";
		}

		static JoinHere read(JsonFields fields) {
			return new JoinHere(fields.string("host"), fields.integer("port"));
		}
	}

	/** The one place the whole friend code is shown ({@code code.create}). */
	public static final class CodeCreated {
		private final String id;
		private final String code;

		public CodeCreated(String id, String code) {
			this.id = id;
			this.code = code;
		}

		public String id() {
			return id;
		}

		public String code() {
			return code;
		}

		@Override
		public boolean equals(Object other) {
			if (this == other) {
				return true;
			}
			if (!(other instanceof CodeCreated)) {
				return false;
			}
			CodeCreated that = (CodeCreated) other;
			return Objects.equals(id, that.id)
				&& Objects.equals(code, that.code);
		}

		@Override
		public int hashCode() {
			int hash = Objects.hashCode(id);
			hash = 31 * hash + Objects.hashCode(code);
			return hash;
		}

		@Override
		public String toString() {
			return "CodeCreated[id=" + id + ", code=" + code + "]";
		}

		static CodeCreated read(JsonFields fields) {
			return new CodeCreated(fields.string("id"), fields.string("code"));
		}
	}
}
