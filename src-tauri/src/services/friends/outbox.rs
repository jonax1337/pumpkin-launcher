//! Postausgang des ausgemusterten Schlüssels (SPEC 4.6): nach „Identität erneuern“ erfährt jeder Freund die neue ID,
//! nach „Zurücksetzen“ das Ende der Freundschaft, auch wenn er erst Tage später online kommt. Ein kurzlebiger Endpunkt
//! mit dem alten Schlüssel wählt ihn an, schickt die Nachricht und wartet auf das `ack`.
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use data_encoding::HEXLOWER;
use tokio::time::{timeout, Instant};

use super::contract::FriendNotice;
use super::control::{self, ControlMessage, SessionError, ACK_WAIT, PEER_ALPN};
use super::events::FriendsEvent;
use super::identity::{self, fingerprint, Identity};
use super::limits::{Attempts, CONTROL_FRAME_LIMIT};
use super::records::{FriendRecord, OutboxKind, OutboxRecord};
use super::service::{now_secs, retired_net_config, Core, Runtime};
use super::status::{self, Target};
use crate::coded;
use crate::error::{AppError, AppResult};
use crate::services::p2p::{
    frame, Admission, BiStream, CloseCode, FrameError, Gate, PeerId, PeerNet,
};

/// Die neue Identität unterschreibt (alte ID, neue ID); so kann niemand eine fremde ID als neue ausgeben.
const ROTATE_DOMAIN: &[u8] = b"pumpkin/rotate/1";
const TICK: Duration = Duration::from_secs(1);

/// Nach „Identität erneuern“: jeder Freund bekommt die neue ID, ältere Einträge fallen weg.
pub(super) fn replace_with_rotation(core: &Core, old: &Identity, new: &Identity) -> AppResult<()> {
    let (old_id, new_id) = (own_peer_id(old)?, own_peer_id(new)?);
    let signature =
        HEXLOWER.encode(&new.sign(ROTATE_DOMAIN, &[old_id.as_bytes(), new_id.as_bytes()]));
    replace(core, |friend| OutboxRecord {
        id: friend.id.clone(),
        kind: OutboxKind::Rotated,
        new_peer_id: Some(new_id.to_string()),
        signature: Some(signature.clone()),
        until: core.request_deadline(),
    })
}

/// Nach „Zurücksetzen“: jeder Freund erfährt das Ende der Freundschaft, ältere Einträge fallen weg.
pub(super) fn replace_with_unfriend(core: &Core) -> AppResult<()> {
    replace(core, |friend| OutboxRecord {
        id: friend.id.clone(),
        kind: OutboxKind::Unfriend,
        new_peer_id: None,
        signature: None,
        until: core.request_deadline(),
    })
}

/// `identityRotated` von `old`: gilt nur mit der Unterschrift der neuen ID; dann zieht der Freund auf sie um.
pub(super) fn accept_rotation(
    core: &Core,
    old: &PeerId,
    new: &PeerId,
    signature: &[u8; 64],
) -> bool {
    let (old_id, new_id) = (old.to_string(), new.to_string());
    if !identity::verify(
        &new_id,
        ROTATE_DOMAIN,
        &[old.as_bytes(), new.as_bytes()],
        signature,
    ) {
        return false;
    }
    let Some(record) = status::friend(core, &old_id) else {
        return false;
    };
    core.patches.forget(&old_id);
    let moved = FriendRecord {
        id: new_id,
        notice: Some(FriendNotice::IdentityChanged {
            previous_fingerprint: fingerprint(&old_id),
        }),
        last_seen: Some(now_secs()),
        ..record
    };
    let stored = core
        .stores
        .friends
        .remove(&old_id)
        .and_then(|()| core.stores.friends.upsert(moved));
    if let Err(err) = stored {
        tracing::warn!(%err, "neue Identität eines Freundes nicht gespeichert");
        return false;
    }
    core.emit(FriendsEvent::Changed);
    true
}

/// Stellt den Postausgang zu, solange die Funktion aktiv ist; ist er leer, verschwindet der alte Schlüssel.
pub(super) fn spawn_delivery(core: &Arc<Core>, runtime: &Arc<Runtime>) {
    let delivery = deliver_regularly(core.clone(), runtime.clone());
    tokio::spawn(runtime.stop.clone().run_until_cancelled_owned(delivery));
}

fn replace(core: &Core, item: impl Fn(&FriendRecord) -> OutboxRecord) -> AppResult<()> {
    for old in core.stores.outbox.list() {
        core.stores.outbox.remove(&old.id)?;
    }
    for friend in status::friends(core)
        .iter()
        .filter(|friend| !friend.removed_by_peer)
    {
        core.stores.outbox.insert(item(friend))?;
    }
    Ok(())
}

fn own_peer_id(identity: &Identity) -> AppResult<PeerId> {
    PeerId::from_str(&identity.peer_id())
        .map_err(|_| AppError::invalid(coded!("errors.friends.identityLost")))
}

async fn deliver_regularly(core: Arc<Core>, runtime: Arc<Runtime>) {
    let mut attempts = Attempts::default();
    let mut retired_dropped = false;
    let mut ticks = tokio::time::interval(TICK);
    loop {
        ticks.tick().await;
        let items = core.stores.outbox.list();
        if items.is_empty() {
            if !retired_dropped {
                drop_retired_key(&core);
                retired_dropped = true;
            }
            continue;
        }
        retired_dropped = false;
        let due = attempts.due(items.into_iter().map(|item| item.id), Instant::now());
        if due.is_empty() {
            continue;
        }
        let retired = match identity::load_retired(&*core.secrets) {
            Ok(Some(retired)) => retired,
            _ => {
                tracing::warn!("ausgemusterter Schlüssel fehlt, Postausgang wartet");
                due.into_iter()
                    .for_each(|id| attempts.failed(id, Instant::now()));
                continue;
            }
        };
        for id in due {
            attempts.begin(id.clone(), Instant::now());
            if deliver_item(&core, &retired, &id).await {
                attempts.succeeded(&id);
                after_delivery(&core, &runtime, &id);
            } else {
                attempts.failed(id, Instant::now());
            }
        }
    }
}

