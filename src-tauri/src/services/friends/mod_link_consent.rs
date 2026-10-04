//! Zustimmung und Spur eines Vorgangs aus dem Spiel (INGAME 5.5, 5.7): ein Vorgang eines Bereichs läuft erst, wenn der
//! Nutzer ihn für diesen Spielstart erlaubt hat, und jeder Ausgang kommt in die Aktivitätsliste. Die Brücke hält die
//! Zustimmungen und Zähler des Starts (`OpContext::require_scope`); hier steht, was der Nutzer gefragt wird.
use std::future::Future;
use std::time::Duration;

use tokio::sync::oneshot;

use super::{Shared, CONFIRM_WAIT};
use crate::services::friends::contract::{ModActivityEntry, ModConfirmEvent, ModConfirmFriend, ModConfirmSummary};
use crate::services::friends::sanitize;
use crate::services::friends::service::now_secs;
use crate::services::friends::session_events::SessionEvent;
use crate::services::lock;
use crate::services::modbridge::ops::{OpOutcome, Scope};
use crate::services::modbridge::OpContext;

/// Was der Vorgang aus dem Spiel ist, für die Rückfrage und für die Aktivitätsliste.
pub(super) struct Consent {
    pub scope: Scope,
    /// Der Name des Vorgangs aus INGAME 5.4.
    pub op: &'static str,
    /// Die Person, um die es geht, bereinigt und so benannt, wie der Launcher sie vor dem Vorgang zeigt.
    pub target_name: Option<String>,
    /// Nur beim Teilen: die Freunde, die eingeladen werden sollen.
    pub friends: Vec<ModConfirmFriend>,
}

impl Consent {
    pub(super) fn social(op: &'static str, target_name: Option<String>) -> Self {
        Self { scope: Scope::Social, op, target_name, friends: Vec::new() }
    }

    pub(super) fn share(op: &'static str, friends: Vec<ModConfirmFriend>) -> Self {
        let names: Vec<&str> = friends.iter().map(|friend| friend.display_name.as_str()).collect();
        let target_name = Some(sanitize::world_or_instance_name(&names.join(", "))).filter(|names| !names.is_empty());
        Self { scope: Scope::Share, op, target_name, friends }
    }
}

/// Lässt `act` erst laufen, wenn der Bereich erlaubt ist (erst gefragt, wenn nötig), und trägt den Ausgang ein.
/// `act` ist eine Zukunft, die noch nichts getan hat: bei Ablehnung wird sie nie angefasst.
pub(super) async fn consented(shared: &Shared, ctx: &OpContext, consent: Consent, act: impl Future<Output = OpOutcome>) -> OpOutcome {
    let allowed = ctx.require_scope(consent.scope, ask_user(shared, ctx.instance_id(), &consent)).await;
    let outcome = match allowed {
        Ok(()) => act.await,
        Err(refusal) => Err(refusal),
    };
    record(shared, ctx.instance_id(), &consent, outcome.is_ok());
    outcome
}

fn record(shared: &Shared, instance_id: &str, consent: &Consent, ok: bool) {
    shared.mods.record_activity(ModActivityEntry {
        at: super::activity::iso_utc(now_secs()),
        instance_id: instance_id.to_owned(),
        scope: consent.scope,
        op: consent.op.to_owned(),
        target_name: consent.target_name.clone(),
        ok,
    });
}

/// Fragt im Launcher nach (`friends-mod-confirm`); `true`, wenn der Nutzer erlaubt. Die Brücke merkt sich das Erlauben
/// für den Rest des Spielstarts und hat der Mod `pending` gemeldet.
async fn ask_user(shared: &Shared, instance_id: &str, consent: &Consent) -> bool {
    let (request_id, answered) = shared.mods.ask(instance_id);
    let instance_name = shared.instances.get(instance_id).map(|instance| instance.name).unwrap_or_default();
    shared.emit(SessionEvent::ModConfirm(ModConfirmEvent {
        request_id: request_id.clone(),
        instance_id: instance_id.to_owned(),
        instance_name,
        friends: consent.friends.clone(),
        scope: consent.scope,
        summary: ModConfirmSummary { op: consent.op.to_owned(), target_name: consent.target_name.clone() },
    }));
    let allowed = answer_within(answered, CONFIRM_WAIT).await;
    lock(&shared.mods.pending).remove(&request_id);
    allowed
}

/// Keine Antwort in der Zeit oder eine verworfene Rückfrage zählt als Ablehnung.
async fn answer_within(answered: oneshot::Receiver<bool>, wait: Duration) -> bool {
    matches!(tokio::time::timeout(wait, answered).await, Ok(Ok(true)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn no_answer_within_two_minutes_counts_as_denied() {
        let (_answer, answered) = oneshot::channel::<bool>();
        let started = tokio::time::Instant::now();

        assert!(!answer_within(answered, CONFIRM_WAIT).await);
        assert_eq!(started.elapsed(), CONFIRM_WAIT);
    }

    #[tokio::test(start_paused = true)]
    async fn only_an_explicit_allow_counts() {
        let answers = [Some(true), Some(false), None];
        let mut results = Vec::new();
        for answer in answers {
            let (sender, answered) = oneshot::channel();
            if let Some(allow) = answer {
                sender.send(allow).unwrap();
            }
            results.push(answer_within(answered, CONFIRM_WAIT).await);
        }

        assert_eq!(results, [true, false, false]);
    }

    #[test]
    fn a_share_names_its_friends_and_a_social_op_its_person() {
        let friends = ["Anna", "Bert"].map(|name| ModConfirmFriend { friend_id: format!("id-{name}"), display_name: name.into() });

        let share = Consent::share("host.invite", friends.to_vec());
        let social = Consent::social("friend.remove", Some("Cleo".into()));

        assert_eq!((share.scope, share.target_name.as_deref()), (Scope::Share, Some("Anna, Bert")));
        assert_eq!((social.scope, social.target_name.as_deref(), social.friends.len()), (Scope::Social, Some("Cleo"), 0));
    }

    #[test]
    fn a_share_of_many_long_names_stays_within_the_name_cap() {
        let friends = (0..7).map(|n| ModConfirmFriend { friend_id: n.to_string(), display_name: "x".repeat(32) }).collect();

        let share = Consent::share("host.invite", friends);

        assert_eq!(share.target_name.unwrap().chars().count(), 64);
    }
}
