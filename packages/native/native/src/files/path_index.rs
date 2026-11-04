use super::relative_slash;
use crate::core::ignore_rules::{IgnoreMatcher, walk_builder};
use ignore::{WalkBuilder, WalkState};
use nucleo_matcher::pattern::{AtomKind, CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

pub const DEFAULT_MAX_ENTRIES: usize = 200_000;
const MAX_PENDING_CHANGES: usize = 20_000;
const BATCH: usize = 256;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PathKind {
    File,
    Directory,
}

impl PathKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::File => "file",
            Self::Directory => "directory",
        }
    }
}

#[derive(Debug)]
pub struct PathMatch {
    pub path: String,
    pub kind: PathKind,
    pub score: u32,
    /// UTF-16 offsets of matched characters.
    pub positions: Vec<u32>,
}

#[derive(Debug)]
pub struct PathSearchOutput {
    pub matches: Vec<PathMatch>,
    pub incomplete: bool,
}

#[derive(Default)]
struct State {
    entries: BTreeMap<String, PathKind>,
    truncated: bool,
    building: bool,
    pending: Vec<String>,
    pending_overflow: bool,
}

struct Inner {
    root: PathBuf,
    max_entries: usize,
    state: Mutex<State>,
    generation: AtomicU64,
}

/// Ignore-aware, in-memory index of a project's files and directories. The
/// initial walk runs on a background thread and publishes progressively.
pub struct PathIndex {
    inner: Arc<Inner>,
}

fn lock(state: &Mutex<State>) -> MutexGuard<'_, State> {
    state
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl PathIndex {
    pub fn new(root: PathBuf, max_entries: Option<usize>) -> Result<Self, String> {
        let root = root
            .canonicalize()
            .map_err(|error| format!("Could not resolve project root: {error}"))?;
        if !root.is_dir() {
            return Err("Project root is not a directory".into());
        }
        let index = Self {
            inner: Arc::new(Inner {
                root,
                max_entries: max_entries.unwrap_or(DEFAULT_MAX_ENTRIES).max(1),
                state: Mutex::new(State::default()),
                generation: AtomicU64::new(0),
            }),
        };
        index.rebuild();
        Ok(index)
    }

    /// Restarts the background walk; `search` reports `incomplete` until it ends.
    pub fn rebuild(&self) {
        start_build(&self.inner);
    }

    pub fn close(&self) {
        self.inner.generation.fetch_add(1, Ordering::AcqRel);
        *lock(&self.inner.state) = State::default();
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        lock(&self.inner.state).entries.len()
    }

    pub fn search(
        &self,
        query: &str,
        limit: usize,
        kinds: Option<&[PathKind]>,
    ) -> PathSearchOutput {
        let limit = limit.clamp(1, self.inner.max_entries);
        let state = lock(&self.inner.state);
        let incomplete = state.building || state.truncated;
        let wanted = |kind: PathKind| kinds.is_none_or(|kinds| kinds.contains(&kind));
        let query = query.trim();
        if query.is_empty() {
            let matches = state
                .entries
                .iter()
                .filter(|(_, kind)| wanted(**kind))
                .take(limit)
                .map(|(path, kind)| PathMatch {
                    path: path.clone(),
                    kind: *kind,
                    score: 0,
                    positions: Vec::new(),
                })
                .collect();
            return PathSearchOutput {
                matches,
                incomplete,
            };
        }
        let pattern = Pattern::new(
            query,
            CaseMatching::Smart,
            Normalization::Smart,
            AtomKind::Fuzzy,
        );
        let mut matcher = Matcher::new(Config::DEFAULT.match_paths());
        let mut buffer = Vec::new();
        let mut scored: Vec<(u32, &str, PathKind)> = Vec::new();
        for (path, kind) in &state.entries {
            if !wanted(*kind) {
                continue;
            }
            if let Some(score) = pattern.score(Utf32Str::new(path, &mut buffer), &mut matcher) {
                scored.push((score, path, *kind));
            }
        }
        let order = |a: &(u32, &str, PathKind), b: &(u32, &str, PathKind)| {
            b.0.cmp(&a.0)
                .then_with(|| a.1.len().cmp(&b.1.len()))
                .then_with(|| a.1.cmp(b.1))
        };
        if scored.len() > limit {
            scored.select_nth_unstable_by(limit - 1, order);
            scored.truncate(limit);
        }
        scored.sort_by(order);
        let mut indices = Vec::new();
        let matches = scored
            .into_iter()
            .map(|(score, path, kind)| {
                indices.clear();
                pattern.indices(Utf32Str::new(path, &mut buffer), &mut matcher, &mut indices);
                indices.sort_unstable();
                indices.dedup();
                PathMatch {
                    path: path.to_string(),
                    kind,
                    score,
                    positions: utf16_positions(path, &indices),
                }
            })
            .collect();
        PathSearchOutput {
            matches,
            incomplete,
        }
    }

    pub fn apply_changes(&self, paths: Vec<String>) {
        {
            let mut state = lock(&self.inner.state);
            if state.building {
                if state.pending.len() + paths.len() > MAX_PENDING_CHANGES {
                    state.pending_overflow = true;
                } else {
                    state.pending.extend(paths);
                }
                return;
            }
        }
        apply(&self.inner, &paths);
    }
}

