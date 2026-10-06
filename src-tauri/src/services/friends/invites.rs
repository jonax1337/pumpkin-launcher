//! Empfangene Einladungen (SPEC 5.4): nur von bestätigten Freunden, höchstens 10 je Freund und Stunde, eine offene je
//! Sitzung und 20 insgesamt (die älteste fällt heraus), höchstens 2 h gültig. Nur im Speicher.
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::time::Instant;

use super::contract::{
    Invite, InviteEvent, InviteRevokedEvent, RevokeReason, SessionEnd, INVITE_TTL_SECS,
};
use super::control::{SessionControl, WireInvite};
use super::identity::fingerprint;
use super::limits::{RateLimit, SlidingWindow};
use super::mod_link;
use super::service::now_secs;
use super::session_events::SessionEvent;
use super::sessions::{friends_by_id, shown_name, FriendSessions, Shared};
use crate::coded;
use crate::error::{AppError, AppResult};
use crate::services::lock;
use crate::services::modbridge::protocol::{ModInvite, ModNotify};
use crate::services::p2p::PeerId;

const INVITES_PER_FRIEND: RateLimit = RateLimit {
    max: 10,
    window: Duration::from_secs(3600),
};
const MAX_OPEN_INVITES: usize = 20;

/// Die offenen Einladungen und das Zählfenster je Gastgeber.
pub(super) struct Invites {
    open: Mutex<Vec<Received>>,
    arrivals: Mutex<SlidingWindow<PeerId>>,
}

impl Default for Invites {
    fn default() -> Self {
        Self {
            open: Mutex::default(),
            arrivals: Mutex::new(SlidingWindow::new(INVITES_PER_FRIEND)),
        }
    }
}

/// Eine Einladung mit ihrem Gastgeber, dem einzigen, der sie widerrufen darf.
#[derive(Debug, Clone)]
pub(super) struct Received {
    pub(super) host: PeerId,
    pub(super) invite: Invite,
}

impl Invites {
    /// Die noch gültigen Einladungen; abgelaufene fallen dabei heraus.
    fn current(&self, now: u64) -> Vec<Received> {
        let mut open = lock(&self.open);
        open.retain(|received| received.invite.expires_at > now);
        open.clone()
    }

    /// Die Einladung `invite_id`, wenn sie noch offen ist (SPEC 6.2).
    pub(super) fn open_invite(&self, invite_id: &str) -> AppResult<Received> {
        let found = lock(&self.open)
            .iter()
            .find(|received| received.invite.id == invite_id)
            .cloned();
        let received = found.ok_or_else(|| {
            AppError::NotFound(coded!("errors.friends.notFound.invite", id = invite_id).into())
        })?;
        if received.invite.expires_at <= now_secs() {
            self.take(invite_id);
            return Err(AppError::invalid(coded!("errors.friends.inviteExpired")));
        }
        Ok(received)
    }

    /// Höchstens 20, denn mehr nimmt [`Invites::admit`] nicht auf.
    pub(super) fn for_mod(&self) -> Vec<ModInvite> {
        self.current(now_secs())
            .iter()
            .map(|received| ModInvite {
                id: received.invite.id.clone(),
                from_name: received.invite.from_name.clone(),
                title: received.invite.title.clone(),
            })
            .collect()
    }

    pub(super) fn clear(&self) {
        lock(&self.open).clear();
    }

    fn take(&self, invite_id: &str) -> Option<Received> {
        let mut open = lock(&self.open);
        let index = open
            .iter()
            .position(|received| received.invite.id == invite_id)?;
        Some(open.remove(index))
    }

    fn take_from(&self, host: &PeerId, invite_id: &str) -> Option<Received> {
        let mut open = lock(&self.open);
        let index = open
            .iter()
            .position(|received| received.host == *host && received.invite.id == invite_id)?;
        Some(open.remove(index))
    }

