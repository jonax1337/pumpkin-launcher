//! Persisted instance-root selection and copy/verify/commit relocation. Metadata never moves with instances.
//!
//! Safety rules that hold for everything in here:
//! - Only the instance folders named in `instances.json` are ever copied or deleted below the library root;
//!   every other entry stays where it is, and the old root is removed non-recursively.
//! - A selection is only trusted after it was checked against the launcher data and the program folder.
//! - A request from the installer is a hint: whatever is wrong with it, startup goes on with the current library.
use std::{
    collections::BTreeMap,
    ffi::{OsStr, OsString},
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
};

use crate::{coded, error::{AppError, AppResult}};
use super::{
    content::regular_parents, download::{sha1_file, RemoveOnDrop}, none_if_missing, remove_logged,
    require_plain_name, write_atomic, Dirs,
};

pub(crate) const CURRENT: &str = "instances-path.txt";
pub(crate) const REQUEST: &str = "instances-path-request.txt";
/// Where a request that could not be applied is kept for inspection.
pub(crate) const REQUEST_REJECTED: &str = "instances-path-request.txt.rejected";
/// Names the staging folder of a copy in progress, so a crash cannot leave it behind unnoticed.
pub(crate) const STAGING_MARKER: &str = "instances-staging.txt";
const STAGING_PREFIX: &str = ".pumpkin-instances-";
const INSTANCES_FILE: &str = "instances.json";
/// A handoff file holds one path; anything larger is not one.
const MAX_HANDOFF_BYTES: u64 = 64 * 1024;

#[cfg(windows)]
const LEGACY_IDENTIFIER: &str = "dev.laux.launcher";

