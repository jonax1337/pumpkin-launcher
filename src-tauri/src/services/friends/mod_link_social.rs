//! Freunde, Anfragen, Codes und Sperren aus dem Spiel (docs/bridge/README.md, "Operations and consent", Stufen A und B). Jeder Vorgang prüft zuerst, was sich
//! ohne Nebenwirkung prüfen lässt (die Person oder Anfrage gibt es, die Eingabe ist gültig), damit der Nutzer nie
//! etwas bestätigt, das ohnehin scheitert; dann fragt `consented` nach, wenn der Bereich noch nicht erlaubt ist, und erst
//! danach geschieht etwas. Die Namen der Personen sind die, die der Launcher vor dem Vorgang zeigte.
use super::consent::{consented, Consent};
use super::errors::mod_error;
use crate::error::AppResult;
use crate::services::friends::code;
use crate::services::friends::contract::{
    Friend, FriendNotice, FriendRequest, RequestDirection, RequestState,
};
use crate::services::friends::sanitize;
use crate::services::friends::sessions::{shown_name, FriendSessions};
use crate::services::modbridge::ops::{CodeCreated, ErrorCode, OpError, OpOutcome, OpResult};
use crate::services::modbridge::OpContext;

fn done(result: AppResult<()>) -> OpOutcome {
    result.map(|()| OpResult::empty()).map_err(mod_error)
}

fn bad_request(reason: &str) -> OpError {
    OpError::new(ErrorCode::BadRequest).with_param("reason", reason)
}

/// Die Funktion ist an, sonst gibt es nichts zu fragen.
fn ensure_enabled(sessions: &FriendSessions) -> Result<(), OpError> {
    sessions.shared.ensure_enabled().map_err(mod_error)
}

// ---- Nachschlagen, ohne etwas zu ändern ----

/// Ein bestätigter Freund, den der Alias der Mod meint (die Brücke hat ihn schon in die Peer-ID übersetzt).
async fn friend_named(sessions: &FriendSessions, friend_id: &str) -> Result<Friend, OpError> {
    let friends = sessions.shared.friends.list().await.map_err(mod_error)?;
    let found = friends
        .into_iter()
        .find(|friend| friend.id == friend_id && friend.confirmed && !friend.removed_by_peer);
    found.ok_or_else(|| OpError::new(ErrorCode::UnknownFriend))
}

async fn incoming_request(
    sessions: &FriendSessions,
    request_id: &str,
) -> Result<FriendRequest, OpError> {
    let requests = sessions
        .shared
        .friends
        .requests()
        .await
        .map_err(mod_error)?;
    let waiting = |request: &FriendRequest| {
        request.direction == RequestDirection::Incoming && request.state == RequestState::Pending
    };
    let found = requests
        .into_iter()
        .find(|request| request.id == request_id && waiting(request));
    found.ok_or_else(|| OpError::new(ErrorCode::NotFound))
}

fn name_of_request(request: &FriendRequest) -> Option<String> {
    request
        .mc_name
        .clone()
        .or_else(|| request.display_name.clone())
}

/// Nur ein Hinweis „umbenannt“ darf die Mod quittieren; `identityChanged` prüft der Nutzer im Launcher (`forbidden`).
/// Ohne Hinweis gibt es nichts zu quittieren (`notFound`).
async fn ensure_renamed_notice(
    sessions: &FriendSessions,
    friend_id: &str,
) -> Result<Friend, OpError> {
    let friend = friend_named(sessions, friend_id).await?;
    match friend.notice {
        Some(FriendNotice::Renamed { .. }) => Ok(friend),
        Some(FriendNotice::IdentityChanged { .. }) => Err(OpError::new(ErrorCode::Forbidden)),
        None => Err(OpError::new(ErrorCode::NotFound).with_param("reason", "notRenamed")),
    }
}

// ---- Anfragen ----

pub(super) async fn request_answer(
    sessions: &FriendSessions,
    ctx: &OpContext,
    request_id: &str,
    accept: bool,
) -> OpOutcome {
    ensure_enabled(sessions)?;
    let request = incoming_request(sessions, request_id).await?;
    let consent = Consent::social("request.answer", name_of_request(&request));
    consented(&sessions.shared, ctx, consent, async {
        done(
            sessions
                .shared
                .friends
                .answer_request(request_id, accept)
                .await,
        )
    })
    .await
}

pub(super) async fn request_cancel(sessions: &FriendSessions, request_id: &str) -> OpOutcome {
    done(sessions.shared.friends.cancel_request(request_id).await)
}

pub(super) async fn friends_retry(sessions: &FriendSessions) -> OpOutcome {
    done(sessions.shared.friends.retry_now().await)
}

/// Eine Anfrage per Minecraft-Name. Solange ein Spiel mit der Mod verbunden ist (dieses ist es), meldet sich der Dienst
/// nur mit dem gemerkten Zertifikat am Verzeichnis an (siehe `by_name`).
pub(super) async fn friend_add_by_name(
    sessions: &FriendSessions,
    ctx: &OpContext,
    name: &str,
) -> OpOutcome {
    ensure_enabled(sessions)?;
    let name = sanitize::mc_name(Some(name.trim())).ok_or_else(|| bad_request("nameInvalid"))?;
    let consent = Consent::social("friend.addByName", Some(name.clone()));
    consented(&sessions.shared, ctx, consent, async {
        done(sessions.shared.friends.add_by_name(&name).await.map(drop))
    })
    .await
}

