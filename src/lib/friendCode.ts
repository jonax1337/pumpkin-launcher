/**
 * Freundescodes wie im Backend (`services/friends/code.rs`, Spec 4.2): `pumpkin-` und 72 Zeichen Base32 (a-z, 2-7).
 * Hier nur die Form; Version, Prüfsumme und Relay prüft das Backend und meldet `errors.friends.codeInvalid`.
 */
import { FRIENDS_LIMITS } from "./friends-types.ts";

const GROUP_SIZE = 4;
const BODY = new RegExp(`^[a-z2-7]{${FRIENDS_LIMITS.codeBodyLength}}$`);
const SEPARATORS = /[\s-]/g;

/** Der Code in Normalform (Kleinbuchstaben, ohne Leer- und Bindestriche im Rumpf) oder `null`, wenn die Form nicht stimmt. */
export function normalizeFriendCode(input: string): string | null {
  const text = input.trim().toLowerCase();
  if (!text.startsWith(FRIENDS_LIMITS.codePrefix)) return null;
  const body = text.slice(FRIENDS_LIMITS.codePrefix.length).replace(SEPARATORS, "");
  return BODY.test(body) ? FRIENDS_LIMITS.codePrefix + body : null;
}

/** Ob `input` die Form eines Freundescodes hat, auch gruppiert oder in Großbuchstaben. */
export const isFriendCodeShape = (input: string): boolean => normalizeFriendCode(input) !== null;

/** Der Rumpf eines normalisierten Codes in Vierergruppen, wie ihn die Oberfläche zeigt. */
export function friendCodeBodyGroups(code: string): string[] {
  const body = code.slice(FRIENDS_LIMITS.codePrefix.length);
  return body.match(new RegExp(`.{1,${GROUP_SIZE}}`, "g")) ?? [];
}
