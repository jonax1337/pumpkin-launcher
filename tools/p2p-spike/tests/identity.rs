//! Lern-Tests zu Schlüssel und ID (SPEC 4.1, 8.7 `NetConfig.secret`, `PeerId`).

use iroh::{EndpointId, SecretKey};

fn identity_secret() -> [u8; 32] {
    std::array::from_fn(|index| 0x40 + index as u8)
}

#[test]
fn secret_bytes_give_the_same_id_every_time() {
    let first = SecretKey::from_bytes(&identity_secret());
    let second = SecretKey::from_bytes(&identity_secret());

    assert_eq!(first.public(), second.public());
    assert_eq!(first.to_bytes(), identity_secret());
}

#[test]
fn id_displays_as_64_lowercase_hex_and_parses_back() {
    let id = SecretKey::from_bytes(&identity_secret()).public();

    let text = id.to_string();

    assert_eq!(text.len(), 64);
    assert!(
        text.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')),
        "{text}"
    );
    assert_eq!(text.parse::<EndpointId>().unwrap(), id);
}

#[test]
fn secret_key_parses_from_64_hex_chars() {
    let hex: String = identity_secret()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();

    let key: SecretKey = hex.parse().unwrap();

    assert_eq!(key.to_bytes(), identity_secret());
}
