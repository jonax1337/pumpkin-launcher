//! Was die Vorgänge der Mod bewirken (INGAME 5.4), soweit es sie heute schon gibt: Welt teilen und Freunde einladen,
//! Gäste rauswerfen, Teilen beenden. Alle anderen Vorgänge beantwortet der Launcher mit `unsupportedOp`.
use std::sync::{Arc, Weak};

use futures::future::BoxFuture;
use tokio::sync::oneshot;

use super::{Shared, CONFIRM_WAIT};
use crate::error::AppError;
use crate::services::friends::contract::{ModConfirmEvent, ModConfirmFriend, MAX_GUESTS};
use crate::services::friends::session_events::SessionEvent;
use crate::services::friends::sessions::{shown_name, FriendSessions};
use crate::services::lock;
use crate::services::modbridge::ops::{ErrorCode, Op, OpError, OpOutcome, OpResult, RateClass, Scope};
use crate::services::modbridge::{OpContext, OpHandler};
use crate::services::p2p::PeerId;

/// Der Bearbeiter der Brücke für die Freunde-Funktion. Hält sie nur schwach, damit die Brücke sie nicht am Leben hält.
pub(super) struct ModOps(Weak<Shared>);

impl ModOps {
    pub(super) fn new(shared: Weak<Shared>) -> Self {
        Self(shared)
    }
}

impl OpHandler for ModOps {
    fn handle<'a>(&'a self, ctx: OpContext, op: Op) -> BoxFuture<'a, OpOutcome> {
        Box::pin(async move {
            let shared = self.0.upgrade().ok_or_else(|| OpError::new(ErrorCode::Internal))?;
            execute(&shared, &ctx, op).await
        })
    }
}

async fn execute(shared: &Arc<Shared>, ctx: &OpContext, op: Op) -> OpOutcome {
    let sessions = FriendSessions { shared: shared.clone() };
    match op {
        Op::HostInvite { friends, show_world } => host_invite(&sessions, ctx, friends, show_world).await,
        Op::HostKick { friend } => host_kick(&sessions, ctx.instance_id(), &friend).await,
        Op::HostStop {} => {
            sessions.host_stop_for_instance(ctx.instance_id());
            Ok(OpResult::empty())
        }
        _ => Err(OpError::new(ErrorCode::UnsupportedOp)),
    }
}

async fn host_kick(sessions: &FriendSessions, instance_id: &str, friend_id: &str) -> OpOutcome {
    let Some(session_id) = sessions.shared.hosting.session_of(instance_id) else { return Ok(OpResult::empty()) };
    sessions.host_kick(&session_id, friend_id).await.map(|_| OpResult::empty()).map_err(mod_error)
}

/// Teilen aus dem Spiel (SPEC 7.4): nur mit verbundenen, bestätigten Freunden, beim ersten Mal je Start nach
/// Zustimmung im Launcher, danach höchstens dreimal je Minute.
async fn host_invite(sessions: &FriendSessions, ctx: &OpContext, friends: Vec<String>, show_world: bool) -> OpOutcome {
    let shared = &sessions.shared;
    let instance_id = ctx.instance_id();
    shared.ensure_enabled().map_err(mod_error)?;
    if !(1..=MAX_GUESTS).contains(&friends.len()) {
        return Err(OpError::new(ErrorCode::BadRequest));
    }
    let asked_about = online_friends(shared, &friends).await?;
    if shared.hosting.session_of(instance_id).is_none() {
        sessions.ensure_hostable(instance_id).await.map_err(mod_error)?;
    }
    ctx.require_scope(Scope::Share, ask_user(shared, instance_id, asked_about)).await?;
    ctx.charge(RateClass::HostInvite)?;
    let session_id = match shared.hosting.session_of(instance_id) {
        Some(session_id) => session_id,
        None => sessions.host_start(instance_id, None, show_world).await.map_err(mod_error)?.id,
    };
    sessions.host_invite(&session_id, friends).await.map(|_| OpResult::empty()).map_err(mod_error)
}

/// Die genannten Freunde für die Rückfrage; jeder muss bestätigt und verbunden sein.
async fn online_friends(shared: &Shared, friend_ids: &[String]) -> Result<Vec<ModConfirmFriend>, OpError> {
    let friends = shared.friends.list().await.map_err(mod_error)?;
    friend_ids
        .iter()
        .map(|id| {
            let friend = friends.iter().find(|friend| friend.id == *id && friend.confirmed);
            let connected = friend.filter(|friend| is_connected(shared, &friend.id));
            let friend = connected.ok_or_else(|| OpError::new(ErrorCode::PeerOffline))?;
            Ok(ModConfirmFriend { friend_id: friend.id.clone(), display_name: shown_name(friend) })
        })
        .collect()
}

fn is_connected(shared: &Shared, friend_id: &str) -> bool {
    friend_id.parse::<PeerId>().is_ok_and(|peer| shared.friends.connection(&peer).is_some())
}

