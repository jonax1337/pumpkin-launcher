//! Abgleich des Gast-Bestands mit dem Manifest des Gastgebers (SPEC 5.6): eine Instanz passt, wenn Minecraft-Version
//! und Loader gleich sind und die Mods, die der Server braucht, dieselben Dateien (SHA-512) sind. Nichts wird geladen.
use std::collections::{HashMap, HashSet};

use super::contract::{InstanceCandidate, Invite, JoinPlan, JoinVerdict, ModLoader, ModRef};
use super::lookup::{ModInfo, ModLookup};
use super::manifest::{self, HashCache, Manifest, ManifestMod};
use crate::models::Instance;
use crate::services::Dirs;

/// Die Mod-Dateien einer lokalen Instanz mit ihrem SHA-512.
pub trait LocalHashes {
    fn mods_of(&self, instance: &Instance) -> Vec<ManifestMod>;
}

/// Liest die Mods vom Datenträger; Hashes kommen aus dem Merker, solange sich die Dateien nicht ändern.
/// Blockiert: aus `spawn_blocking` aufrufen.
pub struct DiskHashes<'a> {
    pub dirs: &'a Dirs,
    pub cache: &'a HashCache,
}

impl LocalHashes for DiskHashes<'_> {
    fn mods_of(&self, instance: &Instance) -> Vec<ManifestMod> {
        manifest::hashed_mods(instance, &self.dirs.mods_dir(&instance.id), &|path| {
            self.cache.hash(path)
        })
    }
}

/// Was die Modrinth-Abfrage ergab; scheitert sie, gilt jede Mod als erforderlich.
pub enum Classification {
    Known(HashMap<String, ModInfo>),
    LookupFailed,
}

impl Classification {
    pub async fn fetch(lookup: &dyn ModLookup, sha512: &[String]) -> Self {
        match lookup.classify(sha512).await {
            Ok(info) => Self::Known(info),
            Err(err) => {
                tracing::warn!(%err, "Modrinth-Abfrage für den Abgleich fehlgeschlagen, alle Mods gelten als erforderlich");
                Self::LookupFailed
            }
        }
    }

    fn info(&self, sha512: &str) -> Option<&ModInfo> {
        match self {
            Self::Known(info) => info.get(sha512),
            Self::LookupFailed => None,
        }
    }

    fn is_required(&self, sha512: &str) -> bool {
        !self.info(sha512).is_some_and(|info| info.client_only)
    }

    fn mod_ref(&self, file: &ManifestMod) -> ModRef {
        let info = self.info(&file.sha512);
        ModRef {
            title: info.map_or_else(|| file.file_name.clone(), |info| info.title.clone()),
            file_name: file.file_name.clone(),
            project_id: info.map(|info| info.project_id.clone()),
        }
    }
}

/// Alle Hashes, die der Abgleich nachschlagen muss: die des Gastgebers und die der infrage kommenden Instanzen.
pub fn hashes_to_classify(
    manifest: &Manifest,
    instances: &[Instance],
    local: &dyn LocalHashes,
) -> Vec<String> {
    let own = candidates(manifest, instances).flat_map(|instance| local.mods_of(instance));
    let mut hashes: Vec<String> = manifest
        .mods
        .iter()
        .cloned()
        .chain(own)
        .map(|file| file.sha512)
        .collect();
    hashes.sort();
    hashes.dedup();
    hashes
}

/// Der Abgleich für ein geprüftes Manifest ([`manifest::validate`]).
pub fn plan(
    invite: &Invite,
    manifest: &Manifest,
    instances: &[Instance],
    local: &dyn LocalHashes,
    classification: &Classification,
) -> JoinPlan {
    let host = required(&manifest.mods, classification);
    let mut found: Vec<InstanceCandidate> = candidates(manifest, instances)
        .map(|instance| {
            compare(
                instance,
                &host,
                &required(&local.mods_of(instance), classification),
            )
        })
        .collect();
    found.sort_by_key(|candidate| {
        (
            !candidate.matches,
            candidate.missing.len() + candidate.extra.len(),
        )
    });
    let verdict = verdict_of(&found);
    JoinPlan {
        invite_id: invite.id.clone(),
        summary: invite.instance.clone(),
        create_vanilla: verdict == JoinVerdict::NoInstance && manifest.loader == ModLoader::Vanilla,
        verdict,
        candidates: found,
        lookup_failed: matches!(classification, Classification::LookupFailed),
    }
}

/// Plan für eine Welt, deren Minecraft-Version zu alt ist: es gibt nichts abzugleichen.
pub fn version_unsupported(invite: &Invite) -> JoinPlan {
    JoinPlan {
        invite_id: invite.id.clone(),
        summary: invite.instance.clone(),
        verdict: JoinVerdict::VersionUnsupported,
        candidates: Vec::new(),
        create_vanilla: false,
        lookup_failed: false,
    }
}

/// Instanzen mit derselben Minecraft-Version und demselben Loader; die Loader-Version zählt nicht.
fn candidates<'a>(
    manifest: &'a Manifest,
    instances: &'a [Instance],
) -> impl Iterator<Item = &'a Instance> {
    instances.iter().filter(|i| {
        i.minecraft_version == manifest.minecraft_version && i.loader == manifest.loader
    })
}

/// Eine Datei, die der Server braucht, mit der Angabe für die Anzeige.
struct Required {
    sha512: String,
    shown: ModRef,
}

/// Die Dateien, die der Server braucht, je Hash einmal.
fn required(mods: &[ManifestMod], classification: &Classification) -> Vec<Required> {
    let mut seen = HashSet::new();
    mods.iter()
        .filter(|file| {
            classification.is_required(&file.sha512) && seen.insert(file.sha512.as_str())
        })
        .map(|file| Required {
            sha512: file.sha512.clone(),
            shown: classification.mod_ref(file),
        })
        .collect()
}

/// Was in `from` steht, aber nicht in `other`.
fn absent_from(from: &[Required], other: &[Required]) -> Vec<ModRef> {
    let present: HashSet<&str> = other.iter().map(|file| file.sha512.as_str()).collect();
    from.iter()
        .filter(|file| !present.contains(file.sha512.as_str()))
        .map(|file| file.shown.clone())
        .collect()
}

fn compare(instance: &Instance, host: &[Required], local: &[Required]) -> InstanceCandidate {
    let (missing, extra) = (absent_from(host, local), absent_from(local, host));
    InstanceCandidate {
        instance_id: instance.id.clone(),
        name: instance.name.clone(),
        matches: missing.is_empty() && extra.is_empty(),
        missing,
        extra,
    }
}

fn verdict_of(candidates: &[InstanceCandidate]) -> JoinVerdict {
    if candidates.iter().any(|candidate| candidate.matches) {
        JoinVerdict::Ready
    } else if candidates.is_empty() {
        JoinVerdict::NoInstance
    } else {
        JoinVerdict::MissingContent
    }
}