impl Drop for PathIndex {
    fn drop(&mut self) {
        self.close();
    }
}

fn start_build(inner: &Arc<Inner>) {
    let generation = inner.generation.fetch_add(1, Ordering::AcqRel) + 1;
    *lock(&inner.state) = State {
        building: true,
        ..State::default()
    };
    let worker = Arc::clone(inner);
    let spawned = std::thread::Builder::new()
        .name("nerve-path-index".into())
        .spawn(move || build(&worker, generation));
    if spawned.is_err() {
        let mut state = lock(&inner.state);
        state.building = false;
        state.truncated = true;
    }
}

fn utf16_positions(path: &str, char_indices: &[u32]) -> Vec<u32> {
    let mut result = Vec::with_capacity(char_indices.len());
    let mut wanted = char_indices.iter().copied().peekable();
    let mut offset = 0u32;
    for (index, ch) in path.chars().enumerate() {
        match wanted.peek() {
            Some(next) if *next as usize == index => {
                result.push(offset);
                wanted.next();
            }
            None => break,
            _ => {}
        }
        offset += ch.len_utf16() as u32;
    }
    result
}

fn classify(path: &Path, file_type: Option<fs::FileType>) -> Option<PathKind> {
    let file_type = file_type?;
    if file_type.is_symlink() {
        let info = fs::metadata(path).ok()?;
        return if info.is_dir() {
            Some(PathKind::Directory)
        } else if info.is_file() {
            Some(PathKind::File)
        } else {
            None
        };
    }
    if file_type.is_dir() {
        Some(PathKind::Directory)
    } else if file_type.is_file() {
        Some(PathKind::File)
    } else {
        None
    }
}

struct Batcher<'a> {
    inner: &'a Inner,
    generation: u64,
    items: Vec<(String, PathKind)>,
}

impl Batcher<'_> {
    fn flush(&mut self) {
        if self.items.is_empty() {
            return;
        }
        let mut state = lock(&self.inner.state);
        if self.inner.generation.load(Ordering::Acquire) != self.generation {
            self.items.clear();
            return;
        }
        state.entries.extend(self.items.drain(..));
    }
}

impl Drop for Batcher<'_> {
    fn drop(&mut self) {
        self.flush();
    }
}

fn build(inner: &Arc<Inner>, generation: u64) {
    let counter = AtomicUsize::new(0);
    let truncated = AtomicBool::new(false);
    let mut builder = walk_builder(&inner.root);
    builder.threads(walk_threads());
    builder.build_parallel().run(|| {
        let mut batch = Batcher {
            inner,
            generation,
            items: Vec::with_capacity(BATCH),
        };
        let (counter, truncated) = (&counter, &truncated);
        Box::new(move |result| {
            if inner.generation.load(Ordering::Acquire) != generation {
                return WalkState::Quit;
            }
            let Ok(entry) = result else {
                return WalkState::Continue;
            };
            if entry.depth() == 0 {
                return WalkState::Continue;
            }
            let Some(kind) = classify(entry.path(), entry.file_type()) else {
                return WalkState::Continue;
            };
            let Some(relative) = relative_slash(&inner.root, entry.path()) else {
                return WalkState::Continue;
            };
            if counter.fetch_add(1, Ordering::Relaxed) >= inner.max_entries {
                truncated.store(true, Ordering::Relaxed);
                return WalkState::Quit;
            }
            batch.items.push((relative, kind));
            if batch.items.len() >= BATCH {
                batch.flush();
            }
            WalkState::Continue
        })
    });
    if inner.generation.load(Ordering::Acquire) != generation {
        return;
    }
    let (pending, overflow) = {
        let mut state = lock(&inner.state);
        if inner.generation.load(Ordering::Acquire) != generation {
            return;
        }
        state.truncated = truncated.load(Ordering::Relaxed);
        state.building = false;
        (std::mem::take(&mut state.pending), state.pending_overflow)
    };
    if overflow {
        // Too many events arrived mid-walk to replay: walk again from scratch.
        start_build(inner);
        return;
    }
    if !pending.is_empty() {
        apply(inner, &pending);
    }
}

