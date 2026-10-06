//! Was die Vorgänge der Mod bewirken (docs/bridge/README.md, "Operations and consent"): hier steht die Einteilung, jeder Vorgang hat seine eigene Funktion.
//! Freunde, Anfragen, Codes und Sperren liegen in `social`, Einladungen und Beitreten in `join`, das Teilen der Welt und
//! `launcher.open` hier. Es gibt keinen Vorgang, den der Launcher mit `unsupportedOp` beantwortet.
use std::sync::{Arc, Weak};

use futures::future::BoxFuture;

use super::consent::{consented, Consent};
use super::errors::mod_error;
use super::{join, social, Shared};
use crate::services::friends::contract::{ModConfirmFriend, ModOpenEvent, MAX_GUESTS};
use crate::services::friends::sessions::{shown_name, FriendSessions};
use crate::services::modbridge::ops::{
    ErrorCode, Op, OpError, OpOutcome, OpResult, OpenTarget, RateClass,
};
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
            let shared = self
                .0
                .upgrade()
                .ok_or_else(|| OpError::new(ErrorCode::Internal))?;
            if matches!(op, Op::StateSync {} | Op::LauncherOpen { .. }) {
                return execute(&shared, &ctx, op).await;
            }
            shared.ensure_enabled().map_err(mod_error)?;
            if !ctx.friends_enabled() {
                return Err(OpError::new(ErrorCode::NotEnabled));
            }
            tokio::select! {
                biased;
                () = ctx.friends_disabled() => Err(OpError::new(ErrorCode::NotEnabled)),
                outcome = execute(&shared, &ctx, op) => outcome,
            }
        })
    }
}

async fn execute(shared: &Arc<Shared>, ctx: &OpContext, op: Op) -> OpOutcome {
    let sessions = &FriendSessions {
        shared: shared.clone(),
    };
    match op {
        // Die Brücke schickt die Themen selbst noch einmal und beantwortet den Vorgang, bevor er hierher kommt.
        Op::StateSync {} => Ok(OpResult::empty()),
        Op::LauncherOpen { target } => launcher_open(sessions, ctx, target),
        Op::RequestAnswer { id, accept } => {
            social::request_answer(sessions, ctx, &id, accept).await
        }
        Op::RequestCancel { id } => social::request_cancel(sessions, &id).await,
        Op::FriendAddByName { name } => social::friend_add_by_name(sessions, ctx, &name).await,
        Op::InviteDecline { id } => join::invite_decline(sessions, &id).await,
        Op::InvitePlan { id } => join::invite_plan(sessions, ctx, &id).await,
        Op::InviteJoinHere { id } => join::invite_join_here(sessions, ctx, &id).await,
        Op::JoinLeave {} => join::join_leave(sessions, ctx),
        Op::JoinFailed {} => join::join_failed(sessions, ctx),
        Op::HostInvite {
            friends,
            show_world,
        } => host_invite(sessions, ctx, friends, show_world).await,
        Op::HostKick { friend } => host_kick(sessions, ctx.instance_id(), &friend).await,
        Op::HostStop {} => host_stop(sessions, ctx.instance_id()),
        Op::FriendAddByCode { code } => social::friend_add_by_code(sessions, ctx, &code).await,
        Op::CodeCreate {} => social::code_create(sessions, ctx).await,
        Op::CodeRevoke { id } => social::code_revoke(sessions, ctx, &id).await,
        Op::FriendRename { friend, alias } => {
            social::friend_rename(sessions, ctx, &friend, alias).await
        }
        Op::FriendRemove { friend } => social::friend_remove(sessions, ctx, &friend).await,
        Op::FriendBlock { friend } => social::friend_block(sessions, ctx, &friend).await,
        Op::BlockedUnblock { id } => social::blocked_unblock(sessions, ctx, &id).await,
        Op::FriendAcknowledge { id } => social::friend_acknowledge(sessions, ctx, &id).await,
        Op::FriendsRetry {} => social::friends_retry(sessions).await,
    }
}

