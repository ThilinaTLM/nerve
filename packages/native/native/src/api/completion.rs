use crate::completion::{self, Candidate, Query, Term};
use napi::bindgen_prelude::{AsyncTask, Result, Task, Utf16String};
use napi::{Env, Error};
use napi_derive::napi;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

#[napi(object)]
pub struct NativeCompletionCandidate {
    pub path: Utf16String,
    pub name: Utf16String,
    pub stem: Utf16String,
    pub path_lower: Utf16String,
    pub name_lower: Utf16String,
    pub stem_lower: Utf16String,
    pub segments: Vec<Utf16String>,
    pub segments_lower: Vec<Utf16String>,
    pub depth: u32,
    pub directory: bool,
    pub locale_rank: u32,
}
#[napi(object)]
pub struct NativeCompletionTerm {
    pub value: Utf16String,
    pub lower: Utf16String,
}
#[napi(object)]
pub struct NativeCompletionQuery {
    pub value: Utf16String,
    pub lower: Utf16String,
    pub path: Utf16String,
    pub folder: bool,
    pub ordered: bool,
    pub terms: Vec<NativeCompletionTerm>,
}
#[napi(object)]
pub struct NativeCompletionMatch {
    pub candidate_index: u32,
    pub score: f64,
    pub match_ranges: Vec<Vec<u32>>,
}
struct State {
    closed: AtomicBool,
    busy: AtomicBool,
    source_units: AtomicUsize,
    candidates: Mutex<Option<Arc<Vec<Candidate>>>>,
}
#[napi]
pub struct NativeFileCompletionIndex {
    state: Arc<State>,
}
impl Drop for NativeFileCompletionIndex {
    fn drop(&mut self) {
        self.state.closed.store(true, Ordering::Release);
        // Finalization is fallback only; explicit close releases on the worker pool.
        self.state.candidates.lock().unwrap().take();
    }
}
#[napi]
impl NativeFileCompletionIndex {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            state: Arc::new(State {
                closed: AtomicBool::new(false),
                busy: AtomicBool::new(false),
                source_units: AtomicUsize::new(0),
                candidates: Mutex::new(None),
            }),
        }
    }
    #[napi]
    pub fn build(
        &self,
        candidates: Vec<NativeCompletionCandidate>,
    ) -> Result<AsyncTask<CompletionBuildTask>> {
        if candidates.len() > 1024 {
            return Err(Error::from_reason("Completion build batch exceeds 1024"));
        }
        let lease = Lease::acquire(&self.state)?;
        Ok(AsyncTask::new(CompletionBuildTask { lease, candidates }))
    }
    #[napi]
    pub fn query(
        &self,
        query: NativeCompletionQuery,
        limit: u32,
    ) -> Result<AsyncTask<CompletionQueryTask>> {
        if limit > 8 {
            return Err(Error::from_reason("Completion limit must be at most 8"));
        }
        let lease = Lease::acquire(&self.state)?;
        let candidates = self
            .state
            .candidates
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| Error::from_reason("Completion index not built"))?;
        let query = Query {
            value: query.value.to_vec(),
            lower: query.lower.to_vec(),
            path: query.path.to_vec(),
            folder: query.folder,
            ordered: query.ordered,
            terms: query
                .terms
                .into_iter()
                .map(|t| Term {
                    value: t.value.to_vec(),
                    lower: t.lower.to_vec(),
                })
                .collect(),
        };
        Ok(AsyncTask::new(CompletionQueryTask {
            lease,
            candidates: Some(candidates),
            query,
            limit: limit as usize,
        }))
    }
    #[napi]
    pub fn close(&self) -> AsyncTask<CompletionCloseTask> {
        self.state.closed.store(true, Ordering::Release);
        let candidates = self.state.candidates.lock().unwrap().take();
        AsyncTask::new(CompletionCloseTask { candidates })
    }
}
impl Default for NativeFileCompletionIndex {
    fn default() -> Self {
        Self::new()
    }
}
struct Lease {
    state: Arc<State>,
}
impl Lease {
    fn acquire(state: &Arc<State>) -> Result<Self> {
        if state.closed.load(Ordering::Acquire) {
            return Err(Error::from_reason("Completion index is closed"));
        }
        if state.busy.swap(true, Ordering::AcqRel) {
            return Err(Error::from_reason("Completion index is busy"));
        }
        Ok(Self {
            state: state.clone(),
        })
    }
    fn check(&self) -> Result<()> {
        if self.state.closed.load(Ordering::Acquire) {
            Err(Error::from_reason("Completion index is closed"))
        } else {
            Ok(())
        }
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        self.state.busy.store(false, Ordering::Release);
    }
}
pub struct CompletionBuildTask {
    lease: Lease,
    candidates: Vec<NativeCompletionCandidate>,
}
impl Task for CompletionBuildTask {
    type Output = ();
    type JsValue = ();
    fn compute(&mut self) -> Result<()> {
        let mut candidates = Vec::with_capacity(self.candidates.len());
        for c in std::mem::take(&mut self.candidates) {
            self.lease.check()?;
            if c.segments.len() != c.segments_lower.len() || c.name.len() > c.path.len() {
                return Err(Error::from_reason("Invalid completion candidate"));
            }
            candidates.push(Candidate {
                path: c.path.to_vec(),
                name: c.name.to_vec(),
                stem: c.stem.to_vec(),
                path_lower: c.path_lower.to_vec(),
                name_lower: c.name_lower.to_vec(),
                stem_lower: c.stem_lower.to_vec(),
                segments: c.segments.iter().map(|s| s.to_vec()).collect(),
                segments_lower: c.segments_lower.iter().map(|s| s.to_vec()).collect(),
                depth: c.depth,
                directory: c.directory,
                locale_rank: c.locale_rank,
            });
        }
        let mut slot = self.lease.state.candidates.lock().unwrap();
        self.lease.check()?;
        let units: usize = candidates
            .iter()
            .map(|c| {
                c.path.len()
                    + c.name.len()
                    + c.stem.len()
                    + c.segments.iter().map(Vec::len).sum::<usize>()
            })
            .sum();
        let total = self.lease.state.source_units.load(Ordering::Relaxed) + units;
        let existing = slot.as_ref().map_or(0, |cs| cs.len());
        if existing + candidates.len() > 1_000_000 || total > 64 * 1024 * 1024 {
            return Err(Error::from_reason("Completion index source bound exceeded"));
        }
        let snapshot = slot.get_or_insert_with(|| Arc::new(Vec::new()));
        Arc::get_mut(snapshot)
            .ok_or_else(|| Error::from_reason("Completion index is in use"))?
            .extend(candidates);
        self.lease
            .state
            .source_units
            .store(total, Ordering::Relaxed);
        Ok(())
    }
    fn resolve(&mut self, _env: Env, _: ()) -> Result<()> {
        self.lease.check()
    }
}
pub struct CompletionCloseTask {
    candidates: Option<Arc<Vec<Candidate>>>,
}
impl Task for CompletionCloseTask {
    type Output = ();
    type JsValue = ();
    fn compute(&mut self) -> Result<()> {
        drop(self.candidates.take());
        Ok(())
    }
    fn resolve(&mut self, _env: Env, _: ()) -> Result<()> {
        Ok(())
    }
}

pub struct CompletionQueryTask {
    lease: Lease,
    candidates: Option<Arc<Vec<Candidate>>>,
    query: Query,
    limit: usize,
}
impl Task for CompletionQueryTask {
    type Output = Vec<completion::Match>;
    type JsValue = Vec<NativeCompletionMatch>;
    fn compute(&mut self) -> Result<Self::Output> {
        // Release the query's snapshot reference on this worker, not in JS task finalization.
        let candidates = self.candidates.take().unwrap();
        completion::query(
            &candidates,
            &self.query,
            self.limit,
            &self.lease.state.closed,
        )
        .map_err(Error::from_reason)
    }
    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        self.lease.check()?;
        Ok(output
            .into_iter()
            .map(|m| NativeCompletionMatch {
                candidate_index: m.candidate_index as u32,
                score: m.score,
                match_ranges: m.ranges.into_iter().map(Vec::from).collect(),
            })
            .collect())
    }
}
