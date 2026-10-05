//! Die Warteschlange einer Verbindung zum Schreiben (docs/friends/INGAME.md, 5.3).
//!
//! Antworten gehen nie verloren und kommen in der Reihenfolge der Anfragen. Hinweise (Toasts) sind höchstens 32:
//! ein weiterer verdrängt den ältesten. Themen stehen nur als „hat sich geändert“ darin; den Wert holt der Schreiber,
//! wenn das Thema dran ist, und zwar den letzten. Das fasst schnelle Änderungen zu einer zusammen: ein Thema geht
//! frühestens `coalesce` nach seinem vorigen Stand hinaus. Insgesamt wartet höchstens `OUTGOING_QUEUE` darin.
use std::collections::{BTreeSet, HashMap, VecDeque};
use std::time::Duration;

use tokio::sync::Notify;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

use super::limits::{EVENT_QUEUE, OUTGOING_QUEUE};
use super::protocol::{Event, LauncherFrame};
use super::ops::ErrorCode;
use super::protocol::Response;
use super::topics::Topic;
use crate::services::lock;

/// Was als Nächstes an die Mod geht.
#[derive(Debug, PartialEq)]
pub(super) enum Outgoing {
    /// Eine fertige Nachricht: Antwort, `pending` oder Hinweis.
    Frame(LauncherFrame),
    FriendsFrame { frame: LauncherFrame, generation: u64 },
    /// Der aktuelle Wert des Themas.
    Topic(Topic),
}

#[derive(Debug, PartialEq)]
pub(super) enum Next {
    Send(Outgoing),
    /// Es wartet etwas, das erst zu diesem Zeitpunkt dran ist.
    WaitUntil(Instant),
    Idle,
    /// Die Warteschlange ist abgeschlossen und leer.
    Finished,
}

/// Die Warteschlange ist voll: die Mod liest zu langsam.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct Overflow;

pub(super) struct LinkQueue {
    state: std::sync::Mutex<State>,
    wake: Notify,
    coalesce: Duration,
}

#[derive(Default)]
struct State {
    replies: VecDeque<Outgoing>,
    events: VecDeque<Event>,
    dirty: BTreeSet<Topic>,
    last_sent: HashMap<Topic, Instant>,
    finishing: bool,
    friends_generation: u64,
    friends_disabled: bool,
    friends_stop: CancellationToken,
}

impl State {
    fn len(&self) -> usize {
        self.replies.len() + self.events.len() + self.dirty.len()
    }
}

impl LinkQueue {
    pub fn new(coalesce: Duration) -> Self {
        Self { state: std::sync::Mutex::default(), wake: Notify::new(), coalesce }
    }

    /// Reiht eine Antwort ein. Sie wird nie verdrängt; ist die Warteschlange trotzdem voll, liest die Mod nicht mehr.
    pub fn push_reply(&self, reply: LauncherFrame) -> Result<(), Overflow> {
        let mut state = lock(&self.state);
        if state.len() >= OUTGOING_QUEUE {
            return Err(Overflow);
        }
        state.replies.push_back(Outgoing::Frame(reply));
        drop(state);
        self.wake.notify_one();
        Ok(())
    }

    pub fn friends_generation(&self) -> u64 {
        lock(&self.state).friends_generation
    }

    pub fn friends_allowed(&self, generation: u64) -> bool {
        let state = lock(&self.state);
        !state.friends_disabled && state.friends_generation == generation
    }

    pub fn friends_permission(&self, generation: u64) -> Option<CancellationToken> {
        let state = lock(&self.state);
        (!state.friends_disabled && state.friends_generation == generation).then(|| state.friends_stop.clone())
    }

    pub fn push_friends_reply(&self, frame: LauncherFrame, generation: u64) -> Result<(), Overflow> {
        let mut state = lock(&self.state);
        if state.len() >= OUTGOING_QUEUE {
            return Err(Overflow);
        }
        let outgoing = if state.friends_disabled || generation != state.friends_generation {
            Outgoing::Frame(revoked_reply(frame))
        } else {
            Outgoing::FriendsFrame { frame, generation }
        };
        state.replies.push_back(outgoing);
        drop(state);
        self.wake.notify_one();
        Ok(())
    }