fn walk_threads() -> usize {
    std::thread::available_parallelism()
        .map_or(2, usize::from)
        .clamp(1, 4)
}

fn is_ignore_file(name: &str) -> bool {
    name == ".gitignore" || name == ".ignore"
}

fn apply(inner: &Arc<Inner>, paths: &[String]) {
    let generation = inner.generation.load(Ordering::Acquire);
    let mut matcher = IgnoreMatcher::new(&inner.root);
    for raw in paths {
        let relative = raw.trim_matches(['/', '\\']).replace('\\', "/");
        let segments: Vec<_> = relative.split('/').filter(|s| !s.is_empty()).collect();
        if segments.iter().any(|s| *s == ".." || *s == ".") {
            continue;
        }
        let relative = segments.join("/");
        let absolute = segments
            .iter()
            .fold(inner.root.clone(), |path, segment| path.join(segment));
        if relative.is_empty() {
            rescan(inner, &mut matcher, &inner.root, "", generation);
            continue;
        }
        if segments.contains(&".git") {
            continue;
        }
        let name = segments.last().copied().unwrap_or_default();
        if is_ignore_file(name) {
            matcher.invalidate();
            let parent = segments[..segments.len() - 1].join("/");
            let parent_abs = absolute.parent().unwrap_or(&inner.root).to_path_buf();
            rescan(inner, &mut matcher, &parent_abs, &parent, generation);
        }
        let Ok(info) = fs::symlink_metadata(&absolute) else {
            remove_subtree(inner, &relative, generation);
            continue;
        };
        let kind = classify(&absolute, Some(info.file_type()));
        let real_dir = info.file_type().is_dir();
        let Some(kind) = kind else {
            remove_subtree(inner, &relative, generation);
            continue;
        };
        if matcher.is_ignored(&absolute, real_dir) {
            remove_subtree(inner, &relative, generation);
            continue;
        }
        ensure_ancestors(inner, &mut matcher, &segments, generation);
        if real_dir {
            rescan(inner, &mut matcher, &absolute, &relative, generation);
        } else {
            insert(inner, vec![(relative, kind)], generation);
        }
    }
}

fn ensure_ancestors(
    inner: &Inner,
    matcher: &mut IgnoreMatcher,
    segments: &[&str],
    generation: u64,
) {
    let mut missing = Vec::new();
    let mut absolute = inner.root.clone();
    for end in 1..segments.len() {
        absolute.push(segments[end - 1]);
        let relative = segments[..end].join("/");
        if !lock(&inner.state).entries.contains_key(&relative)
            && !matcher.is_ignored(&absolute, true)
        {
            missing.push((relative, PathKind::Directory));
        }
    }
    insert(inner, missing, generation);
}

fn insert(inner: &Inner, items: Vec<(String, PathKind)>, generation: u64) {
    if items.is_empty() {
        return;
    }
    let mut state = lock(&inner.state);
    if inner.generation.load(Ordering::Acquire) != generation {
        return;
    }
    for (path, kind) in items {
        if state.entries.len() >= inner.max_entries && !state.entries.contains_key(&path) {
            state.truncated = true;
            continue;
        }
        state.entries.insert(path, kind);
    }
}

fn remove_subtree(inner: &Inner, relative: &str, generation: u64) {
    let mut state = lock(&inner.state);
    if inner.generation.load(Ordering::Acquire) != generation {
        return;
    }
    remove_locked(&mut state, relative);
}

fn remove_locked(state: &mut State, relative: &str) {
    state.entries.remove(relative);
    if relative.is_empty() {
        state.entries.clear();
        return;
    }
    let prefix = format!("{relative}/");
    // '0' is the character after '/', so this range is exactly the subtree.
    let upper = format!("{relative}0");
    let doomed: Vec<String> = state
        .entries
        .range(prefix.clone()..upper)
        .map(|(path, _)| path.clone())
        .collect();
    for path in doomed {
        state.entries.remove(&path);
    }
}

