package dev.laux.pumpkin.friends.protocol;

/** What the launcher grants in advance, as announced in {@code welcome}. */
public record Scopes(ScopeState share, ScopeState social) {
}
