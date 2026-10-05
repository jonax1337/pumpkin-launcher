//! Freunde: Identität, Codes, Anfragen, Präsenz, Welten teilen und beitreten.
pub mod avatar;
mod by_name;
pub mod code;
pub mod config;
pub mod contract;
#[cfg(test)]
mod contract_tests;
pub mod control;
pub mod directory;
pub mod events;
mod hello;
mod hosting;
pub mod identity;
pub mod ingame;
mod invites;
mod joining;
pub mod limits;
pub mod lookup;
pub mod manifest;
pub mod matching;
mod mcproto;
mod mod_link;
mod outbox;
pub mod records;
mod requests;
pub mod sanitize;
mod service;
pub mod session_events;
mod sessions;
mod status;
#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_by_name;
#[cfg(test)]
mod tests_match;
#[cfg(test)]
mod tests_session;

pub use joining::JoinTimers;
pub use service::{
    AccountProfile, Friends, HandlerAlreadySet, Lifecycle, LifecycleEvent, NetOptions,
    NotConnected, PeerStreamHandler,
};
pub use sessions::{
    FriendSessions, MojangVersions, SessionContext, VersionCatalog, PRODUCTION_LIVENESS,
};