    /// Nimmt eine neue Einladung auf: sie ersetzt die ältere derselben Sitzung, über 20 fällt die älteste heraus.
    /// Eine ID, die schon ein anderer Gastgeber benutzt, wird verworfen.
    fn admit(&self, received: Received) -> bool {
        let mut open = lock(&self.open);
        let id = &received.invite.id;
        if open
            .iter()
            .any(|other| other.invite.id == *id && other.host != received.host)
        {
            return false;
        }
        let replaced = |other: &Received| {
            other.invite.session_id == received.invite.session_id || other.invite.id == *id
        };
        let same_session = |other: &Received| other.host == received.host && replaced(other);
        open.retain(|other| !same_session(other));
        if open.len() >= MAX_OPEN_INVITES {
            open.remove(0);
        }
        open.push(received);
        true
    }
}

impl FriendSessions {
    pub async fn invites(&self) -> AppResult<Vec<Invite>> {
        self.shared.ensure_enabled()?;
        let open = self.shared.invites.current(now_secs()).into_iter();
        Ok(open
            .map(|received| with_host_online(&self.shared, received))
            .collect())
    }

    /// Lehnt ab: die Einladung verschwindet, der Gastgeber erfährt es mit `inviteDecline` (SPEC 5.4).
    pub async fn invite_decline(&self, invite_id: &str) -> AppResult<()> {
        let shared = &self.shared;
        shared.ensure_enabled()?;
        let received = shared.invites.open_invite(invite_id)?;
        shared.invites.take(invite_id);
        let decline = SessionControl::InviteDecline {
            invite_id: invite_id.to_owned(),
        };
        if shared
            .friends
            .send_control(&received.host, decline)
            .is_err()
        {
            tracing::debug!(peer = %received.host.short(), "Absage nicht zugestellt, der Gastgeber ist offline");
        }
        super::joining::end_for_invite(shared, invite_id, SessionEnd::Left);
        Ok(())
    }
}

fn with_host_online(shared: &Shared, received: Received) -> Invite {
    let host_online = shared.friends.connection(&received.host).is_some();
    Invite {
        host_online,
        ..received.invite
    }
}

/// Eine Einladung eines Freundes (SPEC 5.4); was nicht passt, wird still verworfen.
pub(super) async fn receive(shared: &Arc<Shared>, host: &PeerId, wire: WireInvite) {
    let Some((received, mc_uuid)) = accepted_invite(shared, host, wire).await else {
        return;
    };
    let invite = received.invite.clone();
    if !shared.invites.admit(received) {
        tracing::debug!(peer = %host.short(), "Einladung mit fremder ID verworfen");
        return;
    }
    shared.emit(SessionEvent::Invite(InviteEvent {
        invite: invite.clone(),
    }));
    for instance_id in shared.hosting.running_instances() {
        let who = Some((invite.from_name.clone(), mc_uuid.clone()));
        mod_link::notify(shared, &instance_id, ModNotify::InviteReceived, who);
    }
}

/// Die Einladung, wie sie gespeichert wird, mit der Minecraft-UUID des Gastgebers; `None`, wenn sie verworfen wird.
async fn accepted_invite(
    shared: &Shared,
    host: &PeerId,
    wire: WireInvite,
) -> Option<(Received, Option<String>)> {
    let friends = friends_by_id(shared).await.ok()?;
    let friend = friends
        .get(&host.to_string())
        .filter(|friend| friend.confirmed && !friend.removed_by_peer)?;
    if !lock(&shared.invites.arrivals).try_hit(*host, Instant::now()) {
        tracing::debug!(peer = %host.short(), "zu viele Einladungen, verworfen");
        return None;
    }
    let now = now_secs();
    let expires_at = capped_expiry(wire.expires_at, now)?;
    let invite = Invite {
        title: wire
            .world_name
            .clone()
            .unwrap_or_else(|| wire.instance.name.clone()),
        id: wire.id,
        session_id: wire.session_id,
        from: host.to_string(),
        from_name: shown_name(friend),
        from_fingerprint: fingerprint(&host.to_string()),
        instance: wire.instance,
        received_at: now,
        expires_at,
        host_online: true,
    };
    Some((
        Received {
            host: *host,
            invite,
        },
        friend.mc_uuid.clone(),
    ))
}

/// Eine Einladung gilt höchstens 2 h ab Empfang (SPEC 5.4); eine schon abgelaufene gibt es nicht.
fn capped_expiry(expires_at: u64, now: u64) -> Option<u64> {
    let capped = expires_at.min(now + INVITE_TTL_SECS);
    (capped > now).then_some(capped)
}

