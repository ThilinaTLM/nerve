use super::content::{ContentOptions, ContentSearchOutput, search_content};
use super::listing::list_directory;
use super::path_index::{PathIndex, PathKind, PathSearchOutput};
use crate::core::registry::HandleRegistry;
use napi::Env;
use napi::bindgen_prelude::{AsyncTask, Result, Task};
use napi_derive::napi;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

#[napi(object)]
pub struct NativeFileEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub symlink: bool,
    pub ignored: bool,
}

#[napi(object)]
pub struct NativePathIndexHandle {
    pub id: u32,
}

#[napi(object)]
pub struct NativePathMatch {
    pub path: String,
    pub kind: String,
    pub score: f64,
    pub positions: Vec<u32>,
}

#[napi(object)]
pub struct NativePathSearchResult {
    pub matches: Vec<NativePathMatch>,
    pub incomplete: bool,
}

#[napi(object)]
pub struct NativeContentSearchRequest {
    pub query: String,
    pub regex: Option<bool>,
    pub case_sensitive: Option<bool>,
    pub whole_word: Option<bool>,
    pub include: Option<Vec<String>>,
    pub exclude: Option<Vec<String>>,
    pub include_ignored: Option<bool>,
    pub max_results: Option<f64>,
    pub max_preview_chars: Option<f64>,
    pub timeout_ms: Option<f64>,
    pub cancel_id: Option<u32>,
}

#[napi(object)]
pub struct NativeContentMatch {
    pub line: f64,
    pub text: String,
    pub ranges: Vec<Vec<u32>>,
}

#[napi(object)]
pub struct NativeContentFile {
    pub path: String,
    pub matches: Vec<NativeContentMatch>,
}

#[napi(object)]
pub struct NativeContentSearchResult {
    pub files: Vec<NativeContentFile>,
    pub truncated: bool,
    pub searched_files: f64,
}

static INDEXES: OnceLock<HandleRegistry<PathIndex>> = OnceLock::new();
static SEARCHES: OnceLock<Mutex<HashMap<u32, Arc<AtomicBool>>>> = OnceLock::new();

fn indexes() -> &'static HandleRegistry<PathIndex> {
    INDEXES.get_or_init(HandleRegistry::new)
}

fn searches() -> &'static Mutex<HashMap<u32, Arc<AtomicBool>>> {
    SEARCHES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn index(handle: &NativePathIndexHandle) -> Result<Arc<PathIndex>> {
    indexes()
        .get(handle.id)
        .ok_or_else(|| napi::Error::from_reason("Path index is closed"))
}

fn count(name: &str, value: Option<f64>) -> Result<Option<usize>> {
    match value {
        None => Ok(None),
        Some(value) if value.is_finite() && value >= 1.0 => Ok(Some(value as usize)),
        Some(_) => Err(napi::Error::from_reason(format!("Invalid {name}"))),
    }
}

// --- directory listing ---

pub struct ListTask {
    root: PathBuf,
    relative: String,
    include_hidden: bool,
}

impl Task for ListTask {
    type Output = Vec<NativeFileEntry>;
    type JsValue = Vec<NativeFileEntry>;

