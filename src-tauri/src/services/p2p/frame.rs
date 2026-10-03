//! Rahmen auf Peer-Streams (SPEC 5.1): `u32`-Länge (Big Endian), dann ein JSON-Objekt in UTF-8. Die Länge wird geprüft,
//! bevor Speicher für den Inhalt angelegt wird.
use std::io;

use serde::{de::DeserializeOwned, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

#[derive(Debug, thiserror::Error)]
pub enum FrameError {
    #[error("Rahmen mit {len} Bytes überschreitet die Grenze von {limit} Bytes")]
    TooLarge { len: usize, limit: usize },
    #[error("Rahmen ist kein gültiges JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Stream abgebrochen: {0}")]
    Io(#[from] io::Error),
}

/// Liest einen Rahmen von höchstens `limit` Bytes Inhalt.
pub async fn read<T: DeserializeOwned>(recv: &mut (impl AsyncRead + Unpin), limit: usize) -> Result<T, FrameError> {
    let len = recv.read_u32().await? as usize;
    if len > limit {
        return Err(FrameError::TooLarge { len, limit });
    }
    let mut body = vec![0; len];
    recv.read_exact(&mut body).await?;
    Ok(serde_json::from_slice(&body)?)
}

/// Schreibt `message` als einen Rahmen; über `limit` wird nichts gesendet.
pub async fn write<T: Serialize>(
    send: &mut (impl AsyncWrite + Unpin),
    message: &T,
    limit: usize,
) -> Result<(), FrameError> {
    let body = serde_json::to_vec(message)?;
    let len = u32::try_from(body.len())
        .ok()
        .filter(|_| body.len() <= limit)
        .ok_or(FrameError::TooLarge { len: body.len(), limit })?;
    send.write_all(&[len.to_be_bytes().as_slice(), &body].concat()).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    use super::*;

    const LIMIT: usize = 64;

    #[derive(Debug, PartialEq, Serialize, Deserialize)]
    #[serde(tag = "type", rename_all = "camelCase")]
    enum Message {
        Ping { text: String },
    }

    fn ping(text: &str) -> Message {
        Message::Ping { text: text.to_owned() }
    }

    async fn encoded(message: &Message) -> Vec<u8> {
        let mut wire = Vec::new();
        write(&mut wire, message, LIMIT).await.unwrap();
        wire
    }

    #[tokio::test]
    async fn frame_is_length_then_json() {
        let wire = encoded(&ping("hi")).await;

        let json = br#"{"type":"ping","text":"hi"}"#;
        assert_eq!(wire[..4], (json.len() as u32).to_be_bytes());
        assert_eq!(&wire[4..], json);
    }

    #[tokio::test]
    async fn round_trip() {
        let wire = encoded(&ping("hallo")).await;

        let read_back: Message = read(&mut wire.as_slice(), LIMIT).await.unwrap();

        assert_eq!(read_back, ping("hallo"));
    }

    #[tokio::test]
    async fn content_of_exactly_the_limit_is_accepted() {
        let wire = encoded(&ping(&"x".repeat(LIMIT - r#"{"type":"ping","text":""}"#.len()))).await;

        let read_back = read::<Message>(&mut wire.as_slice(), LIMIT).await;

        assert!(read_back.is_ok());
    }

    #[tokio::test]
    async fn over_limit_is_refused_before_the_content_is_read() {
        let claimed = u32::MAX.to_be_bytes();
        let mut wire: &[u8] = &[claimed.as_slice(), b"rest"].concat();

        let refused = read::<Message>(&mut wire, LIMIT).await;

        assert!(matches!(refused, Err(FrameError::TooLarge { len, limit: LIMIT }) if len == u32::MAX as usize));
        assert_eq!(wire, b"rest", "nothing after the length was read");
    }

    #[tokio::test]
    async fn writing_over_the_limit_sends_nothing() {
        let mut wire = Vec::new();

        let refused = write(&mut wire, &ping(&"x".repeat(LIMIT)), LIMIT).await;

        assert!(matches!(refused, Err(FrameError::TooLarge { limit: LIMIT, .. })));
        assert!(wire.is_empty());
    }

    #[tokio::test]
    async fn malformed_json_is_an_error() {
        let mut wire: &[u8] = &[3u32.to_be_bytes().as_slice(), b"{x}"].concat();

        assert!(matches!(read::<Message>(&mut wire, LIMIT).await, Err(FrameError::Json(_))));
    }

    #[tokio::test]
    async fn cut_off_frame_is_an_io_error() {
        let mut wire: &[u8] = &[10u32.to_be_bytes().as_slice(), b"{}"].concat();

        assert!(matches!(read::<Message>(&mut wire, LIMIT).await, Err(FrameError::Io(_))));
    }
}