/// Holt das Fenster des Launchers nach vorn und zeigt `target`, aber nie, solange ein Dialog auf den Nutzer wartet: ein
/// Fenster, das während einer Rückfrage aufspringt, lädt zum Fehlklick ein (docs/bridge/README.md, "Operations and consent").
fn launcher_open(sessions: &FriendSessions, ctx: &OpContext, target: OpenTarget) -> OpOutcome {
    let mods = &sessions.shared.mods;
    if mods.has_open_question() {
        return Err(OpError::new(ErrorCode::Busy));
    }
    mods.open_launcher(ModOpenEvent {
        instance_id: ctx.instance_id().to_owned(),
        target,
    });
    Ok(OpResult::empty())
}

fn host_stop(sessions: &FriendSessions, instance_id: &str) -> OpOutcome {
    sessions.host_stop_for_instance(instance_id);
    Ok(OpResult::empty())
}

async fn host_kick(sessions: &FriendSessions, instance_id: &str, friend_id: &str) -> OpOutcome {
    let Some(session_id) = sessions.shared.hosting.session_of(instance_id) else {
        return Ok(OpResult::empty());
    };
    sessions
        .host_kick(&session_id, friend_id)
        .await
        .map(|_| OpResult::empty())
        .map_err(mod_error)
}

/// Teilen aus dem Spiel (SPEC 7.4): nur mit verbundenen, bestätigten Freunden, beim ersten Mal je Start nach
/// Zustimmung im Launcher, danach höchstens dreimal je Minute.
async fn host_invite(
    sessions: &FriendSessions,
    ctx: &OpContext,
    friends: Vec<String>,
    show_world: bool,
) -> OpOutcome {
    let shared = &sessions.shared;
    let instance_id = ctx.instance_id();
    shared.ensure_enabled().map_err(mod_error)?;
    if !(1..=MAX_GUESTS).contains(&friends.len()) {
        return Err(OpError::new(ErrorCode::BadRequest).with_param("reason", "guestCount"));
    }
    let asked_about = online_friends(shared, &friends).await?;
    if shared.hosting.session_of(instance_id).is_none() {
        sessions
            .ensure_hostable(instance_id)
            .await
            .map_err(mod_error)?;
    }
    consented(
        shared,
        ctx,
        Consent::share("host.invite", asked_about),
        share_with(sessions, ctx, friends, show_world),
    )
    .await
}

/// Zählt den Versuch erst jetzt, nach der Zustimmung: abgelehnte oder an Vorbedingungen gescheiterte Versuche kosten kein
/// Kontingent.
async fn share_with(
    sessions: &FriendSessions,
    ctx: &OpContext,
    friends: Vec<String>,
    show_world: bool,
) -> OpOutcome {
    ctx.charge(RateClass::HostInvite)?;
    let instance_id = ctx.instance_id();
    let session_id = match sessions.shared.hosting.session_of(instance_id) {
        Some(session_id) => session_id,
        None => {
            sessions
                .host_start(instance_id, None, show_world)
                .await
                .map_err(mod_error)?
                .id
        }
    };
    sessions
        .host_invite(&session_id, friends)
        .await
        .map(|_| OpResult::empty())
        .map_err(mod_error)
}

/// Die genannten Freunde für die Rückfrage; jeder muss bestätigt und verbunden sein.
async fn online_friends(
    shared: &Shared,
    friend_ids: &[String],
) -> Result<Vec<ModConfirmFriend>, OpError> {
    let friends = shared.friends.list().await.map_err(mod_error)?;
    friend_ids
        .iter()
        .map(|id| {
            let friend = friends
                .iter()
                .find(|friend| friend.id == *id && friend.confirmed);
            let connected = friend.filter(|friend| is_connected(shared, &friend.id));
            let friend = connected.ok_or_else(|| OpError::new(ErrorCode::PeerOffline))?;
            Ok(ModConfirmFriend {
                friend_id: friend.id.clone(),
                display_name: shown_name(friend),
            })
        })
        .collect()
}

fn is_connected(shared: &Shared, friend_id: &str) -> bool {
    friend_id
        .parse::<PeerId>()
        .is_ok_and(|peer| shared.friends.connection(&peer).is_some())
}