pub(crate) fn read_path(path: &Path) -> AppResult<Option<PathBuf>> {
    let Some(metadata) = none_if_missing(fs::symlink_metadata(path))? else { return Ok(None) };
    if !metadata.file_type().is_file() || metadata.len() > MAX_HANDOFF_BYTES {
        return Err(invalid_location());
    }
    let mut bytes = Vec::new();
    fs::File::open(path)?.take(MAX_HANDOFF_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_HANDOFF_BYTES || !bytes.starts_with(&[0xff, 0xfe]) || bytes.len() % 2 != 0 {
        return Err(invalid_location());
    }
    let units: Vec<u16> = bytes[2..].as_chunks::<2>().0.iter().map(|b| u16::from_le_bytes(*b)).collect();
    let text = String::from_utf16(&units).map_err(|_| invalid_location())?;
    let text = text.strip_suffix("\r\n").ok_or_else(invalid_location)?;
    let result = PathBuf::from(text);
    validate_absolute(&result)?;
    Ok(Some(result))
}

pub(crate) fn write_path(file: &Path, path: &Path) -> AppResult<()> {
    validate_absolute(path)?;
    let text = path.to_str().ok_or_else(invalid_location)?;
    let mut bytes = vec![0xff, 0xfe];
    for unit in text.encode_utf16().chain("\r\n".encode_utf16()) {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    let parent = file.parent().ok_or_else(invalid_location)?;
    regular_parents(parent, file)?;
    let mut temporary = file.as_os_str().to_owned();
    temporary.push(".tmp");
    regular_parents(parent, Path::new(&temporary))?;
    write_atomic(file, &bytes)
}

/// Selects the instance root at startup and applies a pending installer request.
///
/// Fails closed only for the stored current location: one that is gone or unsafe is an error and nothing is
/// touched. The installer request is a hint. If it cannot be read or applied, it is set aside as
/// [`REQUEST_REJECTED`], reported as a notice and the launcher starts with the current (or default) library.
/// Likewise a move that did commit never fails startup; whatever the user should still know (an old copy that
/// remains, a request file that could not be removed) comes back as notices.
pub(crate) fn initialize(dirs: &Dirs, default: Option<&Path>) -> AppResult<Vec<String>> {
    let current_file = dirs.root.join(CURRENT);
    let stored = read_path(&current_file)?;
    let mut notices = Vec::new();
    let mut request = match read_path(&dirs.root.join(REQUEST)) {
        Ok(request) => request,
        Err(error) => {
            reject_request(dirs, &error, &mut notices);
            None
        }
    };
    let legacy = dirs.root.join("instances");
    let existing_library = legacy.exists() || dirs.root.join(INSTANCES_FILE).exists();

    // Nothing to move yet: a request on a fresh install simply names the first library location.
    let mut first_location = None;
    if stored.is_none() && !existing_library {
        if let Some(path) = request.take() {
            match first_location_from(dirs, &path) {
                Ok(resolved) => first_location = Some(resolved),
                Err(error) => reject_request(dirs, &error, &mut notices),
            }
        }
    }
    let applied_first = first_location.is_some();

    let selected = match (&stored, first_location) {
        (Some(path), _) => {
            if !path.is_dir() {
                return Err(AppError::invalid(coded!("errors.storage.missingLocation", path = path.display())));
            }
            let resolved = resolve(path)?;
            // The launcher's own default is trusted; anything else must not be the launcher data or program,
            // or contain them: the old copy is deleted after a move.
            if resolved != resolve(&legacy)? {
                ensure_unprotected(dirs, None, &resolved)?;
            }
            resolved
        }
        (None, Some(path)) => path,
        (None, None) => match default.filter(|_| !existing_library).map(usable_default).transpose() {
            Ok(Some(path)) => path,
            Ok(None) => resolve(&legacy)?,
            Err(error) => {
                tracing::warn!(%error, "Default instance folder unusable; using the launcher data folder");
                notices.push(format!(
                    "The default instance folder could not be created ({}). Instances are kept in the launcher data folder instead: {}. You can choose another folder in the launcher settings.",
                    short_reason(&error),
                    legacy.display()
                ));
                resolve(&legacy)?
            }
        },
    };
    // Only the launcher's own folder can still be missing here, and failing to create that is the one fatal case.
    if !selected.exists() {
        fs::create_dir_all(&selected)?;
    }
    dirs.set_instances_dir(selected.clone());
    if stored.as_deref() != Some(selected.as_path()) {
        write_path(&current_file, &selected)?;
    }
    if applied_first {
        consume_request(dirs, &mut notices);
    }

    sweep_staging(dirs, &selected, request.as_deref());
    if let Some(request) = request {
        match relocate(dirs, &request) {
            Ok(retained) => {
                notices.extend(retained.map(|source| retained_notice(&source)));
                consume_request(dirs, &mut notices);
            }
            // A game that still runs may be gone at the next start: the choice is not thrown away.
            Err(error) if error.key() == Some("errors.instance.stillRunning") => {
                tracing::warn!(%error, "Instance folder request postponed");
                notices.push(
                    "The instance folder chosen in the installer was not applied because a game is still running. It will be applied at the next start once the game has ended."
                        .to_owned(),
                );
            }
            Err(error) => reject_request(dirs, &error, &mut notices),
        }
    }
    Ok(notices)
}

/// Resolves and creates the launcher's default location; any failure leaves the caller to fall back.
fn usable_default(path: &Path) -> AppResult<PathBuf> {
    let resolved = resolve(path)?;
    fs::create_dir_all(&resolved)?;
    Ok(resolved)
}

/// The location an installer request names on a fresh install. It is created here, so a folder that cannot be
/// created (read-only drive, no rights, a file in the way) is rejected like any other unusable request.
fn first_location_from(dirs: &Dirs, path: &Path) -> AppResult<PathBuf> {
    validate_absolute(path)?;
    reject_link(path)?;
    let resolved = resolve(path)?;
    ensure_unprotected(dirs, None, &resolved)?;
    require_empty_destination(&resolved)?;
    fs::create_dir_all(&resolved)?;
    Ok(resolved)
}

fn retained_notice(source: &Path) -> String {
    format!("The instance folder was moved successfully, but part of the old copy could not be removed. Delete it manually once you no longer need it: {}", source.display())
}

/// The request was applied: it must not run again.
fn consume_request(dirs: &Dirs, notices: &mut Vec<String>) {
    let file = dirs.root.join(REQUEST);
    if let Err(error) = none_if_missing(fs::remove_file(&file)) {
        tracing::warn!(path = %file.display(), %error, "Applied instance storage request could not be removed");
        notices.push(format!(
            "The instance folder was moved, but the installer request file could not be removed. Delete it manually, or the next start may try to apply it again: {}",
            file.display()
        ));
    }
}

/// A short English reason for a notice. The full error goes to the log; the notice must not mix in another language.
fn short_reason(error: &AppError) -> &'static str {
    match error.key() {
        Some("errors.storage.invalidLocation") => "the path is not a usable folder",
        Some("errors.storage.occupiedLocation") => "the folder is not empty",
        Some("errors.storage.missingLocation") => "the folder or drive is missing",
        Some("errors.storage.copyVerification") => "copied files could not be verified",
        Some("errors.instance.stillRunning") => "a game is still running",
        Some(key) if key.starts_with("errors.modrinth.") => "the library contains links",
        _ if matches!(error, AppError::Io(_)) => "the folder could not be accessed or created",
        _ => "the request is not valid",
    }
}

/// The request cannot be used: keep it for inspection, tell the user and let startup go on.
fn reject_request(dirs: &Dirs, error: &AppError, notices: &mut Vec<String>) {
    let (file, rejected) = (dirs.root.join(REQUEST), dirs.root.join(REQUEST_REJECTED));
    tracing::warn!(%error, path = %file.display(), "Instance folder request from the installer ignored");
    let _ = none_if_missing(fs::remove_file(&rejected));
    let kept = match fs::rename(&file, &rejected) {
        Ok(()) => format!("The request was saved as {REQUEST_REJECTED}."),
        Err(_) => match none_if_missing(fs::remove_file(&file)) {
            Ok(_) => "The request was discarded.".to_owned(),
            Err(_) => format!("The request file {REQUEST} could not be removed either."),
        },
    };
    notices.push(format!(
        "The instance folder chosen in the installer could not be used and was ignored ({}). Your library stays where it is; you can choose another folder in the launcher settings. {kept}",
        short_reason(error)
    ));
}

/// Drops a request that is no longer wanted (before an interactive move); a leftover one would move the library
/// again at the next start, so a request that cannot be removed stops the move.
pub(crate) fn discard_request(dirs: &Dirs) -> AppResult<()> {
    none_if_missing(fs::remove_file(dirs.root.join(REQUEST)))?;
    Ok(())
}

/// The caller holds the library-wide operation lock and has excluded all running games.
///
/// The destination must be absent or an empty folder. Only the instance folders listed in `instances.json` are
/// copied into a staging folder next to the destination and verified; then it is renamed into place and the
/// selection is persisted. The old copy of those folders is deleted last. Whatever else lies in the old root is
/// left alone, so the old root is removed only when nothing remains, and reported otherwise.
pub(crate) fn relocate(dirs: &Dirs, destination: &Path) -> AppResult<Option<PathBuf>> {
    validate_absolute(destination)?;
    reject_link(destination)?;
    let live = dirs.instances_dir();
    validate_absolute(&live)?;
    reject_link(&live)?;
    let source = resolve(&live)?;
    let destination = resolve(destination)?;
    if source == destination {
        return Ok(None);
    }
    ensure_unprotected(dirs, Some(&source), &destination)?;
    if !source.is_dir() {
        return Err(AppError::invalid(coded!("errors.storage.missingLocation", path = source.display())));
    }
    let ids = known_instance_ids(dirs)?;
    refuse_running_worlds(&source, &ids)?;

    // A previous attempt that died between the rename and the selection left a complete copy: adopt it.
    if is_complete_copy(&source, &destination, &ids)? {
        tracing::info!(path = %destination.display(), "Adopting an already complete copy of the instance folder");
        switch_to(dirs, &destination)?;
        return Ok(remove_old_copy(&source, &ids));
    }
    require_empty_destination(&destination)?;
    let started = std::time::Instant::now();
    let bytes: u64 = ids.iter().map(|id| tree_bytes(&source.join(id))).sum();
    tracing::info!(from = %source.display(), to = %destination.display(), instances = ids.len(), bytes, "Moving the instance folder");

    let parent = destination.parent().ok_or_else(invalid_location)?;
    fs::create_dir_all(parent)?;
    let staging = parent.join(format!("{STAGING_PREFIX}{}", crate::models::new_id()));
    fs::create_dir(&staging)?;
    let marker = dirs.root.join(STAGING_MARKER);
    // Dropped in reverse order: the staging folder goes first, then its marker.
    let _marker_guard = RemoveOnDrop::new(marker.clone());
    let stage_guard = RemoveOnDrop::new(staging.clone());
    write_path(&marker, &staging)?;
    for id in &ids {
        let from = source.join(id);
        match none_if_missing(fs::symlink_metadata(&from))? {
            None => {}
            Some(metadata) if metadata.file_type().is_dir() => {
                let to = staging.join(id);
                fs::create_dir(&to)?;
                copy_verified(&from, &to)?;
                #[cfg(unix)]
                fs::set_permissions(&to, metadata.permissions())?;
            }
            Some(_) => return Err(link_error(&from)),
        }
    }
    require_empty_destination(&destination)?;
    // An empty folder the user made stays theirs: it is swapped out only for the instant of the rename and
    // put back on any failure.
    let preexisting = destination.exists();
    if preexisting {
        fs::remove_dir(&destination)?;
    }
    if let Err(error) = fs::rename(&staging, &destination) {
        restore_empty_destination(&destination, preexisting);
        return Err(error.into());
    }
    stage_guard.disarm();
    if let Err(error) = switch_to(dirs, &destination) {
        if fs::rename(&destination, &staging).is_ok() {
            remove_logged(&staging);
        } else {
            remove_logged(&destination);
        }
        restore_empty_destination(&destination, preexisting);
        return Err(error);
    }
    tracing::info!(bytes, seconds = started.elapsed().as_secs(), "Instance folder moved");
    Ok(remove_old_copy(&source, &ids))
}

/// Persists the selection first, then switches the live one: no state ever points at a missing library.
fn switch_to(dirs: &Dirs, destination: &Path) -> AppResult<()> {
    write_path(&dirs.root.join(CURRENT), destination)?;
    dirs.set_instances_dir(destination.to_owned());
    Ok(())
}

/// Deletes the old copy of the moved instance folders and the old root if that leaves it empty.
/// Returns the root when anything of it remains; the move itself has already succeeded.
fn remove_old_copy(source: &Path, ids: &[String]) -> Option<PathBuf> {
    for id in ids {
        let folder = source.join(id);
        let is_folder = fs::symlink_metadata(&folder).is_ok_and(|metadata| metadata.file_type().is_dir());
        if is_folder {
            if let Err(error) = fs::remove_dir_all(&folder) {
                tracing::warn!(path = %folder.display(), %error, "Old instance folder could not be removed");
            }
        }
    }
    match none_if_missing(fs::remove_dir(source)) {
        Ok(_) => None,
        Err(error) => {
            tracing::warn!(path = %source.display(), %error, "Instance storage committed; old root retained");
            Some(source.to_owned())
        }
    }
}

/// The ids of all instances in `instances.json`, including entries this build cannot read. A missing file means
/// no instances; one that cannot be parsed stops the move, since nothing would be known to move.
fn known_instance_ids(dirs: &Dirs) -> AppResult<Vec<String>> {
    let Some(bytes) = none_if_missing(fs::read(dirs.root.join(INSTANCES_FILE)))? else { return Ok(Vec::new()) };
    let entries: Vec<serde_json::Value> = serde_json::from_slice(&bytes)?;
    let mut ids: Vec<String> = entries
        .iter()
        .filter_map(|entry| entry.get("id")?.as_str())
        .filter(|id| require_plain_name(id).is_ok())
        .map(str::to_owned)
        .collect();
    ids.sort();
    ids.dedup();
    Ok(ids)
}

/// A game that keeps a world open holds its `session.lock`. On Windows the lock is mandatory, so our attempt to
/// take it fails while a game, including one from an earlier launcher session, has the world open. This is only
/// a secondary guard: on Unix Java uses `fcntl` locks while this takes `flock`, which as far as known do not
/// conflict on local filesystems, so there it detects nothing; and a game that sits in the menu holds no
/// world lock at all. The launcher's own bookkeeping (`AppState::begin_storage_operation`) only knows games it
/// started in this session.
fn refuse_running_worlds(source: &Path, ids: &[String]) -> AppResult<()> {
    for id in ids {
        let Ok(worlds) = fs::read_dir(source.join(id).join("minecraft").join("saves")) else { continue };
        for world in worlds.flatten() {
            let Ok(file) = fs::File::open(world.path().join("session.lock")) else { continue };
            if matches!(file.try_lock(), Err(fs::TryLockError::WouldBlock)) {
                return Err(AppError::invalid(coded!("errors.instance.stillRunning")));
            }
        }
    }
    Ok(())
}

/// Whether `destination` already holds exactly the instance folders of `source`, byte for byte.
fn is_complete_copy(source: &Path, destination: &Path, ids: &[String]) -> AppResult<bool> {
    let Some(metadata) = none_if_missing(fs::symlink_metadata(destination))? else { return Ok(false) };
    if !metadata.file_type().is_dir() {
        return Ok(false);
    }
    let mut names = Vec::new();
    for entry in fs::read_dir(destination)? {
        names.push(entry?.file_name());
    }
    if names.is_empty() || names.iter().any(|name| !ids.iter().any(|id| OsStr::new(id) == name.as_os_str())) {
        return Ok(false);
    }
    for id in ids {
        let (from, to) = (source.join(id), destination.join(id));
        match (none_if_missing(fs::symlink_metadata(&from))?, none_if_missing(fs::symlink_metadata(&to))?) {
            (None, None) => {}
            (Some(a), Some(b)) if a.file_type().is_dir() && b.file_type().is_dir() => {
                if !same_tree(&from, &to)? {
                    return Ok(false);
                }
            }
            _ => return Ok(false),
        }
    }
    Ok(true)
}

fn same_tree(a: &Path, b: &Path) -> AppResult<bool> {
    fn listing(dir: &Path) -> AppResult<BTreeMap<OsString, (fs::FileType, u64)>> {
        let mut entries = BTreeMap::new();
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            entries.insert(entry.file_name(), (entry.file_type()?, entry.metadata()?.len()));
        }
        Ok(entries)
    }
    let (left, right) = (listing(a)?, listing(b)?);
    if left.len() != right.len() {
        return Ok(false);
    }
    for (name, (kind, length)) in &left {
        let Some((other_kind, other_length)) = right.get(name) else { return Ok(false) };
        let (from, to) = (a.join(name), b.join(name));
        let same = if kind.is_dir() && other_kind.is_dir() {
            same_tree(&from, &to)?
        } else if kind.is_file() && other_kind.is_file() {
            length == other_length && sha1_file(&from)? == sha1_file(&to)?
        } else {
            false
        };
        if !same {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Removes staging folders of copies that never finished: the one named by the marker, and lookalikes beside the
/// library and beside a requested destination. Only real folders with exactly our name pattern are touched.
fn sweep_staging(dirs: &Dirs, selected: &Path, request: Option<&Path>) {
    let Ok(root) = resolve(&dirs.root) else { return };
    let marker = dirs.root.join(STAGING_MARKER);
    match read_path(&marker) {
        Ok(Some(staging)) => remove_stale_staging(&root, selected, &staging),
        Ok(None) => {}
        Err(error) => tracing::warn!(%error, "Unreadable staging marker discarded"),
    }
    remove_logged(&marker);
    for parent in [selected.parent(), request.and_then(Path::parent)].into_iter().flatten() {
        let Ok(entries) = fs::read_dir(parent) else { continue };
        for entry in entries.flatten() {
            remove_stale_staging(&root, selected, &entry.path());
        }
    }
}

fn remove_stale_staging(root: &Path, selected: &Path, path: &Path) {
    let is_staging_name = path.file_name().and_then(OsStr::to_str)
        .and_then(|name| name.strip_prefix(STAGING_PREFIX))
        .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok());
    if !is_staging_name || !fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_dir()) {
        return;
    }
    // Never the launcher data or the library, nor anything containing or inside them; staging beside the library
    // inside the launcher data is exactly the default layout, so a child of the launcher data is fine.
    if root.starts_with(path) || selected.starts_with(path) || path.starts_with(selected) {
        return;
    }
    tracing::info!(path = %path.display(), "Removing the leftovers of an unfinished instance folder copy");
    remove_logged(path);
}

fn restore_empty_destination(destination: &Path, preexisting: bool) {
    if preexisting && !destination.exists() {
        if let Err(error) = fs::create_dir(destination) {
            tracing::warn!(path = %destination.display(), %error, "Empty destination folder could not be restored");
        }
    }
}

/// `candidate` may neither contain nor lie within the launcher data, the program folder or the current library.
fn ensure_unprotected(dirs: &Dirs, source: Option<&Path>, candidate: &Path) -> AppResult<()> {
    let mut protected = vec![resolve(&dirs.root)?, program_dir()?];
    protected.extend(source.map(Path::to_owned));
    if protected.iter().any(|path| path.starts_with(candidate) || candidate.starts_with(path)) {
        return Err(invalid_location());
    }
    Ok(())
}

/// Unlike the other protected folders, an unknown program folder is an error: the protection must not silently lapse.
fn program_dir() -> AppResult<PathBuf> {
    let executable = std::env::current_exe()?;
    let parent = executable.parent().ok_or_else(invalid_location)?;
    without_verbatim_prefix(fs::canonicalize(parent)?)
}

/// The destination must be absent or an empty folder: anything that is not a folder is not a usable location at
/// all, a folder with content is merely occupied.
fn require_empty_destination(path: &Path) -> AppResult<()> {
    if let Some(metadata) = none_if_missing(fs::symlink_metadata(path))? {
        if !metadata.is_dir() {
            return Err(invalid_location());
        }
        if fs::read_dir(path)?.next().transpose()?.is_some() {
            return Err(AppError::invalid(coded!("errors.storage.occupiedLocation", path = path.display())));
        }
    }
    Ok(())
}

/// Size of a folder tree for the log; links are not followed and unreadable parts count as nothing.
fn tree_bytes(path: &Path) -> u64 {
    let Ok(metadata) = fs::symlink_metadata(path) else { return 0 };
    if metadata.is_file() {
        return metadata.len();
    }
    if !metadata.is_dir() {
        return 0;
    }
    fs::read_dir(path).map_or(0, |children| children.flatten().map(|child| tree_bytes(&child.path())).sum())
}

fn is_link(path: &Path) -> AppResult<bool> {
    Ok(none_if_missing(fs::symlink_metadata(path))?.is_some_and(|metadata| metadata.file_type().is_symlink()))
}

/// Symlinks and junctions are refused as a selection; they would make the real location differ from the chosen one.
fn reject_link(path: &Path) -> AppResult<()> {
    if is_link(path)? { Err(invalid_location()) } else { Ok(()) }
}

fn link_error(path: &Path) -> AppError {
    AppError::invalid(coded!("errors.modrinth.symlinkInTarget").with_details(path.display().to_string()))
}

/// Absolute, free of `..`, with names Windows can store, and on Windows only a drive or a network share: device
/// namespaces (`\\.\`) and aliases of this machine (`\\localhost\C$`) would sidestep the checks against local folders.
fn validate_absolute(path: &Path) -> AppResult<()> {
    let text = path.to_str().ok_or_else(invalid_location)?;
    if !path.is_absolute() || path.parent().is_none() || text.contains(['\0', '\r', '\n'])
        || path.components().any(|part| matches!(part, Component::ParentDir | Component::CurDir))
    {
        return Err(invalid_location());
    }
    #[cfg(windows)]
    for part in path.components() {
        match part {
            Component::Prefix(prefix) => validate_prefix(prefix.kind())?,
            Component::Normal(name) => {
                require_plain_name(name.to_str().ok_or_else(invalid_location)?)?;
            }
            _ => {}
        }
    }
    Ok(())
}

#[cfg(windows)]
fn validate_prefix(prefix: std::path::Prefix<'_>) -> AppResult<()> {
    use std::path::Prefix;
    match prefix {
        Prefix::Disk(_) | Prefix::VerbatimDisk(_) => Ok(()),
        Prefix::UNC(server, _) | Prefix::VerbatimUNC(server, _) => {
            let server = server.to_str().ok_or_else(invalid_location)?.to_ascii_lowercase();
            let this_machine = std::env::var("COMPUTERNAME").ok().map(|name| name.to_ascii_lowercase());
            let alias = server.is_empty()
                || matches!(server.as_str(), "localhost" | "." | "?" | "::1" | "[::1]")
                || server.starts_with("127.")
                || server.ends_with(".localhost")
                || this_machine.as_deref() == Some(server.as_str());
            if alias { Err(invalid_location()) } else { Ok(()) }
        }
        Prefix::Verbatim(_) | Prefix::DeviceNS(_) => Err(invalid_location()),
    }
}

/// The path with every existing part canonical: links and junctions on the way are followed, short names and
/// case normalised. The not yet existing tail is kept as given, with normalised separators. Reparse points such
/// as cloud-synced folders (OneDrive's Documents) are ordinary here; only the final element is checked by
/// [`reject_link`].
fn resolve(path: &Path) -> AppResult<PathBuf> {
    validate_absolute(path)?;
    let mut existing = path;
    while !existing.exists() {
        existing = existing.parent().ok_or_else(invalid_location)?;
    }
    let mut resolved = without_verbatim_prefix(fs::canonicalize(existing)?)?;
    // `join` of an empty tail would append a separator, and Windows cannot stat a file path that ends in one.
    resolved.extend(path.strip_prefix(existing).map_err(|_| invalid_location())?.components());
    Ok(resolved)
}

#[cfg(windows)]
fn without_verbatim_prefix(path: PathBuf) -> AppResult<PathBuf> {
    let text = path.to_str().ok_or_else(invalid_location)?;
    Ok(match text.strip_prefix(r"\\?\UNC\") {
        Some(unc) => PathBuf::from(format!(r"\\{unc}")),
        None => PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(text)),
    })
}

