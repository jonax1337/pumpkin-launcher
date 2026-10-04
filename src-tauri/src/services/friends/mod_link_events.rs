//! Was ein Vorgang aus dem Spiel an der Oberfläche des Launchers bewirkt (INGAME 5.4, 5.7), jenseits der Sitzungs-Ereignisse:
//! die Aktivitätsliste bekommt einen Eintrag, und `launcher.open` holt das Fenster nach vorn. Die Sitzungen kennen nur
//! [`ModAppEvents`]; in der App sendet [`TauriModAppEvents`] Tauri-Events, Tests zeichnen auf.
use std::sync::{Arc, RwLock};

use tauri::{AppHandle, Manager};

use crate::services::friends::contract::{ModActivityEntry, ModOpenEvent};
use crate::services::progress::emit;

pub trait ModAppEvents: Send + Sync + 'static {
    /// Ein `social`- oder `share`-Vorgang aus dem Spiel ist erledigt (Ereignis `friends-mod-activity`).
    fn activity(&self, entry: ModActivityEntry);
    /// Die Mod bittet um das Fenster des Launchers (Ereignis `friends-mod-open`); die Oberfläche zeigt `event.target`.
    fn open_launcher(&self, event: ModOpenEvent);
}

/// Verwirft alles, solange die App noch keinen Empfänger gesetzt hat.
pub struct NoModAppEvents;

impl ModAppEvents for NoModAppEvents {
    fn activity(&self, _entry: ModActivityEntry) {}

    fn open_launcher(&self, _event: ModOpenEvent) {}
}

pub struct TauriModAppEvents(pub AppHandle);

impl ModAppEvents for TauriModAppEvents {
    fn activity(&self, entry: ModActivityEntry) {
        emit(&self.0, "friends-mod-activity", entry);
    }

    fn open_launcher(&self, event: ModOpenEvent) {
        focus_main_window(&self.0);
        emit(&self.0, "friends-mod-open", event);
    }
}

fn focus_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };
    for result in [window.unminimize(), window.show(), window.set_focus()] {
        if let Err(err) = result {
            tracing::warn!(%err, "Fenster nicht nach vorn geholt");
        }
    }
}

/// Der Empfänger, austauschbar, damit die App ihn nach dem Bau der Sitzungen setzen kann.
pub(super) struct AppEventSink(RwLock<Arc<dyn ModAppEvents>>);

impl Default for AppEventSink {
    fn default() -> Self {
        Self(RwLock::new(Arc::new(NoModAppEvents)))
    }
}

impl AppEventSink {
    pub(super) fn set(&self, events: Arc<dyn ModAppEvents>) {
        *self.0.write().unwrap_or_else(|poisoned| poisoned.into_inner()) = events;
    }

    pub(super) fn get(&self) -> Arc<dyn ModAppEvents> {
        self.0.read().unwrap_or_else(|poisoned| poisoned.into_inner()).clone()
    }
}