/// Replaces everything below `directory` with a fresh ignore-aware walk.
fn rescan(
    inner: &Arc<Inner>,
    matcher: &mut IgnoreMatcher,
    directory: &Path,
    relative: &str,
    generation: u64,
) {
    let mut found = Vec::new();
    if relative.is_empty() || !matcher.is_ignored(directory, true) {
        let walker: WalkBuilder = walk_builder(directory);
        for entry in walker.build().flatten() {
            if entry.depth() == 0 {
                continue;
            }
            let Some(kind) = classify(entry.path(), entry.file_type()) else {
                continue;
            };
            if let Some(path) = relative_slash(&inner.root, entry.path()) {
                found.push((path, kind));
            }
            if found.len() > inner.max_entries {
                break;
            }
        }
    }
    let mut state = lock(&inner.state);
    if inner.generation.load(Ordering::Acquire) != generation {
        return;
    }
    // Keep the directory entry itself; replace only its contents.
    let prefix = if relative.is_empty() {
        String::new()
    } else {
        format!("{relative}/")
    };
    let doomed: Vec<String> = state
        .entries
        .keys()
        .filter(|path| prefix.is_empty() || path.starts_with(&prefix))
        .cloned()
        .collect();
    for path in doomed {
        state.entries.remove(&path);
    }
    if !relative.is_empty() && !directory.as_os_str().is_empty() && directory.is_dir() {
        state
            .entries
            .insert(relative.to_string(), PathKind::Directory);
    }
    for (path, kind) in found {
        if state.entries.len() >= inner.max_entries {
            state.truncated = true;
            break;
        }
        state.entries.insert(path, kind);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::test_support::tempdir;
    use std::time::{Duration, Instant};

    fn wait_ready(index: &PathIndex) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while lock(&index.inner.state).building {
            assert!(Instant::now() < deadline, "index build timed out");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn paths(index: &PathIndex, query: &str) -> Vec<String> {
        index
            .search(query, 50, None)
            .matches
            .into_iter()
            .map(|m| m.path)
            .collect()
    }

    #[test]
    fn indexes_with_ignore_rules_ranks_matches_and_applies_changes() {
        let root = tempdir("index");
        fs::create_dir_all(root.join("src/deep")).unwrap();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join(".gitignore"), "node_modules/\n").unwrap();
        fs::write(root.join("src/main.rs"), "").unwrap();
        fs::write(root.join("src/deep/module.rs"), "").unwrap();
        fs::write(root.join("node_modules/pkg/main.js"), "").unwrap();
        fs::write(root.join(".git/config"), "").unwrap();
        let index = PathIndex::new(root.clone(), None).unwrap();
        wait_ready(&index);

        let result = index.search("main", 10, None);
        assert!(!result.incomplete);
        assert_eq!(result.matches[0].path, "src/main.rs");
        assert_eq!(result.matches.len(), 1);
        assert_eq!(result.matches[0].positions, [4, 5, 6, 7]);
        assert!(paths(&index, "config").is_empty());
        assert_eq!(
            index
                .search("src", 10, Some(&[PathKind::Directory]))
                .matches
                .iter()
                .map(|m| m.path.as_str())
                .collect::<Vec<_>>(),
            ["src", "src/deep"]
        );
        assert_eq!(index.search("", 100, None).matches.len(), index.len());

        fs::write(root.join("src/new_file.ts"), "").unwrap();
        fs::remove_file(root.join("src/main.rs")).unwrap();
        index.apply_changes(vec!["src/new_file.ts".into(), "src/main.rs".into()]);
        assert_eq!(paths(&index, "new_file"), ["src/new_file.ts"]);
        assert!(paths(&index, "main").is_empty());

        fs::remove_dir_all(root.join("src/deep")).unwrap();
        index.apply_changes(vec!["src/deep".into()]);
        assert!(paths(&index, "module").is_empty());

        fs::create_dir_all(root.join("lib/x")).unwrap();
        fs::write(root.join("lib/x/a.rs"), "").unwrap();
        index.apply_changes(vec!["lib".into()]);
        assert_eq!(paths(&index, "lib/x/a"), ["lib/x/a.rs"]);

        // Editing .gitignore re-evaluates its directory.
        fs::write(root.join(".gitignore"), "node_modules/\nlib/\n").unwrap();
        index.apply_changes(vec![".gitignore".into()]);
        assert!(paths(&index, "lib/x/a").is_empty());
        index.close();
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn budget_marks_index_incomplete() {
        let root = tempdir("budget");
        for i in 0..20 {
            fs::write(root.join(format!("f{i}.txt")), "").unwrap();
        }
        let index = PathIndex::new(root.clone(), Some(5)).unwrap();
        wait_ready(&index);
        let result = index.search("", 100, None);
        assert!(result.incomplete);
        assert!(result.matches.len() <= 5);
        let _ = fs::remove_dir_all(&root);
    }
}
