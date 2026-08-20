use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use tokio::sync::Notify;

use super::{OutputOverflow, OutputPolicy};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum OutputStream {
    Stdout,
    Stderr,
}

impl OutputStream {
    fn index(self) -> usize {
        match self {
            Self::Stdout => 0,
            Self::Stderr => 1,
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Stdout => "stdout",
            Self::Stderr => "stderr",
        }
    }
}

#[derive(Debug)]
pub(crate) struct OutputEvent {
    pub(crate) stream: OutputStream,
    pub(crate) data: Vec<u8>,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct OutputStats {
    pub(crate) observed: [u64; 2],
    pub(crate) delivered: [u64; 2],
    pub(crate) omitted: [u64; 2],
}

impl OutputStats {
    pub(crate) fn total_observed(&self) -> u64 {
        self.observed.iter().sum()
    }

    pub(crate) fn total_delivered(&self) -> u64 {
        self.delivered.iter().sum()
    }

    pub(crate) fn total_omitted(&self) -> u64 {
        self.omitted.iter().sum()
    }
}

pub(crate) struct OutputDrain {
    pub(crate) events: Vec<OutputEvent>,
    pub(crate) has_more: bool,
    pub(crate) pipes_closed: bool,
    pub(crate) stats: OutputStats,
}

pub(crate) enum IngestResult {
    Accepted,
    Terminate,
}

struct QueueState {
    events: VecDeque<OutputEvent>,
    queued_bytes: usize,
    open_pipes: u8,
    notification_pending: bool,
    stats: OutputStats,
}

pub(crate) struct OutputQueue {
    policy: OutputPolicy,
    state: Mutex<QueueState>,
    capacity: Notify,
    notify_ready: Arc<dyn Fn() + Send + Sync>,
}

impl OutputQueue {
    pub(crate) fn new(
        policy: OutputPolicy,
        notify_ready: impl Fn() + Send + Sync + 'static,
    ) -> Self {
        Self {
            policy,
            state: Mutex::new(QueueState {
                events: VecDeque::new(),
                queued_bytes: 0,
                open_pipes: 2,
                notification_pending: false,
                stats: OutputStats::default(),
            }),
            capacity: Notify::new(),
            notify_ready: Arc::new(notify_ready),
        }
    }

    pub(crate) async fn ingest(&self, stream: OutputStream, data: Vec<u8>) -> IngestResult {
        if data.is_empty() {
            return IngestResult::Accepted;
        }
        let index = stream.index();
        let mut accepted = data.len();
        let mut terminate = false;
        {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            state.stats.observed[index] =
                state.stats.observed[index].saturating_add(data.len() as u64);
            if let Some(limit) = self.policy.total_bytes {
                let before = state
                    .stats
                    .total_observed()
                    .saturating_sub(data.len() as u64);
                let remaining = limit.saturating_sub(before);
                accepted = accepted.min(remaining as usize);
                if accepted < data.len() {
                    state.stats.omitted[index] =
                        state.stats.omitted[index].saturating_add((data.len() - accepted) as u64);
                    terminate = self.policy.overflow == Some(OutputOverflow::Terminate);
                }
            }
        }
        if accepted > 0 {
            for chunk in data[..accepted].chunks(self.policy.queue_bytes) {
                self.enqueue(stream, chunk.to_vec()).await;
            }
        }
        if terminate {
            IngestResult::Terminate
        } else {
            IngestResult::Accepted
        }
    }

    async fn enqueue(&self, stream: OutputStream, data: Vec<u8>) {
        let mut pending = Some(data);
        loop {
            let notified = self.capacity.notified();
            let inserted = {
                let mut state = self
                    .state
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                let length = pending.as_ref().map_or(0, Vec::len);
                if state.queued_bytes + length <= self.policy.queue_bytes {
                    state.queued_bytes += length;
                    state.events.push_back(OutputEvent {
                        stream,
                        data: pending.take().expect("pending output must exist"),
                    });
                    let should_notify = !state.notification_pending;
                    state.notification_pending = true;
                    Some(should_notify)
                } else {
                    None
                }
            };
            match inserted {
                Some(should_notify) => {
                    if should_notify {
                        (self.notify_ready)();
                    }
                    return;
                }
                None => notified.await,
            }
        }
    }

    pub(crate) fn finish_stream(&self) {
        let should_notify = {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            state.open_pipes = state.open_pipes.saturating_sub(1);
            if state.notification_pending {
                false
            } else {
                state.notification_pending = true;
                true
            }
        };
        if should_notify {
            (self.notify_ready)();
        }
    }

    pub(crate) fn drain(&self, maximum: usize) -> OutputDrain {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut events = Vec::new();
        let mut drained = 0usize;
        while let Some(front) = state.events.front() {
            if !events.is_empty() && drained.saturating_add(front.data.len()) > maximum {
                break;
            }
            let event = state.events.pop_front().expect("front event must exist");
            drained = drained.saturating_add(event.data.len());
            state.queued_bytes = state.queued_bytes.saturating_sub(event.data.len());
            state.stats.delivered[event.stream.index()] =
                state.stats.delivered[event.stream.index()].saturating_add(event.data.len() as u64);
            events.push(event);
            if drained >= maximum {
                break;
            }
        }
        if drained > 0 {
            self.capacity.notify_waiters();
        }
        let has_more = !state.events.is_empty();
        state.notification_pending = has_more;
        OutputDrain {
            events,
            has_more,
            pipes_closed: state.open_pipes == 0,
            stats: state.stats.clone(),
        }
    }

    pub(crate) fn is_complete(&self) -> bool {
        let state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.open_pipes == 0 && state.events.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::{IngestResult, OutputQueue, OutputStream};
    use crate::process::{OutputOverflow, OutputPolicy};

    #[tokio::test]
    async fn tracks_delivery_and_overflow() {
        let notifications = Arc::new(AtomicUsize::new(0));
        let seen = Arc::clone(&notifications);
        let queue = OutputQueue::new(
            OutputPolicy {
                queue_bytes: 16,
                batch_bytes: 8,
                total_bytes: Some(6),
                overflow: Some(OutputOverflow::Terminate),
            },
            move || {
                seen.fetch_add(1, Ordering::Relaxed);
            },
        );
        assert!(matches!(
            queue.ingest(OutputStream::Stdout, b"abcd".to_vec()).await,
            IngestResult::Accepted
        ));
        assert!(matches!(
            queue.ingest(OutputStream::Stderr, b"efgh".to_vec()).await,
            IngestResult::Terminate
        ));
        let drained = queue.drain(16);
        assert_eq!(drained.events.len(), 2);
        assert_eq!(drained.stats.total_observed(), 8);
        assert_eq!(drained.stats.total_delivered(), 6);
        assert_eq!(drained.stats.total_omitted(), 2);
        assert_eq!(notifications.load(Ordering::Relaxed), 1);
    }
}
