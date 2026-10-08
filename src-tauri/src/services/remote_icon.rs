//! Ein Bild von einer Adresse im Netz als `data:`-URL: das Modpack-Icon für Verknüpfungen und für importierte Instanzen.
//! Geladen wird nur über `https` von öffentlichen Adressen (`providers::net`), höchstens `ICON_LIMIT` Bytes und höchstens
//! `FETCH_TIMEOUT` lang: ein Icon ist Zierde und soll weder einen Import noch eine Verknüpfung aufhalten.
use std::time::Duration;

use super::limits::ICON_LIMIT;
use super::providers::net;
use super::{data_url, image_mime, Dirs};
use crate::error::AppResult;
use crate::models::new_id;

const FETCH_TIMEOUT: Duration = Duration::from_secs(15);

/// Das Bild unter `url`; `None`, wenn es zu lange dauert oder die geladenen Bytes kein Bild sind, das die Oberfläche
/// anzeigen kann.
pub(crate) async fn fetch(dirs: &Dirs, url: &str) -> AppResult<Option<String>> {
    let folder = dirs.root.join("cache");
    tokio::fs::create_dir_all(&folder).await?;
    let temp = folder.join(format!("icon-{}.download", new_id()));
    let downloaded = tokio::time::timeout(FETCH_TIMEOUT, net::download_public(url, &temp, ICON_LIMIT, &|_, _| {})).await;
    let bytes = match downloaded {
        Ok(Ok(())) => Some(tokio::fs::read(&temp).await),
        Ok(Err(err)) => {
            remove_temp(&temp).await;
            return Err(err);
        }
        Err(_) => {
            tracing::warn!(url, "Bild nicht rechtzeitig geladen");
            None
        }
    };
    remove_temp(&temp).await;
    Ok(match bytes {
        Some(bytes) => {
            let bytes = bytes?;
            image_mime(&bytes).map(|mime| data_url(mime, &bytes))
        }
        None => None,
    })
}

async fn remove_temp(temp: &std::path::Path) {
    if let Err(err) = tokio::fs::remove_file(temp).await {
        tracing::debug!(%err, "Zwischendatei des Bildes nicht entfernt");
    }
}
