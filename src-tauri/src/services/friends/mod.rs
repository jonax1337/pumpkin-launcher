//! Freunde: Identität, Codes, Anfragen, Präsenz, Welten teilen und beitreten.
pub mod code;
pub mod config;
pub mod contract;
pub mod control;
pub mod events;
mod hello;
pub mod identity;
pub mod limits;
mod outbox;
pub mod records;
mod requests;
pub mod sanitize;
mod service;
mod status;
#[cfg(test)]
mod contract_tests;
#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests;

pub use service::{
    AccountProfile, Friends, HandlerAlreadySet, Lifecycle, LifecycleEvent, NetOptions, NotConnected, PeerStreamHandler,
};