/// Fragt im Launcher nach (`friends-mod-confirm`); `true`, wenn der Nutzer erlaubt. Die Brücke merkt sich das Erlauben
/// für den Rest des Spielstarts und hat der Mod `pending` gemeldet.
async fn ask_user(shared: &Shared, instance_id: &str, friends: Vec<ModConfirmFriend>) -> bool {
    let (request_id, answered) = shared.mods.ask(instance_id);
    let instance_name = shared.instances.get(instance_id).map(|instance| instance.name).unwrap_or_default();
    let request = ModConfirmEvent { request_id: request_id.clone(), instance_id: instance_id.to_owned(), instance_name, friends };
    shared.emit(SessionEvent::ModConfirm(request));
    let allowed = answer_within(answered, CONFIRM_WAIT).await;
    lock(&shared.mods.pending).remove(&request_id);
    allowed
}

/// Keine Antwort in der Zeit oder eine verworfene Rückfrage zählt als Ablehnung.
async fn answer_within(answered: oneshot::Receiver<bool>, wait: std::time::Duration) -> bool {
    matches!(tokio::time::timeout(wait, answered).await, Ok(Ok(true)))
}

/// Fehler des Launchers als Code samt Parametern, den die Mod kennt (INGAME 5.3).
pub(super) fn mod_error(err: AppError) -> OpError {
    let wire = serde_json::to_value(&err).unwrap_or_default();
    let param = |name: &str| wire["params"][name].clone();
    match wire["key"].as_str().unwrap_or_default() {
        "errors.friends.disabled" | "errors.friends.unavailable" | "errors.friends.identityLost" => OpError::new(ErrorCode::NotEnabled),
        "errors.friends.peerOffline" => OpError::new(ErrorCode::PeerOffline),
        "errors.friends.guestLimit" => OpError::new(ErrorCode::GuestLimit).with_param("max", MAX_GUESTS),
        "errors.friends.lanPortUnknown" | "errors.friends.lanUnreachable" => OpError::new(ErrorCode::LanPortUnknown),
        "errors.friends.portNotGame" => OpError::new(ErrorCode::PortNotGame),
        "errors.friends.versionUnsupported" => OpError::new(ErrorCode::VersionUnsupported).with_param("min", param("min")),
        "errors.friends.msAccountRequired" => OpError::new(ErrorCode::MsAccountRequired),
        "errors.friends.notFound.friend" => OpError::new(ErrorCode::UnknownFriend),
        // Das Spiel läuft (die Mod ist darin), der Launcher hat seinen Start nur noch nicht verarbeitet.
        "errors.friends.sessionActive" | "errors.friends.gameNotRunning" => OpError::new(ErrorCode::Busy),
        _ => OpError::new(ErrorCode::Internal),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::coded;
    use crate::services::friends::test_support::error_key;

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
    fn launcher_errors_become_mod_error_codes() {
        let cases = [
            (AppError::invalid(coded!("errors.friends.disabled")), ErrorCode::NotEnabled),
            (AppError::invalid(coded!("errors.friends.peerOffline", name = "Bert")), ErrorCode::PeerOffline),
            (AppError::invalid(coded!("errors.friends.guestLimit", max = 7)), ErrorCode::GuestLimit),
            (AppError::invalid(coded!("errors.friends.lanPortUnknown")), ErrorCode::LanPortUnknown),
            (AppError::invalid(coded!("errors.friends.lanUnreachable")), ErrorCode::LanPortUnknown),
            (AppError::invalid(coded!("errors.friends.portNotGame", port = 1)), ErrorCode::PortNotGame),
            (AppError::invalid(coded!("errors.friends.versionUnsupported", min = "1.20")), ErrorCode::VersionUnsupported),
            (AppError::invalid(coded!("errors.friends.msAccountRequired")), ErrorCode::MsAccountRequired),
            (AppError::invalid(coded!("errors.friends.sessionActive")), ErrorCode::Busy),
            (AppError::invalid(coded!("errors.friends.gameNotRunning")), ErrorCode::Busy),
            (AppError::NotFound(coded!("errors.friends.notFound.friend", id = "x").into()), ErrorCode::UnknownFriend),
            (AppError::Cancelled, ErrorCode::Internal),
        ];

        for (err, code) in cases {
            let key = error_key(&err);
            assert_eq!(mod_error(err).code, code, "{key}");
        }
    }

    #[test]
    fn errors_with_a_number_or_a_version_carry_it_as_a_param() {
        let limit = mod_error(AppError::invalid(coded!("errors.friends.guestLimit", max = 7)));
        let version = mod_error(AppError::invalid(coded!("errors.friends.versionUnsupported", min = "1.20")));

        assert_eq!(limit.params["max"], 7);
        assert_eq!(version.params["min"], "1.20");
    }

    #[test]
    fn the_wait_for_the_dialog_stays_below_the_deadline_of_the_bridge() {
        use crate::services::modbridge::limits::REQUEST_DEADLINE;
        assert!(CONFIRM_WAIT < REQUEST_DEADLINE);
    }
}
