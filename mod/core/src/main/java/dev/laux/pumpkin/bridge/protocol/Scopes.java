package dev.laux.pumpkin.bridge.protocol;

import java.util.Objects;

/** What the launcher grants in advance, as announced in {@code welcome}. */
public final class Scopes {
	private final ScopeState share;
	private final ScopeState social;

	public Scopes(ScopeState share, ScopeState social) {
		this.share = share;
		this.social = social;
	}

	public ScopeState share() {
		return share;
	}

	public ScopeState social() {
		return social;
	}

	@Override
	public boolean equals(Object other) {
		if (this == other) {
			return true;
		}
		if (!(other instanceof Scopes)) {
			return false;
		}
		Scopes that = (Scopes) other;
		return Objects.equals(share, that.share)
			&& Objects.equals(social, that.social);
	}

	@Override
	public int hashCode() {
		int hash = Objects.hashCode(share);
		hash = 31 * hash + Objects.hashCode(social);
		return hash;
	}

	@Override
	public String toString() {
		return "Scopes[share=" + share + ", social=" + social + "]";
	}
}