fn drop_retired_key(core: &Core) {
    if let Err(err) = identity::delete_retired(&*core.secrets) {
        tracing::warn!(%err, "ausgemusterter Schlüssel nicht gelöscht");
    }
}

/// Der Eintrag ist erledigt; ein Freund, der unsere neue ID jetzt kennt, wird gleich angewählt.
fn after_delivery(core: &Arc<Core>, runtime: &Arc<Runtime>, friend_id: &str) {
    if let Err(err) = core.stores.outbox.remove(friend_id) {
        tracing::debug!(%err, "zugestellter Postausgang-Eintrag schon weg");
    }
    if let Ok(peer) = PeerId::from_str(friend_id) {
        runtime
            .scheduler
            .dial_now(&status::presence_plan(core, runtime), Target::Friend(peer));
    }
}

/// Ein Zustellversuch; `true`, wenn der Eintrag erledigt ist (zugestellt oder unbrauchbar).
async fn deliver_item(core: &Core, retired: &Identity, friend_id: &str) -> bool {
    let Ok(item) = core.stores.outbox.get(friend_id) else {
        return true;
    };
    let (Ok(friend), Some(message)) = (PeerId::from_str(friend_id), message(&item)) else {
        return true;
    };
    let net = match PeerNet::bind(
        retired_net_config(&core.options, retired),
        Arc::new(DialOnly),
    )
    .await
    {
        Ok(net) => net,
        Err(err) => {
            tracing::warn!(%err, "Endpunkt des alten Schlüssels nicht gebunden");
            return false;
        }
    };
    let delivered = deliver_on(&net, core, &friend, &message).await;
    net.close(CloseCode::NORMAL).await;
    if let Err(err) = &delivered {
        tracing::debug!(friend = %friend.short(), %err, "Postausgang nicht zugestellt");
    }
    delivered.is_ok()
}

async fn deliver_on(
    net: &PeerNet,
    core: &Core,
    friend: &PeerId,
    message: &ControlMessage,
) -> Result<(), SessionError> {
    let conn = net.dial(friend, PEER_ALPN).await?;
    let hello = ControlMessage::hello(core.own_profile(), None);
    let (mut stream, _, _) = control::open_control(&conn, &hello).await?;
    frame::write(&mut stream, message, CONTROL_FRAME_LIMIT).await?;
    timeout(ACK_WAIT, until_ack(&mut stream))
        .await
        .map_err(|_| SessionError::Timeout)??;
    conn.close(CloseCode::NORMAL);
    Ok(())
}

/// Liest bis zum `ack`; `hello` und `status` des Freundes kommen davor und zählen nicht.
async fn until_ack(stream: &mut BiStream) -> Result<(), FrameError> {
    loop {
        if stream
            .read_frame::<ControlMessage>(CONTROL_FRAME_LIMIT)
            .await?
            == ControlMessage::Ack
        {
            return Ok(());
        }
    }
}

fn message(item: &OutboxRecord) -> Option<ControlMessage> {
    match item.kind {
        OutboxKind::Unfriend => Some(ControlMessage::Unfriend),
        OutboxKind::Rotated => Some(ControlMessage::IdentityRotated {
            new_peer_id: item.new_peer_id.clone()?,
            signature: item.signature.clone()?,
        }),
    }
}

/// Der Endpunkt des alten Schlüssels nimmt nichts an; ohne ALPN scheitert jeder eingehende Handshake ohnehin.
struct DialOnly;

impl Gate for DialOnly {
    fn admit(&self, _peer: &PeerId, _alpn: &[u8]) -> Admission {
        Admission::Reject(CloseCode::NOT_FRIEND)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotation_signature_is_by_the_new_identity_over_old_then_new() {
        let (old, new) = (Identity::generate(), Identity::generate());
        let (old_id, new_id) = (own_peer_id(&old).unwrap(), own_peer_id(&new).unwrap());

        let signature = new.sign(ROTATE_DOMAIN, &[old_id.as_bytes(), new_id.as_bytes()]);

        let parts: [&[u8]; 2] = [old_id.as_bytes(), new_id.as_bytes()];
        assert!(identity::verify(
            &new_id.to_string(),
            ROTATE_DOMAIN,
            &parts,
            &signature
        ));
        assert!(!identity::verify(
            &old_id.to_string(),
            ROTATE_DOMAIN,
            &parts,
            &signature
        ));
    }

    #[test]
    fn rotated_item_becomes_identity_rotated_and_a_broken_one_nothing() {
        let item = OutboxRecord {
            id: "f".into(),
            kind: OutboxKind::Rotated,
            new_peer_id: Some("n".into()),
            signature: Some("s".into()),
            until: 0,
        };
        let broken = OutboxRecord {
            signature: None,
            ..item.clone()
        };

        let rotated = ControlMessage::IdentityRotated {
            new_peer_id: "n".into(),
            signature: "s".into(),
        };
        assert_eq!(message(&item), Some(rotated));
        assert_eq!(message(&broken), None);
    }
}
