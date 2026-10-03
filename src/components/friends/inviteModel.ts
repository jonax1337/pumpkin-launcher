// Reine Logik des Einladungsdialogs (kein React), damit inviteModel.check.mjs sie ohne Bundler prüft.
import type { ActiveAccount } from "../../store/settings.ts";
import type { InstanceCandidate, JoinPlan } from "../../lib/friends-types.ts";

/** Was der Hauptknopf des Dialogs tut; `none`, wenn der Nutzer erst selbst etwas ändern muss (Mods, Version). */
export type InviteAction = "join" | "createVanilla" | "none";

/**
 * Die Instanz, auf die sich der Dialog bezieht: die gewählte, sonst die beste. Das Backend sortiert die Treffer vor die übrigen
 * und danach nach den wenigsten Abweichungen (Spezifikation 5.6).
 */
export const chosenCandidate = (plan: JoinPlan, instanceId: string | null): InstanceCandidate | undefined =>
  plan.candidates.find((candidate) => candidate.instanceId === instanceId) ?? plan.candidates[0];

export function inviteAction(plan: JoinPlan, candidate: InstanceCandidate | undefined): InviteAction {
  switch (plan.verdict) {
    case "ready":
      return candidate?.matches ? "join" : "none";
    case "noInstance":
      return plan.createVanilla ? "createVanilla" : "none";
    case "missingContent":
    case "versionUnsupported":
      return "none";
  }
}

/** Beitreten braucht ein Microsoft-Konto (Spielstart mit `friendJoin`, 8.6): das Konto, mit dem die Instanz wirklich startet, entscheidet. */
export const canJoinWith = (launchAccount: ActiveAccount | null): boolean => launchAccount?.kind === "microsoft";

/** Eine Vanilla-Instanz anzulegen braucht kein Konto; Beitreten nur, wenn das Startkonto ein Microsoft-Konto ist. */
export const actionAllowed = (action: InviteAction, hasMicrosoftAccount: boolean): boolean =>
  action === "createVanilla" || (action === "join" && hasMicrosoftAccount);

/** Der Offline-Hinweis erscheint nur, wenn ein Beitritt sonst möglich wäre. */
export const needsMicrosoftAccount = (action: InviteAction, hasMicrosoftAccount: boolean): boolean => action === "join" && !hasMicrosoftAccount;
