//! Vorgangssperren: an einer Instanz läuft höchstens ein Vorgang, Vorgänge an verschiedenen Instanzen laufen
//! gleichzeitig, und ein Vorgang an der ganzen Bibliothek schließt alle anderen aus. Gewartet wird nie: ein Konflikt
//! ist sofort `errors.operationRunning`.
use std::collections::HashSet;
use std::sync::Mutex;

use crate::coded;
use crate::error::{AppError, AppResult};
use crate::services::lock;

/// Was ein Vorgang sperrt.
#[derive(Debug)]
enum Scope {
    /// Eine Instanz, die es schon gibt.
    Instance(String),
    /// Eine Instanz, die der Vorgang erst anlegt: ihre ID steht noch nicht fest.
    Creation,
    /// Alle Instanzen samt ihren Ordnern und dem geteilten Cache.
    Library,
}

/// Wer gerade Vorgänge hält.
#[derive(Debug, Default)]
struct Held {
    library: bool,
    instances: HashSet<String>,
    creations: usize,
}

impl Held {
    fn admits(&self, scope: &Scope) -> bool {
        match scope {
            Scope::Instance(id) => !self.library && !self.instances.contains(id),
            Scope::Creation => !self.library,
            Scope::Library => !self.library && self.instances.is_empty() && self.creations == 0,
        }
    }

    fn add(&mut self, scope: &Scope) {
        match scope {
            Scope::Instance(id) => {
                self.instances.insert(id.clone());
            }
            Scope::Creation => self.creations += 1,
            Scope::Library => self.library = true,
        }
    }

    fn remove(&mut self, scope: &Scope) {
        match scope {
            Scope::Instance(id) => {
                self.instances.remove(id);
            }
            Scope::Creation => self.creations -= 1,
            Scope::Library => self.library = false,
        }
    }
}

/// Die Sperren aller Vorgänge der App; `AppState` hält sie.
#[derive(Debug, Default)]
pub struct OperationLocks {
    held: Mutex<Held>,
}

impl OperationLocks {
    /// Sperrt die Instanz `id`: scheitert, wenn an ihr schon ein Vorgang läuft oder einer die ganze Bibliothek sperrt.
    pub fn lock_instance(&self, id: &str) -> AppResult<OperationGuard<'_>> {
        self.acquire(Scope::Instance(id.to_owned()))
    }

    /// Für einen Vorgang, der eine neue Instanz anlegt: ohne Sperre anderer Instanzen, aber nie während ein Vorgang
    /// die ganze Bibliothek sperrt (etwa ein Umzug des Instanzordners).
    pub fn lock_creation(&self) -> AppResult<OperationGuard<'_>> {
        self.acquire(Scope::Creation)
    }

    /// Sperrt die ganze Bibliothek: scheitert, solange irgendein anderer Vorgang läuft, und lässt keinen beginnen.
    pub fn lock_library(&self) -> AppResult<OperationGuard<'_>> {
        self.acquire(Scope::Library)
    }

    fn acquire(&self, scope: Scope) -> AppResult<OperationGuard<'_>> {
        let mut held = lock(&self.held);
        if !held.admits(&scope) {
            return Err(AppError::invalid(coded!("errors.operationRunning")));
        }
        held.add(&scope);
        Ok(OperationGuard { locks: self, scope })
    }
}

/// Hält die Sperre eines Vorgangs, bis er fallen gelassen wird; über `await` hinweg darf er gehalten werden.
#[derive(Debug)]
#[must_use = "die Sperre gilt nur, solange der Guard lebt"]
pub struct OperationGuard<'a> {
    locks: &'a OperationLocks,
    scope: Scope,
}

impl Drop for OperationGuard<'_> {
    fn drop(&mut self) {
        lock(&self.locks.held).remove(&self.scope);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Barrier;

    use super::*;

    const RUNNING: &str = "errors.operationRunning";

    fn refusal(result: AppResult<OperationGuard<'_>>) -> Option<&'static str> {
        result.err().and_then(|error| error.key())
    }

    #[test]
    fn different_instances_are_locked_at_the_same_time() {
        let locks = OperationLocks::default();

        let a = locks.lock_instance("a");
        let b = locks.lock_instance("b");

        assert!(a.is_ok() && b.is_ok());
    }

    #[test]
    fn an_instance_is_locked_only_once() {
        let locks = OperationLocks::default();
        let _first = locks.lock_instance("a").unwrap();

        assert_eq!(refusal(locks.lock_instance("a")), Some(RUNNING));
    }

    #[test]
    fn dropping_the_guard_releases_the_instance() {
        let locks = OperationLocks::default();
        let first = locks.lock_instance("a").unwrap();

        drop(first);

        assert!(locks.lock_instance("a").is_ok());
    }

    #[test]
    fn creations_run_beside_each_other_and_beside_instances() {
        let locks = OperationLocks::default();
        let _instance = locks.lock_instance("a").unwrap();

        let first = locks.lock_creation();
        let second = locks.lock_creation();

        assert!(first.is_ok() && second.is_ok());
    }

    #[test]
    fn the_library_needs_every_instance_operation_to_end() {
        let locks = OperationLocks::default();
        let a = locks.lock_instance("a").unwrap();
        let b = locks.lock_instance("b").unwrap();

        assert_eq!(refusal(locks.lock_library()), Some(RUNNING));
        drop(a);
        assert_eq!(refusal(locks.lock_library()), Some(RUNNING));
        drop(b);
        assert!(locks.lock_library().is_ok());
    }

    #[test]
    fn the_library_needs_every_creation_to_end() {
        let locks = OperationLocks::default();
        let first = locks.lock_creation().unwrap();
        let second = locks.lock_creation().unwrap();

        drop(first);
        assert_eq!(refusal(locks.lock_library()), Some(RUNNING), "eine Anlage läuft noch");
        drop(second);
        assert!(locks.lock_library().is_ok());
    }

    #[test]
    fn a_locked_library_refuses_every_other_operation_until_it_is_released() {
        let locks = OperationLocks::default();
        let library = locks.lock_library().unwrap();

        assert_eq!(refusal(locks.lock_instance("a")), Some(RUNNING));
        assert_eq!(refusal(locks.lock_creation()), Some(RUNNING));
        assert_eq!(refusal(locks.lock_library()), Some(RUNNING));

        drop(library);
        assert!(locks.lock_instance("a").is_ok());
        assert!(locks.lock_creation().is_ok());
    }

    #[test]
    fn of_many_racing_threads_exactly_one_gets_the_instance() {
        const THREADS: usize = 8;
        let locks = OperationLocks::default();
        let start = Barrier::new(THREADS);
        let all_tried = Barrier::new(THREADS);
        let winners = AtomicUsize::new(0);

        std::thread::scope(|scope| {
            for _ in 0..THREADS {
                scope.spawn(|| {
                    start.wait();
                    let guard = locks.lock_instance("a");
                    winners.fetch_add(usize::from(guard.is_ok()), Ordering::SeqCst);
                    // Der Sieger hält die Sperre, bis alle es versucht haben.
                    all_tried.wait();
                });
            }
        });

        assert_eq!(winners.load(Ordering::SeqCst), 1);
        assert!(locks.lock_instance("a").is_ok(), "mit dem Ende der Threads sind die Sperren frei");
    }

    #[test]
    fn a_guard_can_be_held_across_await_points() {
        fn assert_send<T: Send>() {}
        assert_send::<OperationGuard<'static>>();
    }
}