#[cfg(not(windows))]
fn without_verbatim_prefix(path: PathBuf) -> AppResult<PathBuf> {
    Ok(path)
}

fn invalid_location() -> AppError {
    AppError::invalid(coded!("errors.storage.invalidLocation"))
}

/// The volume or share a path starts on, in a spelling that ignores case and the `\\?\` prefix. Lexical only.
fn volume_key(path: &Path) -> String {
    let Some(first) = path.components().next().map(|part| part.as_os_str().to_string_lossy().to_ascii_lowercase()) else { return String::new() };
    match first.strip_prefix(r"\\?\") {
        Some(rest) => rest.strip_prefix(r"unc\").map_or_else(|| rest.to_owned(), |unc| format!(r"\\{unc}")),
        None => first,
    }
}

/// Reject rather than silently omit links, junctions or special files. Preserve empty directories too.
/// Only links count as unsafe, not every reparse point: cloud placeholders and compressed files read normally.
fn copy_verified(source: &Path, destination: &Path) -> AppResult<()> {
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let from = entry.path();
        let to = destination.join(entry.file_name());
        let metadata = entry.metadata()?;
        let kind = metadata.file_type();
        if kind.is_dir() {
            fs::create_dir(&to)?;
            copy_verified(&from, &to)?;
            #[cfg(unix)]
            fs::set_permissions(&to, metadata.permissions())?;
        } else if kind.is_file() {
            let mut input = fs::File::open(&from)?;
            let mut output = fs::OpenOptions::new().write(true).create_new(true).open(&to)?;
            std::io::copy(&mut input, &mut output)?;
            if let Ok(modified) = metadata.modified() {
                output.set_times(fs::FileTimes::new().set_modified(modified))?;
            }
            output.sync_all()?;
            drop(output);
            fs::set_permissions(&to, metadata.permissions())?;
            if metadata.len() != fs::metadata(&to)?.len() || sha1_file(&from)? != sha1_file(&to)? {
                return Err(AppError::invalid(coded!("errors.storage.copyVerification", path = from.display())));
            }
        } else if kind.is_symlink() {
            return Err(link_error(&from));
        } else {
            return Err(AppError::invalid(coded!("errors.storage.copyVerification", path = from.display())));
        }
    }
    Ok(())
}

