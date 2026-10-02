//! Lädt Dateien des neuen Packs, bevor im Spielordner etwas geändert wird: Inhalte in den Mod-Cache, alles andere
//! in den Arbeitsordner des Updates. Bricht der Nutzer ab oder scheitert ein Download, ist das Spiel unberührt.
use std::{
    fs,
    path::{Path, PathBuf},
};

use futures::StreamExt;

use super::source::{Body, NewFile};
use crate::{
    coded,
    error::{AppError, AppResult},
    services::{
        content,
        download::sha1_hex,
        limits::DOWNLOAD_CONCURRENCY,
        modrinth, mods,
        progress::{Phase, ProgressFn},
        Dirs,
    },
};

pub(super) struct Stage<'a> {
    dirs: &'a Dirs,
    spill: PathBuf,
    next: usize,
}

impl<'a> Stage<'a> {
    pub(super) fn new(dirs: &'a Dirs, work: &Path) -> Self {
        Self { dirs, spill: work.join("new"), next: 0 }
    }

    /// Lädt die Dateien `wanted` (Indizes in `files`, alle noch aus der Quelle) und vermerkt, wo sie jetzt liegen.
    pub(super) async fn fetch(&mut self, files: &mut [NewFile], wanted: Vec<usize>, progress: ProgressFn<'_>) -> AppResult<()> {
        if wanted.is_empty() {
            return Ok(());
        }
        let client = modrinth::download_client()?;
        let total = wanted.len() as u64;
        let mut loaded = Vec::with_capacity(wanted.len());
        let source: &[NewFile] = files;
        let mut downloads = futures::stream::iter(wanted.into_iter().map(|i| {
            let client = &client;
            async move {
                let Body::Fetch(fetch) = &source[i].body else {
                    return Err(AppError::invalid(coded!("errors.packs.update.alreadyLoaded")));
                };
                Ok::<_, AppError>((i, fetch.download(client).await?))
            }
        }))
        .buffer_unordered(DOWNLOAD_CONCURRENCY);
        while let Some(item) = downloads.next().await {
            let (i, data) = item?;
            loaded.push((i, self.keep(&source[i].path, &data)?));
            progress(Phase::Download, loaded.len() as u64, total);
        }
        drop(downloads);
        for (i, (sha1, body)) in loaded {
            files[i].sha1 = Some(sha1);
            files[i].body = body;
        }
        Ok(())
    }

    /// Legt geprüfte Bytes ab: Inhalte in den Mod-Cache, alles andere in den Arbeitsordner.
    fn keep(&mut self, path: &str, data: &[u8]) -> AppResult<(String, Body)> {
        if content::content_file(Path::new(path)).is_some() {
            return Ok((mods::cache_bytes(self.dirs, data)?, Body::Cached));
        }
        fs::create_dir_all(&self.spill)?;
        let spilled = self.spill.join(self.next.to_string());
        self.next += 1;
        fs::write(&spilled, data)?;
        Ok((sha1_hex(data), Body::Spilled(spilled)))
    }
}
