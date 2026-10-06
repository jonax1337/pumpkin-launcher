//! Ereignisse der geteilten Welten an die Oberfläche (SPEC 8.5): Einladungen, Gastgeber- und Beitrittssitzungen,
//! LAN-Port und Mod. Die Sitzungen kennen nur [`SessionEvents`]; in der App sendet [`TauriSessionEvents`] sie als
//! Tauri-Events, Tests zeichnen sie auf.
use tauri::AppHandle;

use super::contract::{
    HostSessionEndedEvent, HostSessionEvent, InviteEvent, InviteRevokedEvent, JoinSessionEvent,
    LanEvent, ModConfirmEvent, ModConnectionEvent,
};
use crate::services::progress::emit;

#[derive(Debug, Clone, PartialEq)]
pub enum SessionEvent {
    Invite(InviteEvent),
    InviteRevoked(InviteRevokedEvent),
    HostSession(HostSessionEvent),
    HostSessionEnded(HostSessionEndedEvent),
    JoinSession(JoinSessionEvent),
    Lan(LanEvent),
    ModConnection(ModConnectionEvent),
    ModConfirm(ModConfirmEvent),
}

pub trait SessionEvents: Send + Sync + 'static {
    fn emit(&self, event: SessionEvent);
}

/// Verwirft alles, solange die App noch keinen Empfänger gesetzt hat.
pub struct NoSessionEvents;

impl SessionEvents for NoSessionEvents {
    fn emit(&self, _event: SessionEvent) {}
}

pub struct TauriSessionEvents(pub AppHandle);

impl SessionEvents for TauriSessionEvents {
    fn emit(&self, event: SessionEvent) {
        let app = &self.0;
        match event {
            SessionEvent::Invite(invite) => emit(app, "friend-invite", invite),
            SessionEvent::InviteRevoked(revoked) => emit(app, "friend-invite-revoked", revoked),
            SessionEvent::HostSession(session) => emit(app, "host-session", session),
            SessionEvent::HostSessionEnded(ended) => emit(app, "host-session-ended", ended),
            SessionEvent::JoinSession(join) => emit(app, "join-session", join),
            SessionEvent::Lan(lan) => emit(app, "lan-changed", lan),
            SessionEvent::ModConnection(connection) => emit(app, "friends-mod", connection),
            SessionEvent::ModConfirm(confirm) => emit(app, "friends-mod-confirm", confirm),
        }
    }
}