/// A same-volume rename preserves WebView preferences and launcher identity without merging foreign data.
/// Returns why nothing was moved when the source is a link or both folders are populated: the destination is
/// then used as it is and the source stays untouched.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn migrate_directory(source: &Path, destination: &Path) -> AppResult<Option<String>> {
    if none_if_missing(fs::symlink_metadata(source))?.is_none() {
        return Ok(None);
    }
    if is_link(source)? || is_link(destination)? {
        return Ok(Some(format!("{} is a link and was not moved to {}; the latter is used as it is.", source.display(), destination.display())));
    }
    if resolve(source)? == resolve(destination)? {
        return Ok(None);
    }
    if destination.exists() {
        if fs::read_dir(source)?.next().transpose()?.is_none() {
            return Ok(None);
        }
        if fs::read_dir(destination)?.next().transpose()?.is_some() {
            return Ok(Some(format!(
                "Both {} and {} contain launcher data. They were not merged: {} is used and {} was left untouched. Move anything you still need by hand.",
                source.display(), destination.display(), destination.display(), source.display()
            )));
        }
        fs::remove_dir(destination)?;
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(source, destination)?;
    Ok(None)
}

/// Moves the metadata and WebView profile of the old identifier-named folders to the readable ones.
///
/// The metadata move is required: an I/O failure stops startup so no empty library is opened beside the real
/// one. Two populated folders, or a link, never stop it: nothing is merged or moved and the readable folder is
/// used, reported as a notice. The WebView profile only holds preferences; a failure keeps both folders and
/// starts it fresh. Handoff files that pointed inside the renamed metadata tree follow it (this also repairs an
/// interrupted run); a selection outside that tree is never rewritten.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn migrate_legacy_layout(legacy_data: &Path, data: &Path, legacy_webview: &Path, webview: &Path) -> AppResult<Vec<String>> {
    let mut notices = Vec::new();
    match migrate_directory(legacy_data, data)? {
        Some(notice) => notices.push(notice),
        None => {
            // Best effort and mostly lexical: this runs at every start, and a handoff file naming a missing drive
            // or an unreachable share must neither stop the start nor make the filesystem stall. The request
            // validation in `initialize` deals with such paths.
            let old = resolve(legacy_data).ok();
            let new = resolve(data).unwrap_or_else(|_| data.to_owned());
            for name in [CURRENT, REQUEST] {
                let file = data.join(name);
                let Ok(Some(path)) = read_path(&file) else { continue };
                let inside = path
                    .strip_prefix(legacy_data)
                    .ok()
                    .or_else(|| old.as_deref().and_then(|old| path.strip_prefix(old).ok()));
                if let Some(relative) = inside {
                    write_path(&file, &new.join(relative))?;
                }
            }
        }
    }
    match migrate_directory(legacy_webview, webview) {
        Ok(None) => {}
        Ok(Some(notice)) => tracing::warn!(%notice, "Old WebView profile left in place; the launcher starts with a fresh one"),
        Err(error) => tracing::warn!(%error, "Old WebView profile left in place; the launcher starts with a fresh one"),
    }
    Ok(notices)
}

/// `data` is `$DATA/Pumpkin Launcher`; `local` is `$LOCALDATA/Pumpkin Launcher/WebView`. Nothing else in the
/// program folder `$LOCALDATA/Pumpkin Launcher` is touched.
#[cfg(windows)]
pub(crate) fn migrate_windows_data(data: &Path, local: &Path) -> AppResult<Vec<String>> {
    let legacy_data = data.parent().ok_or_else(invalid_location)?.join(LEGACY_IDENTIFIER);
    let legacy_local = local.parent().and_then(Path::parent).ok_or_else(invalid_location)?.join(LEGACY_IDENTIFIER);
    migrate_legacy_layout(&legacy_data, data, &legacy_local.join("EBWebView"), &local.join("EBWebView"))
}