    pub fn set_friends_enabled(&self, enabled: bool) {
        let mut state = lock(&self.state);
        if enabled && state.friends_disabled {
            state.friends_stop = CancellationToken::new();
        }
        state.friends_disabled = !enabled;
        if !enabled {
            state.friends_stop.cancel();
            state.friends_generation += 1;
            for outgoing in &mut state.replies {
                if let Outgoing::FriendsFrame { frame, .. } = outgoing {
                    let frame = std::mem::replace(frame, LauncherFrame::Pong);
                    *outgoing = Outgoing::Frame(revoked_reply(frame));
                }
            }
            state.events.retain(|event| !matches!(event, Event::Notify { .. }));
        }
        drop(state);
        self.wake.notify_one();
    }

    pub fn push_event(&self, event: Event) {
        let mut state = lock(&self.state);
        if state.friends_disabled && matches!(event, Event::Notify { .. }) {
            return;
        }
        if state.events.len() >= EVENT_QUEUE {
            state.events.pop_front();
        }
        state.events.push_back(event);
        drop(state);
        self.wake.notify_one();
    }

    /// Das Thema hat einen neuen Wert (oder die Mod will ihn noch einmal).
    pub fn mark_topics(&self, topics: impl IntoIterator<Item = Topic>) {
        lock(&self.state).dirty.extend(topics);
        self.wake.notify_one();
    }

    /// Nimmt nichts Neues mehr an als Antworten und sendet den Rest, danach ist die Warteschlange `Finished`.
    pub fn finish(&self) {
        lock(&self.state).finishing = true;
        self.wake.notify_one();
    }

    /// Wartet, bis etwas eingereiht wurde. Ein Einreihen zwischen `next` und `changed` geht nicht verloren.
    pub async fn changed(&self) {
        self.wake.notified().await;
    }

    /// Das Nächste zum Senden: erst Antworten, dann Hinweise, dann Themen, die ihre Wartezeit hinter sich haben.
    pub fn next(&self, now: Instant) -> Next {
        let mut state = lock(&self.state);
        if let Some(reply) = state.replies.pop_front() {
            return Next::Send(reply);
        }
        if let Some(event) = state.events.pop_front() {
            let frame = LauncherFrame::Event(event);
            return Next::Send(match frame {
                LauncherFrame::Event(Event::Notify { .. }) => Outgoing::FriendsFrame { frame, generation: state.friends_generation },
                _ => Outgoing::Frame(frame),
            });
        }
        let due_at = |state: &State, topic: &Topic| state.last_sent.get(topic).map_or(now, |sent| *sent + self.coalesce);
        let due = state.dirty.iter().copied().find(|topic| due_at(&state, topic) <= now);
        if let Some(topic) = due {
            state.dirty.remove(&topic);
            state.last_sent.insert(topic, now);
            return Next::Send(Outgoing::Topic(topic));
        }
        match state.dirty.iter().map(|topic| due_at(&state, topic)).min() {
            Some(at) => Next::WaitUntil(at),
            None if state.finishing => Next::Finished,
            None => Next::Idle,
        }
    }
}