    fn compute(&mut self) -> Result<Self::Output> {
        let entries = list_directory(&self.root, &self.relative, self.include_hidden)
            .map_err(napi::Error::from_reason)?;
        Ok(entries
            .into_iter()
            .map(|entry| NativeFileEntry {
                name: entry.name,
                path: entry.path,
                kind: entry.kind.as_str().into(),
                symlink: entry.symlink,
                ignored: entry.ignored,
            })
            .collect())
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

#[napi]
pub fn list_project_directory(
    root: String,
    relative_path: String,
    include_hidden: bool,
) -> AsyncTask<ListTask> {
    AsyncTask::new(ListTask {
        root: PathBuf::from(root),
        relative: relative_path,
        include_hidden,
    })
}

// --- path index ---

#[napi]
pub fn create_file_path_index(
    root: String,
    max_entries: Option<f64>,
) -> Result<NativePathIndexHandle> {
    let index = PathIndex::new(PathBuf::from(root), count("maxEntries", max_entries)?)
        .map_err(napi::Error::from_reason)?;
    Ok(NativePathIndexHandle {
        id: indexes().insert(Arc::new(index)),
    })
}

pub struct SearchPathsTask {
    index: Arc<PathIndex>,
    query: String,
    limit: usize,
    kinds: Option<Vec<PathKind>>,
}

impl Task for SearchPathsTask {
    type Output = PathSearchOutput;
    type JsValue = NativePathSearchResult;

    fn compute(&mut self) -> Result<Self::Output> {
        Ok(self
            .index
            .search(&self.query, self.limit, self.kinds.as_deref()))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(NativePathSearchResult {
            incomplete: output.incomplete,
            matches: output
                .matches
                .into_iter()
                .map(|found| NativePathMatch {
                    path: found.path,
                    kind: found.kind.as_str().into(),
                    score: f64::from(found.score),
                    positions: found.positions,
                })
                .collect(),
        })
    }
}

#[napi]
pub fn search_file_path_index(
    handle: NativePathIndexHandle,
    query: String,
    limit: f64,
    kinds: Option<Vec<String>>,
) -> Result<AsyncTask<SearchPathsTask>> {
    let kinds = kinds
        .map(|kinds| {
            kinds
                .iter()
                .map(|kind| match kind.as_str() {
                    "file" => Ok(PathKind::File),
                    "directory" => Ok(PathKind::Directory),
                    other => Err(napi::Error::from_reason(format!("Invalid kind {other}"))),
                })
                .collect::<Result<Vec<_>>>()
        })
        .transpose()?;
    Ok(AsyncTask::new(SearchPathsTask {
        index: index(&handle)?,
        query,
        limit: count("limit", Some(limit))?.unwrap_or(50),
        kinds,
    }))
}

pub struct ApplyChangesTask {
    index: Arc<PathIndex>,
    paths: Vec<String>,
}

impl Task for ApplyChangesTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> Result<Self::Output> {
        self.index.apply_changes(std::mem::take(&mut self.paths));
        Ok(())
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> Result<Self::JsValue> {
        Ok(())
    }
}

#[napi]
pub fn apply_file_path_index_changes(
    handle: NativePathIndexHandle,
    paths: Vec<String>,
) -> Result<AsyncTask<ApplyChangesTask>> {
    Ok(AsyncTask::new(ApplyChangesTask {
        index: index(&handle)?,
        paths,
    }))
}

/// Starts a background rebuild and returns at once; searches report `incomplete` until it ends.
#[napi]
pub fn rebuild_file_path_index(handle: NativePathIndexHandle) -> Result<()> {
    index(&handle)?.rebuild();
    Ok(())
}

#[napi]
pub fn close_file_path_index(handle: NativePathIndexHandle) {
    if let Some(index) = indexes().remove(handle.id) {
        index.close();
    }
}

// --- content search ---

pub struct ContentTask {
    root: PathBuf,
    options: Option<ContentOptions>,
    cancel: Arc<AtomicBool>,
    cancel_id: Option<u32>,
}

impl Task for ContentTask {
    type Output = ContentSearchOutput;
    type JsValue = NativeContentSearchResult;

    fn compute(&mut self) -> Result<Self::Output> {
        let options = self.options.take().unwrap_or_default();
        let result = search_content(&self.root, options, Arc::clone(&self.cancel));
        if let Some(id) = self.cancel_id {
            searches()
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .remove(&id);
        }
        result.map_err(napi::Error::from_reason)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(NativeContentSearchResult {
            truncated: output.truncated,
            searched_files: output.searched_files as f64,
            files: output
                .files
                .into_iter()
                .map(|file| NativeContentFile {
                    path: file.path,
                    matches: file
                        .matches
                        .into_iter()
                        .map(|found| NativeContentMatch {
                            line: found.line as f64,
                            text: found.text,
                            ranges: found
                                .ranges
                                .into_iter()
                                .map(|(start, end)| vec![start, end])
                                .collect(),
                        })
                        .collect(),
                })
                .collect(),
        })
    }
}

#[napi]
pub fn search_file_content(
    root: String,
    request: NativeContentSearchRequest,
) -> Result<AsyncTask<ContentTask>> {
    let cancel = Arc::new(AtomicBool::new(false));
    if let Some(id) = request.cancel_id {
        searches()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(id, Arc::clone(&cancel));
    }
    let options = ContentOptions {
        query: request.query,
        regex: request.regex.unwrap_or(false),
        case_sensitive: request.case_sensitive.unwrap_or(false),
        whole_word: request.whole_word.unwrap_or(false),
        include: request.include.unwrap_or_default(),
        exclude: request.exclude.unwrap_or_default(),
        include_ignored: request.include_ignored.unwrap_or(false),
        max_results: count("maxResults", request.max_results)?,
        max_preview_chars: count("maxPreviewChars", request.max_preview_chars)?,
        timeout: count("timeoutMs", request.timeout_ms)?.map(|ms| Duration::from_millis(ms as u64)),
    };
    Ok(AsyncTask::new(ContentTask {
        root: PathBuf::from(root),
        options: Some(options),
        cancel,
        cancel_id: request.cancel_id,
    }))
}

#[napi]
pub fn cancel_file_content_search(cancel_id: u32) {
    if let Some(flag) = searches()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .get(&cancel_id)
    {
        flag.store(true, Ordering::Release);
    }
}
