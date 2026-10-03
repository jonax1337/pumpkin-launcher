//! Freunde: Identität, Codes, Anfragen, Präsenz, Welten teilen und beitreten.
pub mod avatar;
pub mod code;
pub mod config;
pub mod contract;
pub mod identity;
pub mod lookup;
pub mod manifest;
pub mod matching;
pub mod modinstall;
pub mod records;
pub mod sanitize;

#[cfg(test)]
mod contract_tests;
#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests_match;