pub(super) fn revoked_reply(frame: LauncherFrame) -> LauncherFrame {
    match frame {
        LauncherFrame::Res(mut response) => {
            response.ok = false;
            response.result = None;
            response.error = Some(ErrorCode::NotEnabled.into());
            LauncherFrame::Res(response)
        }
        LauncherFrame::Pending { id, .. } => LauncherFrame::Res(Response {
            id, ok: false, result: None, error: Some(ErrorCode::NotEnabled.into()),
        }),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::super::protocol::{ClosingReason, ModNotify};
    use super::*;

    const COALESCE: Duration = Duration::from_millis(250);

    fn queue() -> LinkQueue {
        LinkQueue::new(COALESCE)
    }

    fn reply(id: &str) -> LauncherFrame {
        LauncherFrame::Pending { id: id.into(), prompt: super::super::protocol::Prompt::Scope, scope: super::super::ops::Scope::Share }
    }

    fn notify(name: &str) -> Event {
        Event::Notify { kind: ModNotify::FriendOnline, name: Some(name.into()) }
    }

    fn sent(next: Next) -> Outgoing {
        match next {
            Next::Send(item) => item,
            other => panic!("nichts zu senden: {other:?}"),
        }
    }

    #[test]
    fn replies_come_first_in_order_then_events() {
        let queue = queue();
        queue.push_event(notify("a"));
        queue.push_reply(reply("r1")).unwrap();
        queue.push_reply(reply("r2")).unwrap();
        let now = Instant::now();
        assert_eq!(sent(queue.next(now)), Outgoing::Frame(reply("r1")));
        assert_eq!(sent(queue.next(now)), Outgoing::Frame(reply("r2")));
        assert_eq!(sent(queue.next(now)), Outgoing::FriendsFrame { frame: LauncherFrame::Event(notify("a")), generation: 0 });
        assert_eq!(queue.next(now), Next::Idle);
    }

    #[test]
    fn the_33rd_event_pushes_out_the_oldest_and_replies_stay() {
        let queue = queue();
        queue.push_reply(reply("r1")).unwrap();
        (0..=EVENT_QUEUE).for_each(|index| queue.push_event(notify(&index.to_string())));
        let now = Instant::now();
        assert_eq!(sent(queue.next(now)), Outgoing::Frame(reply("r1")), "Antworten gehen nie verloren");
        let names: Vec<String> = std::iter::from_fn(|| match queue.next(now) {
            Next::Send(Outgoing::FriendsFrame { frame: LauncherFrame::Event(Event::Notify { name, .. }), .. }) => name,
            _ => None,
        })
        .collect();
        assert_eq!(names.len(), EVENT_QUEUE);
        assert_eq!((names.first().map(String::as_str), names.last().map(String::as_str)), (Some("1"), Some("32")));
    }

    #[test]
    fn a_full_queue_refuses_another_reply() {
        let queue = queue();
        for index in 0..OUTGOING_QUEUE {
            queue.push_reply(reply(&index.to_string())).unwrap();
        }
        assert_eq!(queue.push_reply(reply("zu viel")), Err(Overflow));
        assert_eq!(sent(queue.next(Instant::now())), Outgoing::Frame(reply("0")));
        assert_eq!(queue.push_reply(reply("wieder Platz")), Ok(()));
    }

    #[test]
    fn events_and_marked_topics_count_toward_the_capacity() {
        let queue = queue();
        (0..EVENT_QUEUE).for_each(|index| queue.push_event(notify(&index.to_string())));
        queue.mark_topics([Topic::Me, Topic::Friends]);
        for index in 0..(OUTGOING_QUEUE - EVENT_QUEUE - 2) {
            queue.push_reply(reply(&index.to_string())).unwrap();
        }
        assert_eq!(queue.push_reply(reply("zu viel")), Err(Overflow));
    }

    #[test]
    fn the_first_push_of_a_topic_goes_out_at_once_and_the_next_waits_for_the_interval() {
        let queue = queue();
        let start = Instant::now();
        queue.mark_topics([Topic::Friends]);
        assert_eq!(sent(queue.next(start)), Outgoing::Topic(Topic::Friends));
        queue.mark_topics([Topic::Friends]);
        queue.mark_topics([Topic::Friends]);
        assert_eq!(queue.next(start + Duration::from_millis(10)), Next::WaitUntil(start + COALESCE));
        assert_eq!(sent(queue.next(start + COALESCE)), Outgoing::Topic(Topic::Friends), "mehrere Änderungen sind eine Nachricht");
        assert_eq!(queue.next(start + COALESCE), Next::Idle);
    }

    #[test]
    fn topics_wait_independently_of_each_other() {
        let queue = queue();
        let start = Instant::now();
        queue.mark_topics([Topic::Friends]);
        sent(queue.next(start));
        queue.mark_topics([Topic::Friends, Topic::Invites]);
        let later = start + Duration::from_millis(10);
        assert_eq!(sent(queue.next(later)), Outgoing::Topic(Topic::Invites));
        assert_eq!(queue.next(later), Next::WaitUntil(start + COALESCE));
    }

    #[test]
    fn a_finished_queue_sends_what_it_holds_and_then_ends() {
        let queue = queue();
        queue.push_event(Event::Closing { reason: ClosingReason::LaunchEnded });
        queue.finish();
        let now = Instant::now();
        assert!(matches!(queue.next(now), Next::Send(_)));
        assert_eq!(queue.next(now), Next::Finished);
    }

    #[tokio::test]
    async fn a_push_between_looking_and_waiting_is_not_lost() {
        let queue = queue();
        assert_eq!(queue.next(Instant::now()), Next::Idle);
        queue.push_event(notify("a"));
        tokio::time::timeout(Duration::from_secs(1), queue.changed()).await.expect("Einreihen weckt den Schreiber");
    }
}