/// Der Gastgeber nimmt eine Einladung zurück; beim Ende oder Rauswurf endet auch ein laufender Beitritt (SPEC 6.2).
pub(super) fn revoked(shared: &Shared, host: &PeerId, invite_id: &str, reason: RevokeReason) {
    if shared.invites.take_from(host, invite_id).is_none() {
        return;
    }
    shared.emit(SessionEvent::InviteRevoked(InviteRevokedEvent {
        invite_id: invite_id.to_owned(),
        reason,
    }));
    let ended = match reason {
        RevokeReason::Stopped => SessionEnd::Stopped,
        RevokeReason::Kicked => SessionEnd::Kicked,
        RevokeReason::Expired => return,
    };
    super::joining::end_for_invite(shared, invite_id, ended);
}

#[cfg(test)]
mod tests {
    use iroh::SecretKey;

    use super::*;
    use crate::services::friends::contract::{InstanceSummary, ModLoader};

    fn peer(seed: u8) -> PeerId {
        PeerId::from(SecretKey::from_bytes(&[seed; 32]).public())
    }

    fn received(host: u8, id: &str, session_id: &str) -> Received {
        let invite = Invite {
            id: id.into(),
            session_id: session_id.into(),
            from: peer(host).to_string(),
            from_name: "Anna".into(),
            from_fingerprint: String::new(),
            title: "Welt".into(),
            instance: InstanceSummary {
                name: "Welt".into(),
                minecraft_version: "26.3".into(),
                loader: ModLoader::Vanilla,
                loader_version: None,
                mod_count: 0,
            },
            received_at: 0,
            expires_at: u64::MAX,
            host_online: true,
        };
        Received {
            host: peer(host),
            invite,
        }
    }

    fn ids(invites: &Invites) -> Vec<String> {
        invites
            .current(0)
            .into_iter()
            .map(|received| received.invite.id)
            .collect()
    }

    #[test]
    fn a_new_invite_replaces_the_open_one_of_the_same_session() {
        let invites = Invites::default();

        invites.admit(received(1, "a", "s1"));
        invites.admit(received(1, "b", "s1"));
        invites.admit(received(2, "c", "s1"));

        assert_eq!(ids(&invites), ["b", "c"]);
    }

    #[test]
    fn the_twenty_first_invite_drops_the_oldest() {
        let invites = Invites::default();
        for n in 0..=MAX_OPEN_INVITES {
            invites.admit(received(1, &format!("i{n}"), &format!("s{n}")));
        }

        let open = ids(&invites);

        assert_eq!(open.len(), MAX_OPEN_INVITES);
        assert_eq!(open[0], "i1");
    }

    #[test]
    fn an_id_of_another_host_is_refused() {
        let invites = Invites::default();
        invites.admit(received(1, "a", "s1"));

        assert!(!invites.admit(received(2, "a", "s2")));
        assert_eq!(
            invites.take_from(&peer(2), "a").map(|r| r.invite.id),
            None,
            "only its host may revoke it"
        );
    }

    #[test]
    fn expired_invites_disappear() {
        let invites = Invites::default();
        let mut old = received(1, "a", "s1");
        old.invite.expires_at = 10;
        invites.admit(old);

        assert!(invites.current(10).is_empty());
    }

    #[test]
    fn an_invite_lasts_at_most_two_hours_and_an_expired_one_is_dropped() {
        let now = 1_000;

        assert_eq!(capped_expiry(now + 60, now), Some(now + 60));
        assert_eq!(capped_expiry(u64::MAX, now), Some(now + INVITE_TTL_SECS));
        assert_eq!(capped_expiry(now, now), None);
    }

    #[tokio::test(start_paused = true)]
    async fn eleven_invites_of_one_friend_within_an_hour_are_too_many() {
        let invites = Invites::default();
        let start = Instant::now();
        let mut arrivals = lock(&invites.arrivals);

        let admitted = (0..11).filter(|_| arrivals.try_hit(peer(1), start)).count();

        assert_eq!(admitted, 10);
        assert!(arrivals.try_hit(peer(1), start + Duration::from_secs(3600)));
    }
}
