use super::document::{Document, Engine, QueryResult};
use super::{Candidate, Match, Query, query};
use crate::core::cancellation::CancellationToken;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

type Result<T> = std::result::Result<T, &'static str>;

pub(super) struct State {
    closed: CancellationToken,
    busy: AtomicBool,
    engine: Mutex<Option<Engine>>,
}
impl Default for State {
    fn default() -> Self {
        Self {
            closed: CancellationToken::default(),
            busy: AtomicBool::new(false),
            engine: Mutex::new(Some(Engine::default())),
        }
    }
}
impl State {
    pub(super) fn is_closed(&self) -> bool {
        self.closed.is_cancelled()
    }
    /// Never locks/drops heavy state on the Node thread.
    pub(super) fn close(&self) {
        self.closed.cancel();
    }
    pub(super) fn dispose(&self) {
        drop(self.engine.lock().unwrap().take());
    }
    pub(super) fn acquire(self: &Arc<Self>) -> Result<Lease> {
        if self.closed.is_cancelled() {
            return Err("Completion index is closed");
        }
        if self.busy.swap(true, Ordering::AcqRel) {
            return Err("Completion index is busy");
        }
        Ok(Lease {
            state: self.clone(),
        })
    }
}
pub(super) struct Lease {
    state: Arc<State>,
}
impl Lease {
    pub(super) fn check(&self) -> Result<()> {
        if self.state.closed.is_cancelled() {
            Err("Completion index is closed")
        } else {
            Ok(())
        }
    }
    fn with_engine<T>(&self, run: impl FnOnce(&mut Engine, &AtomicBool) -> Result<T>) -> Result<T> {
        self.check()?;
        let mut slot = self.state.engine.lock().unwrap();
        self.check()?;
        run(
            slot.as_mut().ok_or("Completion index is closed")?,
            self.state.closed.flag(),
        )
    }
    pub(super) fn append(&self, candidates: Vec<Candidate>) -> Result<()> {
        self.with_engine(|engine, _| engine.append_files(candidates))
    }
    pub(super) fn stage(&self, documents: Vec<Document>, remove: Vec<Vec<u16>>) -> Result<()> {
        self.with_engine(|engine, flag| engine.stage(documents, remove, flag))
    }
    pub(super) fn commit(&self) -> Result<u32> {
        self.with_engine(|engine, flag| engine.commit(flag))
    }
    pub(super) fn discard(&self) -> Result<()> {
        self.with_engine(|engine, _| {
            engine.discard();
            Ok(())
        })
    }
    pub(super) fn query_files(&self, q: &Query, limit: usize) -> Result<Vec<Match>> {
        self.with_engine(|engine, flag| query(&engine.files, q, limit, flag))
    }
    pub(super) fn query_documents(
        &self,
        q: &Query,
        kinds: Option<&[Vec<u16>]>,
        document_ids: Option<&[Vec<u16>]>,
        limit: usize,
    ) -> Result<QueryResult> {
        self.with_engine(|engine, flag| engine.query(q, kinds, document_ids, limit, flag))
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        self.state.busy.store(false, Ordering::Release);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exclusive_lease_releases_on_failure_and_close_revokes_it() {
        let state = Arc::new(State::default());
        let lease = state.acquire().unwrap();
        assert!(matches!(state.acquire(), Err("Completion index is busy")));
        drop(lease);
        let lease = state.acquire().unwrap();
        lease.append(vec![]).unwrap();
        state.close();
        assert_eq!(lease.check(), Err("Completion index is closed"));
        assert_eq!(lease.append(vec![]), Err("Completion index is closed"));
        assert!(matches!(state.acquire(), Err("Completion index is closed")));
        state.dispose();
        state.dispose();
    }
}