/// The path to hand to the system opener, if it is one the UI may open: an instance's game folder, a world
/// below its `saves`, a screenshot, a crash report or the latest log of a known instance. Everything is
/// compared in canonical form and must stay inside the instance root, so links cannot lead elsewhere.
pub(crate) fn instance_open_path(dirs: &Dirs, instances: &[crate::models::Instance], requested: &Path) -> AppResult<PathBuf> {
    let denied = || AppError::invalid(coded!("errors.storage.openNotAllowed", path = requested.display()));
    let root = resolve(&dirs.instances_dir())?;
    // Before touching the filesystem: a path on another volume or share is never inside the library, and probing
    // an arbitrary network path from a webview-supplied string must not happen.
    if volume_key(requested) != volume_key(&root) {
        return Err(denied());
    }
    let path = resolve(requested).map_err(|_| denied())?;
    if !path.starts_with(&root) {
        return Err(denied());
    }
    for instance in instances {
        let game = resolve(&dirs.game_dir(&instance.id))?;
        if !game.starts_with(&root) {
            continue;
        }
        if path == game && path.is_dir() {
            return Ok(path);
        }
        if path.parent() == Some(game.join("saves").as_path()) && path.is_dir()
            && fs::symlink_metadata(path.join("level.dat")).is_ok_and(|level| level.is_file())
        {
            return Ok(path);
        }
        let screenshot = path.parent() == Some(game.join("screenshots").as_path())
            && path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("png"));
        let crash = path.parent() == Some(game.join("crash-reports").as_path())
            && path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("txt"));
        if (screenshot || crash || path == game.join("logs/latest.log")) && path.is_file() {
            return Ok(path);
        }
    }
    Err(denied())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::testutil::write_files;

    fn temp() -> PathBuf {
        std::env::temp_dir().join(crate::models::new_id())
    }

    /// A library with the instance `i` (listed in `instances.json`) below the launcher data folder.
    fn fixture() -> (PathBuf, Dirs) {
        let root = temp();
        let dirs = Dirs::new(root.join("metadata"));
        fs::create_dir_all(&dirs.root).unwrap();
        initialize(&dirs, None).unwrap();
        write_files(&dirs.root, &[(INSTANCES_FILE, r#"[{"id":"i"}]"#)]);
        write_files(&dirs.instances_dir(), &[("i/minecraft/saves/世界/level.dat", "world"), ("i/installed", "ready"), ("i/backups/a.zip", "backup"), ("i/session-logs/a.log", "log")]);
        (root, dirs)
    }

    fn no_staging_left(parent: &Path) -> bool {
        fs::read_dir(parent).unwrap().flatten().all(|entry| !entry.file_name().to_string_lossy().starts_with(STAGING_PREFIX))
    }

    fn staging_name() -> String {
        format!("{STAGING_PREFIX}{}", crate::models::new_id())
    }

    #[cfg(unix)]
    fn link_dir(link: &Path, target: &Path) {
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    /// A junction needs no special rights, unlike a symlink.
    #[cfg(windows)]
    fn link_dir(link: &Path, target: &Path) {
        use std::os::windows::process::CommandExt;
        let output = std::process::Command::new("cmd")
            .args(["/S", "/C"])
            .raw_arg(format!("\"mklink /J \"{}\" \"{}\"\"", link.display(), target.display()))
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
    }

    #[test]
    fn relocation_preserves_all_files_shared_clones_and_reload_with_unicode_spaces() {
        let (root, dirs) = fixture();
        let shared = dirs.clone();
        let target = root.join("Spiele 世界");
        assert!(relocate(&dirs, &target).unwrap().is_none());
        assert_eq!(shared.instances_dir(), dirs.instances_dir());
        assert_eq!(fs::read_to_string(dirs.game_dir("i").join("saves/世界/level.dat")).unwrap(), "world");
        for name in ["installed", "backups/a.zip", "session-logs/a.log"] { assert!(dirs.instance("i").join(name).is_file()); }
        let reload = Dirs::new(&dirs.root);
        initialize(&reload, None).unwrap();
        assert_eq!(reload.instances_dir(), dirs.instances_dir());
        assert!(!dirs.root.join("instances").exists());
        assert!(no_staging_left(&root) && !dirs.root.join(STAGING_MARKER).exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn relocation_may_use_an_empty_folder_the_user_made() {
        let (root, dirs) = fixture();
        let target = root.join("Leer");
        fs::create_dir(&target).unwrap();
        assert!(relocate(&dirs, &target).unwrap().is_none());
        assert!(dirs.installed_marker("i").is_file() && dirs.instance("i").starts_with(resolve(&target).unwrap()));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn only_listed_instance_folders_move_and_everything_else_stays_put() {
        let (root, dirs) = fixture();
        let source = dirs.instances_dir();
        write_files(&source, &[("stray.txt", "mine"), ("Unbekannt/daten", "other"), ("j/minecraft/x", "not listed")]);
        let target = root.join("Neu");
        assert_eq!(relocate(&dirs, &target).unwrap(), Some(source.clone()));
        assert!(dirs.installed_marker("i").is_file());
        assert!(fs::read_dir(dirs.instances_dir()).unwrap().count() == 1);
        assert!(!source.join("i").exists());
        for kept in ["stray.txt", "Unbekannt/daten", "j/minecraft/x"] {
            assert!(source.join(kept).is_file(), "{kept}");
        }
        assert_eq!(read_path(&dirs.root.join(CURRENT)).unwrap(), Some(dirs.instances_dir()));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn an_unreadable_instances_file_stops_the_move() {
        let (root, dirs) = fixture();
        fs::write(dirs.root.join(INSTANCES_FILE), "{ kaputt").unwrap();
        assert!(relocate(&dirs, &root.join("Neu")).is_err());
        assert!(dirs.installed_marker("i").exists() && !root.join("Neu").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn nested_occupied_and_metadata_destinations_leave_source_unchanged() {
        let (root, dirs) = fixture();
        let source = dirs.instances_dir();
        write_files(&root, &[("occupied/foreign", "keep")]);
        for target in [source.join("nested"), root.clone(), dirs.root.clone(), dirs.root.join("friends"), root.join("occupied")] {
            assert!(relocate(&dirs, &target).is_err(), "{}", target.display());
            assert_eq!(dirs.instances_dir(), source);
            assert!(source.join("i/installed").exists());
        }
        assert!(root.join("occupied/foreign").exists());
        assert!(no_staging_left(&root));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn program_folder_and_its_parents_are_refused() {
        let (root, dirs) = fixture();
        let program = std::env::current_exe().unwrap().parent().unwrap().to_owned();
        for target in [program.clone(), program.join("daten"), program.parent().unwrap().to_owned()] {
            assert!(relocate(&dirs, &target).is_err(), "{}", target.display());
        }
        assert!(dirs.installed_marker("i").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_config_commit_rolls_back_destination_without_losing_source() {
        let (root, dirs) = fixture();
        fs::remove_file(dirs.root.join(CURRENT)).unwrap();
        fs::create_dir(dirs.root.join(CURRENT)).unwrap();
        let target = root.join("target");
        assert!(relocate(&dirs, &target).is_err());
        assert!(dirs.installed_marker("i").exists());
        assert!(!target.exists());
        assert!(no_staging_left(&root) && !dirs.root.join(STAGING_MARKER).exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rollback_keeps_the_empty_folder_the_user_made() {
        let (root, dirs) = fixture();
        fs::remove_file(dirs.root.join(CURRENT)).unwrap();
        fs::create_dir(dirs.root.join(CURRENT)).unwrap();
        let target = root.join("Meine Spiele");
        fs::create_dir(&target).unwrap();
        assert!(relocate(&dirs, &target).is_err());
        assert!(target.is_dir() && fs::read_dir(&target).unwrap().next().is_none());
        assert!(dirs.installed_marker("i").exists());
        assert!(no_staging_left(&root));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn links_inside_the_library_reject_the_move_and_change_nothing() {
        let (root, dirs) = fixture();
        link_dir(&dirs.instance("i").join("link"), &dirs.root);
        let target = root.join("target");
        assert!(relocate(&dirs, &target).is_err());
        assert!(!target.exists() && dirs.installed_marker("i").exists());
        assert!(dirs.root.join(INSTANCES_FILE).exists());
        assert!(no_staging_left(&root));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_linked_destination_is_refused() {
        let (root, dirs) = fixture();
        let elsewhere = root.join("elsewhere");
        fs::create_dir(&elsewhere).unwrap();
        let linked = root.join("linked");
        link_dir(&linked, &elsewhere);
        assert!(relocate(&dirs, &linked).is_err());
        assert!(fs::read_dir(&elsewhere).unwrap().next().is_none() && dirs.installed_marker("i").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_running_world_blocks_the_move_until_it_is_closed() {
        let (root, dirs) = fixture();
        let lock = dirs.game_dir("i").join("saves/世界/session.lock");
        fs::write(&lock, "x").unwrap();
        let held = fs::File::open(&lock).unwrap();
        held.try_lock().unwrap();
        let target = root.join("target");
        assert!(relocate(&dirs, &target).is_err());
        assert!(dirs.installed_marker("i").exists() && !target.exists());
        drop(held);
        assert!(relocate(&dirs, &target).unwrap().is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_complete_copy_left_by_an_interrupted_move_is_adopted() {
        let (root, dirs) = fixture();
        let source = dirs.instances_dir();
        let target = root.join("Kopie");
        fs::create_dir(&target).unwrap();
        fs::create_dir(target.join("i")).unwrap();
        copy_verified(&source.join("i"), &target.join("i")).unwrap();
        assert!(relocate(&dirs, &target).unwrap().is_none());
        assert_eq!(dirs.instances_dir(), resolve(&target).unwrap());
        assert!(!source.exists());
        assert_eq!(fs::read_to_string(dirs.game_dir("i").join("saves/世界/level.dat")).unwrap(), "world");
        assert_eq!(read_path(&dirs.root.join(CURRENT)).unwrap(), Some(dirs.instances_dir()));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_different_or_partial_folder_is_never_adopted() {
        let (root, dirs) = fixture();
        let source = dirs.instances_dir();
        let copy_to = |name: &str| {
            let target = root.join(name);
            fs::create_dir_all(target.join("i")).unwrap();
            copy_verified(&source.join("i"), &target.join("i")).unwrap();
            target
        };
        let (changed, resized, extra, foreign, missing) = (copy_to("a"), copy_to("b"), copy_to("c"), copy_to("d"), copy_to("e"));
        // Same length, different bytes: only the hash tells them apart.
        fs::write(changed.join("i/installed"), "READY").unwrap();
        fs::write(resized.join("i/installed"), "different length").unwrap();
        fs::write(extra.join("i/extra"), "more").unwrap();
        fs::write(foreign.join("foreign"), "x").unwrap();
        fs::remove_file(missing.join("i/installed")).unwrap();
        for target in [changed, resized, extra, foreign, missing] {
            assert!(relocate(&dirs, &target).is_err(), "{}", target.display());
            assert_eq!(dirs.instances_dir(), source);
            assert_eq!(fs::read_to_string(source.join("i/installed")).unwrap(), "ready");
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pending_request_is_committed() {
        let (root, dirs) = fixture();
        let target = root.join("target");
        write_path(&dirs.root.join(REQUEST), &target).unwrap();
        assert!(initialize(&dirs, None).unwrap().is_empty());
        assert!(!dirs.root.join(REQUEST).exists() && !dirs.root.join(REQUEST_REJECTED).exists());
        assert!(dirs.installed_marker("i").exists() && dirs.instance("i").starts_with(resolve(&target).unwrap()));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_request_that_cannot_be_applied_never_blocks_startup() {
        let (root, dirs) = fixture();
        let current = dirs.instances_dir();
        write_files(&root, &[("occupied/foreign", "keep")]);
        let occupied = root.join("occupied");
        let nested = current.join("nested");
        let broken = ["not a handoff file", "too large", "occupied destination", "inside the library"];
        for name in broken {
            let file = dirs.root.join(REQUEST);
            match name {
                "not a handoff file" => fs::write(&file, b"junk").unwrap(),
                "too large" => fs::write(&file, vec![0u8; 70 * 1024]).unwrap(),
                "occupied destination" => write_path(&file, &occupied).unwrap(),
                _ => write_path(&file, &nested).unwrap(),
            }
            let notices = initialize(&dirs, None).unwrap_or_else(|error| panic!("{name}: {error}"));
            assert_eq!(notices.len(), 1, "{name}: {notices:?}");
            // One language, one sentence end: no foreign error text and no doubled period.
            assert!(notices[0].is_ascii() && !notices[0].contains(".."), "{name}: {notices:?}");
            assert!(!dirs.root.join(REQUEST).exists() && dirs.root.join(REQUEST_REJECTED).is_file(), "{name}");
            assert_eq!(dirs.instances_dir(), current, "{name}");
            assert!(dirs.installed_marker("i").exists() && root.join("occupied/foreign").exists(), "{name}");
        }
        assert_eq!(read_path(&dirs.root.join(CURRENT)).unwrap(), Some(current));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_file_is_no_location_and_a_folder_with_content_is_occupied() {
        let (root, dirs) = fixture();
        write_files(&root, &[("datei.txt", "x"), ("voll/x", "y")]);
        assert_eq!(relocate(&dirs, &root.join("datei.txt")).unwrap_err().key(), Some("errors.storage.invalidLocation"));
        assert_eq!(relocate(&dirs, &root.join("voll")).unwrap_err().key(), Some("errors.storage.occupiedLocation"));
        assert!(dirs.installed_marker("i").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_first_location_that_cannot_be_created_is_rejected_and_the_default_used() {
        let root = temp();
        let dirs = Dirs::new(root.join("metadata"));
        fs::create_dir_all(&dirs.root).unwrap();
        write_files(&root, &[("datei.txt", "im Weg")]);
        let default = root.join("Documents/Pumpkin Launcher/Instances");
        write_path(&dirs.root.join(REQUEST), &root.join("datei.txt/Spiele")).unwrap();
        let notices = initialize(&dirs, Some(&default)).unwrap();
        assert_eq!(notices.len(), 1, "{notices:?}");
        assert!(dirs.root.join(REQUEST_REJECTED).is_file() && !dirs.root.join(REQUEST).exists());
        assert_eq!(dirs.instances_dir(), resolve(&default).unwrap());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_default_location_that_cannot_be_created_falls_back_to_the_launcher_data() {
        let root = temp();
        let dirs = Dirs::new(root.join("metadata"));
        fs::create_dir_all(&dirs.root).unwrap();
        write_files(&root, &[("datei.txt", "im Weg")]);
        let notices = initialize(&dirs, Some(&root.join("datei.txt/Pumpkin Launcher/Instances"))).unwrap();
        assert_eq!(notices.len(), 1, "{notices:?}");
        assert!(!notices[0].contains("..") && !notices[0].contains("Fehler"), "{notices:?}");
        assert_eq!(dirs.instances_dir(), resolve(&dirs.root.join("instances")).unwrap());
        assert!(dirs.instances_dir().is_dir());
        assert_eq!(read_path(&dirs.root.join(CURRENT)).unwrap(), Some(dirs.instances_dir()));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_read_only_parent_of_the_default_falls_back_like_any_other_failure() {
        use std::os::unix::fs::PermissionsExt;
        let root = temp();
        let dirs = Dirs::new(root.join("metadata"));
        fs::create_dir_all(&dirs.root).unwrap();
        let documents = root.join("Documents");
        fs::create_dir(&documents).unwrap();
        fs::set_permissions(&documents, fs::Permissions::from_mode(0o555)).unwrap();
        let writable_anyway = fs::create_dir(documents.join("probe")).is_ok();
        let notices = initialize(&dirs, Some(&documents.join("Pumpkin Launcher/Instances"))).unwrap();
        fs::set_permissions(&documents, fs::Permissions::from_mode(0o755)).unwrap();
        // Running with rights that ignore permissions (root): nothing can fail, so there is nothing to check.
        if !writable_anyway {
            assert_eq!(notices.len(), 1, "{notices:?}");
            assert_eq!(dirs.instances_dir(), resolve(&dirs.root.join("instances")).unwrap());
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_request_blocked_by_a_running_game_is_kept_for_the_next_start() {
        let (root, dirs) = fixture();
        let lock = dirs.game_dir("i").join("saves/世界/session.lock");
        fs::write(&lock, "x").unwrap();
        let held = fs::File::open(&lock).unwrap();
        held.try_lock().unwrap();
        let target = root.join("target");
        write_path(&dirs.root.join(REQUEST), &target).unwrap();
        let notices = initialize(&dirs, None).unwrap();
        assert_eq!(notices.len(), 1, "{notices:?}");
        assert!(dirs.root.join(REQUEST).is_file() && !dirs.root.join(REQUEST_REJECTED).exists());
        assert!(dirs.installed_marker("i").exists() && !target.exists());
        drop(held);
        assert!(initialize(&dirs, None).unwrap().is_empty());
        assert!(!dirs.root.join(REQUEST).exists() && dirs.instance("i").starts_with(resolve(&target).unwrap()));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn handoff_paths_outside_the_legacy_tree_are_left_alone_without_resolving_them() {
        let root = temp();
        let (legacy_data, data) = (root.join("Roaming/dev.laux.launcher"), root.join("Roaming/Pumpkin Launcher"));
        let (legacy_webview, webview) = (root.join("Local/dev.laux.launcher/EBWebView"), root.join("Local/Pumpkin Launcher/WebView/EBWebView"));
        fs::create_dir_all(&data).unwrap();
        let (current, request) = (root.join("Gibt es nicht/Instanzen"), root.join("Auch nicht"));
        write_path(&data.join(CURRENT), &current).unwrap();
        write_path(&data.join(REQUEST), &request).unwrap();
        let before = (fs::read(data.join(CURRENT)).unwrap(), fs::read(data.join(REQUEST)).unwrap());
        assert!(migrate_legacy_layout(&legacy_data, &data, &legacy_webview, &webview).unwrap().is_empty());
        assert_eq!((fs::read(data.join(CURRENT)).unwrap(), fs::read(data.join(REQUEST)).unwrap()), before);
        fs::remove_dir_all(root).unwrap();
    }

    /// A request or selection on a drive that is not there (unplugged disk) must not stop the start that runs the
    /// migration every time; only the request is then rejected by `initialize`.
    #[cfg(windows)]
    #[test]
    fn a_request_on_an_absent_drive_never_stops_the_migration_or_the_start() {
        let root = temp();
        let (legacy_data, data) = (root.join("Roaming/dev.laux.launcher"), root.join("Roaming/Pumpkin Launcher"));
        let (legacy_webview, webview) = (root.join("Local/dev.laux.launcher/EBWebView"), root.join("Local/Pumpkin Launcher/WebView/EBWebView"));
        fs::create_dir_all(&data).unwrap();
        let drive = ('D'..='Z').rev().map(|letter| format!(r"{letter}:\")).find(|drive| !Path::new(drive).exists()).unwrap();
        let target = PathBuf::from(format!(r"{drive}Spiele"));
        write_path(&data.join(REQUEST), &target).unwrap();
        write_path(&data.join(CURRENT), &target).unwrap();
        let before = (fs::read(data.join(CURRENT)).unwrap(), fs::read(data.join(REQUEST)).unwrap());

        assert!(migrate_legacy_layout(&legacy_data, &data, &legacy_webview, &webview).unwrap().is_empty());
        assert_eq!((fs::read(data.join(CURRENT)).unwrap(), fs::read(data.join(REQUEST)).unwrap()), before);

        // An unreachable stored location stays fatal by design; the request alone is only rejected.
        fs::remove_file(data.join(CURRENT)).unwrap();
        let dirs = Dirs::new(&data);
        let notices = initialize(&dirs, None).unwrap();
        assert_eq!(notices.len(), 1, "{notices:?}");
        assert!(data.join(REQUEST_REJECTED).is_file() && !data.join(REQUEST).exists());
        assert_eq!(dirs.instances_dir(), resolve(&data.join("instances")).unwrap());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refused_open_paths_report_the_open_error_and_never_probe_other_volumes() {
        let (root, dirs) = fixture();
        let key = |path: &Path| instance_open_path(&dirs, &[], path).unwrap_err().key();
        assert_eq!(key(Path::new("relativ/x")), Some("errors.storage.openNotAllowed"));
        assert_eq!(key(&dirs.root.join("accounts.json")), Some("errors.storage.openNotAllowed"));
        #[cfg(windows)]
        {
            assert_eq!(key(Path::new(r"\\pumpkin-unreachable.invalid\share\x")), Some("errors.storage.openNotAllowed"));
            assert_eq!(volume_key(Path::new(r"\\?\C:\a")), volume_key(Path::new(r"c:\b")));
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_request_naming_the_current_location_is_consumed() {
        let (root, dirs) = fixture();
        write_path(&dirs.root.join(REQUEST), &dirs.instances_dir()).unwrap();
        assert!(initialize(&dirs, None).unwrap().is_empty());
        assert!(!dirs.root.join(REQUEST).exists() && !dirs.root.join(REQUEST_REJECTED).exists());
        assert!(dirs.installed_marker("i").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_request_on_a_fresh_install_names_the_first_library_without_creating_the_default() {
        let root = temp();
        let dirs = Dirs::new(root.join("metadata"));
        fs::create_dir_all(&dirs.root).unwrap();
        let target = root.join("Meine Spiele 世界");
        let default = root.join("Documents/Pumpkin Launcher/Instances");
        write_path(&dirs.root.join(REQUEST), &target).unwrap();
        assert!(initialize(&dirs, Some(&default)).unwrap().is_empty());
        assert_eq!(dirs.instances_dir(), resolve(&target).unwrap());
        assert!(target.is_dir() && !default.exists() && !dirs.root.join(REQUEST).exists());
        assert_eq!(read_path(&dirs.root.join(CURRENT)).unwrap(), Some(dirs.instances_dir()));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn an_unusable_request_on_a_fresh_install_falls_back_to_the_default() {
        let root = temp();
        let dirs = Dirs::new(root.join("metadata"));
        fs::create_dir_all(&dirs.root).unwrap();
        write_files(&root, &[("occupied/foreign", "keep")]);
        let default = root.join("Documents/Pumpkin Launcher/Instances");
        write_path(&dirs.root.join(REQUEST), &root.join("occupied")).unwrap();
        assert_eq!(initialize(&dirs, Some(&default)).unwrap().len(), 1);
        assert_eq!(dirs.instances_dir(), resolve(&default).unwrap());
        assert!(dirs.root.join(REQUEST_REJECTED).is_file() && root.join("occupied/foreign").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn fresh_libraries_use_the_default_but_existing_ones_keep_their_location() {
        let root = temp();
        let default = root.join("Documents/Pumpkin Launcher/Instances");
        let fresh = Dirs::new(root.join("fresh"));
        fs::create_dir_all(&fresh.root).unwrap();
        initialize(&fresh, Some(&default)).unwrap();
        assert_eq!(fresh.instances_dir(), resolve(&default).unwrap());
        assert!(default.is_dir());

        let existing = Dirs::new(root.join("existing"));
        write_files(&existing.root, &[(INSTANCES_FILE, "[]")]);
        initialize(&existing, Some(&root.join("Documents/Other"))).unwrap();
        assert_eq!(existing.instances_dir(), resolve(&existing.root.join("instances")).unwrap());
        assert!(!root.join("Documents/Other").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_missing_stored_location_fails_closed_without_recreating_it() {
        let (root, dirs) = fixture();
        let target = root.join("Externe Platte");
        relocate(&dirs, &target).unwrap();
        fs::remove_dir_all(&target).unwrap();
        let reload = Dirs::new(&dirs.root);
        assert!(initialize(&reload, None).is_err());
        assert!(!target.exists() && !dirs.root.join("instances").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_stored_location_around_the_launcher_or_program_is_refused_and_nothing_is_deleted() {
        let (root, dirs) = fixture();
        let program = std::env::current_exe().unwrap().parent().unwrap().to_owned();
        for unsafe_location in [root.clone(), dirs.root.clone(), dirs.root.join("friends"), program] {
            fs::create_dir_all(&unsafe_location).unwrap();
            write_path(&dirs.root.join(CURRENT), &unsafe_location).unwrap();
            let reload = Dirs::new(&dirs.root);
            assert!(initialize(&reload, None).is_err(), "{}", unsafe_location.display());
            assert!(dirs.root.join(INSTANCES_FILE).is_file() && dirs.root.join("instances/i/installed").is_file());
        }
        // The launcher's own default location stays valid.
        write_path(&dirs.root.join(CURRENT), &dirs.root.join("instances")).unwrap();
        initialize(&Dirs::new(&dirs.root), None).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn leftovers_of_an_unfinished_copy_are_swept_but_lookalikes_are_not() {
        let (root, dirs) = fixture();
        let (beside_library, elsewhere) = (dirs.root.join(staging_name()), root.join("andernorts").join(staging_name()));
        write_files(&beside_library, &[("i/installed", "half")]);
        write_files(&elsewhere, &[("i/installed", "half")]);
        write_path(&dirs.root.join(STAGING_MARKER), &elsewhere).unwrap();
        let (lookalike, a_file) = (dirs.root.join(format!("{STAGING_PREFIX}notes")), dirs.root.join(staging_name()));
        write_files(&lookalike, &[("keep", "x")]);
        fs::write(&a_file, "keep").unwrap();

        initialize(&dirs, None).unwrap();

        assert!(!beside_library.exists() && !elsewhere.exists() && !dirs.root.join(STAGING_MARKER).exists());
        assert!(lookalike.join("keep").exists() && a_file.is_file());
        assert!(dirs.installed_marker("i").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_marker_naming_anything_but_a_staging_folder_is_ignored() {
        let (root, dirs) = fixture();
        let lookalike = root.join("Spiele").join(format!("{STAGING_PREFIX}spiele"));
        write_files(&lookalike, &[("keep", "x")]);
        for named in [dirs.instances_dir(), dirs.root.clone(), root.clone(), lookalike.clone()] {
            write_path(&dirs.root.join(STAGING_MARKER), &named).unwrap();
            initialize(&dirs, None).unwrap();
            assert!(dirs.installed_marker("i").exists() && dirs.root.join(INSTANCES_FILE).exists());
            assert!(lookalike.join("keep").exists() && !dirs.root.join(STAGING_MARKER).exists());
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn handoff_files_are_small_regular_files_with_a_bom_one_absolute_path_and_one_line() {
        let root = temp();
        fs::create_dir(&root).unwrap();
        let file = root.join(CURRENT);
        fs::write(&file, b"relative\r\n").unwrap();
        assert!(read_path(&file).is_err());
        assert!(write_path(&file, Path::new("relative")).is_err());
        write_path(&file, &root.join("Spiele 世界")).unwrap();
        assert_eq!(read_path(&file).unwrap(), Some(root.join("Spiele 世界")));
        fs::write(&file, vec![0u8; 100 * 1024]).unwrap();
        assert!(read_path(&file).is_err());
        fs::remove_file(&file).unwrap();
        fs::create_dir(&file).unwrap();
        assert!(read_path(&file).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_linked_handoff_file_is_not_followed() {
        let root = temp();
        fs::create_dir(&root).unwrap();
        write_path(&root.join("real.txt"), &root.join("Spiele")).unwrap();
        std::os::unix::fs::symlink(root.join("real.txt"), root.join(REQUEST)).unwrap();
        assert!(read_path(&root.join(REQUEST)).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn only_drives_and_foreign_network_shares_are_accepted_on_windows() {
        for good in [r"C:\Spiele 世界", r"\\?\C:\Spiele", r"\\server\share\Spiele"] {
            assert!(validate_absolute(Path::new(good)).is_ok(), "{good}");
        }
        for bad in [r"\\.\C:\Spiele", r"\\.\UNC\server\share\x", r"\\?\GLOBALROOT\Device\x", r"\\localhost\C$\Spiele", r"\\127.0.0.1\C$\x", r"\\.\x", r"C:\a\..\b", r"C:\Spiele\CON", r"C:\Spiele\a:b"] {
            assert!(validate_absolute(Path::new(bad)).is_err(), "{bad}");
        }
        if let Ok(name) = std::env::var("COMPUTERNAME") {
            assert!(validate_absolute(Path::new(&format!(r"\\{name}\C$\Spiele"))).is_err());
        }
    }

    #[test]
    fn resolved_paths_of_existing_files_stay_usable_and_use_one_separator_style() {
        let root = temp();
        write_files(&root, &[("a/b.txt", "x")]);
        let file = resolve(&root.join("a/b.txt")).unwrap();
        assert!(file.is_file());
        assert!(!file.as_os_str().to_string_lossy().ends_with(std::path::MAIN_SEPARATOR));
        let missing = resolve(&root.join("a/neu/ordner")).unwrap();
        assert!(missing.ends_with(Path::new("neu").join("ordner")) && !missing.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn legacy_metadata_and_webview_are_never_merged() {
        let root = temp();
        let old = root.join("dev.laux.launcher");
        let new = root.join("Pumpkin Launcher");
        write_files(&old, &[("accounts.json", "account"), ("instances/i/minecraft/saves/world/level.dat", "world")]);
        write_files(&new, &[("foreign", "keep")]);
        assert!(migrate_directory(&old, &new).unwrap().is_some());
        assert!(old.join("accounts.json").exists() && new.join("foreign").exists());
        fs::remove_dir_all(&new).unwrap();
        assert!(migrate_directory(&old, &new).unwrap().is_none());
        assert!(new.join("instances/i/minecraft/saves/world/level.dat").exists());
        assert!(!old.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_linked_legacy_folder_is_not_moved() {
        let root = temp();
        let (target, old, new) = (root.join("real"), root.join("dev.laux.launcher"), root.join("Pumpkin Launcher"));
        write_files(&target, &[("accounts.json", "account")]);
        link_dir(&old, &target);
        assert!(migrate_directory(&old, &new).unwrap().is_some());
        assert!(!new.exists() && target.join("accounts.json").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn legacy_layout_moves_whole_trees_and_rewrites_only_paths_inside_the_legacy_tree() {
        let root = temp();
        let (legacy_data, data) = (root.join("Roaming/dev.laux.launcher"), root.join("Roaming/Pumpkin Launcher"));
        let (legacy_webview, webview) = (root.join("Local/dev.laux.launcher/EBWebView"), root.join("Local/Pumpkin Launcher/WebView/EBWebView"));
        write_files(&legacy_data, &[("accounts.json", "account"), ("instances/i/minecraft/saves/w/level.dat", "world")]);
        write_files(&legacy_webview, &[("Default/Preferences", "prefs")]);
        write_path(&legacy_data.join(CURRENT), &legacy_data.join("instances")).unwrap();
        write_path(&legacy_data.join(REQUEST), &root.join("Externe Spiele")).unwrap();

        assert!(migrate_legacy_layout(&legacy_data, &data, &legacy_webview, &webview).unwrap().is_empty());

        assert_eq!(fs::read_to_string(data.join("accounts.json")).unwrap(), "account");
        assert!(data.join("instances/i/minecraft/saves/w/level.dat").is_file());
        assert_eq!(fs::read_to_string(webview.join("Default/Preferences")).unwrap(), "prefs");
        assert!(!legacy_data.exists() && !legacy_webview.exists());
        assert_eq!(read_path(&data.join(CURRENT)).unwrap(), Some(resolve(&data).unwrap().join("instances")));
        assert_eq!(read_path(&data.join(REQUEST)).unwrap(), Some(root.join("Externe Spiele")));
        // A second run, or one after an interrupted run, changes nothing.
        assert!(migrate_legacy_layout(&legacy_data, &data, &legacy_webview, &webview).unwrap().is_empty());
        assert_eq!(fs::read_to_string(data.join("accounts.json")).unwrap(), "account");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn populated_profiles_never_merge_and_never_stop_startup() {
        let root = temp();
        let (legacy_data, data) = (root.join("Roaming/dev.laux.launcher"), root.join("Roaming/Pumpkin Launcher"));
        let (legacy_webview, webview) = (root.join("Local/dev.laux.launcher/EBWebView"), root.join("Local/Pumpkin Launcher/WebView/EBWebView"));
        write_files(&legacy_data, &[("accounts.json", "old")]);
        write_files(&data, &[("accounts.json", "new")]);
        let notices = migrate_legacy_layout(&legacy_data, &data, &legacy_webview, &webview).unwrap();
        assert_eq!(notices.len(), 1);
        assert_eq!(fs::read_to_string(legacy_data.join("accounts.json")).unwrap(), "old");
        assert_eq!(fs::read_to_string(data.join("accounts.json")).unwrap(), "new");

        write_files(&legacy_webview, &[("Default/Preferences", "old")]);
        write_files(&webview, &[("Default/Preferences", "new")]);
        migrate_legacy_layout(&legacy_data, &data, &legacy_webview, &webview).unwrap();
        assert_eq!(fs::read_to_string(legacy_webview.join("Default/Preferences")).unwrap(), "old");
        assert_eq!(fs::read_to_string(webview.join("Default/Preferences")).unwrap(), "new");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn open_paths_are_limited_to_known_instances_and_their_user_files() {
        let (root, dirs) = fixture();
        let instance = crate::models::Instance { id: "i".into(), ..crate::models::Instance::from_new(crate::models::NewInstance {
            name: "I".into(),
            minecraft_version: "1.21.1".into(),
            loader: crate::models::ModLoader::Vanilla,
            loader_version: None,
        }) };
        let game = dirs.game_dir("i");
        write_files(&game, &[("screenshots/a.png", "p"), ("screenshots/a.txt", "t"), ("crash-reports/c.txt", "c"), ("crash-reports/c.png", "p"), ("logs/latest.log", "l"), ("saves/leer/readme", "x")]);
        let instances = [instance];
        for allowed in [game.clone(), game.join("saves/世界"), game.join("screenshots/a.png"), game.join("crash-reports/c.txt"), game.join("logs/latest.log")] {
            assert!(instance_open_path(&dirs, &instances, &allowed).is_ok(), "{}", allowed.display());
        }
        for denied in [game.join("screenshots/a.txt"), game.join("crash-reports/c.png"), game.join("saves/leer"), game.join("saves/fehlt"), game.join("mods"), dirs.instance("i"), dirs.root.join("accounts.json"), game.join("screenshots/../../installed"), root.clone()] {
            assert!(instance_open_path(&dirs, &instances, &denied).is_err(), "{}", denied.display());
        }
        assert!(instance_open_path(&dirs, &[], &game).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn an_old_copy_that_cannot_be_deleted_is_reported_but_the_committed_move_stands() {
        use std::os::unix::fs::PermissionsExt;
        let (root, dirs) = fixture();
        let locked = dirs.instance("i").join("backups");
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o555)).unwrap();
        let unlock = || fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
        if fs::write(locked.join("probe"), "x").is_ok() {
            // Running with rights that ignore permissions (root): the deletion cannot be made to fail.
            unlock();
            fs::remove_dir_all(root).unwrap();
            return;
        }
        let target = root.join("target");
        let retained = relocate(&dirs, &target).unwrap();
        unlock();
        assert!(retained.is_some_and(|source| source.join("i/backups/a.zip").exists()));
        assert_eq!(dirs.instances_dir(), resolve(&target).unwrap());
        assert_eq!(read_path(&dirs.root.join(CURRENT)).unwrap(), Some(dirs.instances_dir()));
        assert_eq!(fs::read_to_string(dirs.instance("i").join("backups/a.zip")).unwrap(), "backup");
        // The copy keeps the source's directory modes, so the new backups folder is read-only too.
        fs::set_permissions(dirs.instance("i").join("backups"), fs::Permissions::from_mode(0o755)).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn directory_modes_survive_the_copy() {
        use std::os::unix::fs::PermissionsExt;
        let (root, dirs) = fixture();
        let mode = |path: PathBuf| fs::metadata(path).unwrap().permissions().mode() & 0o777;
        fs::set_permissions(dirs.instance("i"), fs::Permissions::from_mode(0o700)).unwrap();
        fs::set_permissions(dirs.instance("i").join("backups"), fs::Permissions::from_mode(0o750)).unwrap();
        let minecraft = mode(dirs.instance("i").join("minecraft"));
        relocate(&dirs, &root.join("target")).unwrap();
        assert_eq!(mode(dirs.instance("i")), 0o700);
        assert_eq!(mode(dirs.instance("i").join("backups")), 0o750);
        assert_eq!(mode(dirs.instance("i").join("minecraft")), minecraft);
        fs::remove_dir_all(root).unwrap();
    }
}