pub(super) async fn friend_add_by_code(
    sessions: &FriendSessions,
    ctx: &OpContext,
    code_text: &str,
) -> OpOutcome {
    ensure_enabled(sessions)?;
    code::parse(code_text).map_err(mod_error)?;
    let consent = Consent::social("friend.addByCode", None);
    consented(&sessions.shared, ctx, consent, async {
        done(sessions.shared.friends.add(code_text).await.map(drop))
    })
    .await
}

// ---- Codes ----

pub(super) async fn code_create(sessions: &FriendSessions, ctx: &OpContext) -> OpOutcome {
    ensure_enabled(sessions)?;
    let consent = Consent::social("code.create", None);
    consented(&sessions.shared, ctx, consent, async {
        let created = sessions
            .shared
            .friends
            .code_create()
            .await
            .map_err(mod_error)?;
        let code = created
            .code
            .ok_or_else(|| OpError::new(ErrorCode::Internal))?;
        Ok(OpResult::CodeCreated(CodeCreated {
            id: created.id,
            code,
        }))
    })
    .await
}

pub(super) async fn code_revoke(
    sessions: &FriendSessions,
    ctx: &OpContext,
    code_id: &str,
) -> OpOutcome {
    ensure_enabled(sessions)?;
    let codes = sessions.shared.friends.codes().await.map_err(mod_error)?;
    if !codes.iter().any(|code| code.id == code_id) {
        return Err(OpError::new(ErrorCode::NotFound));
    }
    let consent = Consent::social("code.revoke", None);
    consented(&sessions.shared, ctx, consent, async {
        done(sessions.shared.friends.code_revoke(code_id).await)
    })
    .await
}

// ---- Der Freundeskreis ----

/// `alias: None` nimmt den eigenen Spitznamen wieder weg. Die Aktivitätsliste behält den bisherigen Namen.
pub(super) async fn friend_rename(
    sessions: &FriendSessions,
    ctx: &OpContext,
    friend_id: &str,
    alias: Option<String>,
) -> OpOutcome {
    ensure_enabled(sessions)?;
    let friend = friend_named(sessions, friend_id).await?;
    let consent = Consent::social("friend.rename", Some(shown_name(&friend)));
    consented(&sessions.shared, ctx, consent, async {
        done(sessions.shared.friends.rename(friend_id, alias).await)
    })
    .await
}

pub(super) async fn friend_remove(
    sessions: &FriendSessions,
    ctx: &OpContext,
    friend_id: &str,
) -> OpOutcome {
    ensure_enabled(sessions)?;
    let friend = friend_named(sessions, friend_id).await?;
    let consent = Consent::social("friend.remove", Some(shown_name(&friend)));
    consented(&sessions.shared, ctx, consent, async {
        done(sessions.shared.friends.remove(friend_id).await)
    })
    .await
}

pub(super) async fn friend_block(
    sessions: &FriendSessions,
    ctx: &OpContext,
    friend_id: &str,
) -> OpOutcome {
    ensure_enabled(sessions)?;
    let friend = friend_named(sessions, friend_id).await?;
    let consent = Consent::social("friend.block", Some(shown_name(&friend)));
    consented(&sessions.shared, ctx, consent, async {
        done(sessions.shared.friends.block(friend_id).await)
    })
    .await
}

pub(super) async fn blocked_unblock(
    sessions: &FriendSessions,
    ctx: &OpContext,
    peer_id: &str,
) -> OpOutcome {
    ensure_enabled(sessions)?;
    let blocked = sessions.shared.friends.blocked().await.map_err(mod_error)?;
    let person = blocked
        .into_iter()
        .find(|person| person.peer_id == peer_id)
        .ok_or_else(|| OpError::new(ErrorCode::NotFound))?;
    let consent = Consent::social("blocked.unblock", Some(person.display_name));
    consented(&sessions.shared, ctx, consent, async {
        done(sessions.shared.friends.unblock(peer_id).await)
    })
    .await
}

/// Quittiert nur den Hinweis „umbenannt“. Zwischen Rückfrage und Ausführung kann der Hinweis ein anderer geworden sein,
/// deshalb wird er danach noch einmal geprüft.
pub(super) async fn friend_acknowledge(
    sessions: &FriendSessions,
    ctx: &OpContext,
    friend_id: &str,
) -> OpOutcome {
    ensure_enabled(sessions)?;
    let friend = ensure_renamed_notice(sessions, friend_id).await?;
    let consent = Consent::social("friend.acknowledge", Some(shown_name(&friend)));
    let act = async {
        ensure_renamed_notice(sessions, friend_id).await?;
        done(sessions.shared.friends.acknowledge(friend_id).await)
    };
    consented(&sessions.shared, ctx, consent, act).await
}
