//! Ereignisse des Freunde-Dienstes an die Oberfläche (SPEC 8.5). Der Dienst kennt nur [`EventSink`]; in der App sendet
//! [`TauriEvents`] sie als Tauri-Events, Tests zeichnen sie auf.
use tauri::AppHandle;

use super::contract::{FriendPresenceEvent, FriendRequestEvent, FriendRequestRefusedEvent, NetworkStatus};
use crate::services::progress::emit;

#[derive(Debug, Clone, PartialEq)]
pub enum FriendsEvent {
    /// Listen, Anfragen, Codes, Sperren, Einstellungen, Verfügbarkeit oder Hinweise; nie Präsenz oder Weg.
    Changed,
    Network(NetworkStatus),
    Presence(FriendPresenceEvent),
    Request(FriendRequestEvent),
    RequestRefused(FriendRequestRefusedEvent),
}

pub trait EventSink: Send + Sync + 'static {
    fn emit(&self, event: FriendsEvent);
}

/// Verwirft alles, solange die App noch keinen Empfänger gesetzt hat.
pub struct NoEvents;

impl EventSink for NoEvents {
    fn emit(&self, _event: FriendsEvent) {}
}

pub struct TauriEvents(pub AppHandle);

impl EventSink for TauriEvents {
    fn emit(&self, event: FriendsEvent) {
        match event {
            FriendsEvent::Changed => emit(&self.0, "friends-changed", ()),
            FriendsEvent::Network(status) => emit(&self.0, "friends-network", status),
            FriendsEvent::Presence(presence) => emit(&self.0, "friend-presence", presence),
            FriendsEvent::Request(request) => emit(&self.0, "friend-request", request),
            FriendsEvent::RequestRefused(refused) => emit(&self.0, "friend-request-refused", refused),
        }
    }
}
