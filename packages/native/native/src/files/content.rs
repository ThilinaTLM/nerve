use super::relative_slash;
use crate::core::ignore_rules::{GIT_DIRECTORY, walk_builder};
use grep_matcher::Matcher;
use grep_regex::{RegexMatcher, RegexMatcherBuilder};
use grep_searcher::{BinaryDetection, Searcher, SearcherBuilder, Sink, SinkMatch};
use ignore::WalkState;
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024;
const MAX_RANGES_PER_LINE: usize = 50;
pub const DEFAULT_MAX_RESULTS: usize = 1_000;
pub const DEFAULT_PREVIEW_CHARS: usize = 300;

#[derive(Clone, Debug, Default)]
pub struct ContentOptions {
    pub query: String,
    pub regex: bool,
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub include: Vec<String>,
    pub exclude: Vec<String>,
    pub include_ignored: bool,
    pub max_results: Option<usize>,
    pub max_preview_chars: Option<usize>,
    pub timeout: Option<Duration>,
}

#[derive(Debug)]
pub struct LineMatch {
    pub line: u64,
    pub text: String,
    pub ranges: Vec<(u32, u32)>,
}

#[derive(Debug)]
pub struct FileMatches {
    pub path: String,
    pub matches: Vec<LineMatch>,
}

#[derive(Debug, Default)]
pub struct ContentSearchOutput {
    pub files: Vec<FileMatches>,
    pub truncated: bool,
    pub searched_files: usize,
}

struct Shared {
    matcher: RegexMatcher,
    preview: usize,
    max_results: usize,
    deadline: Option<Instant>,
    cancel: Arc<AtomicBool>,
    found: AtomicUsize,
    searched: AtomicUsize,
    truncated: AtomicBool,
    results: Mutex<Vec<FileMatches>>,
}

impl Shared {
    fn should_stop(&self) -> bool {
        if self.cancel.load(Ordering::Relaxed) {
            return true;
        }
        if self
            .deadline
            .is_some_and(|deadline| Instant::now() >= deadline)
        {
            self.truncated.store(true, Ordering::Relaxed);
            return true;
        }
        self.truncated.load(Ordering::Relaxed)
    }
}

pub fn search_content(
    root: &Path,
    options: ContentOptions,
    cancel: Arc<AtomicBool>,
) -> Result<ContentSearchOutput, String> {
    if options.query.is_empty() {
        return Err("Search query must not be empty".into());
    }
    let root = root
        .canonicalize()
        .map_err(|error| format!("Could not resolve project root: {error}"))?;
    let mut builder = RegexMatcherBuilder::new();
    builder
        .case_insensitive(!options.case_sensitive)
        .word(options.whole_word)
        .fixed_strings(!options.regex)
        .line_terminator(Some(b'\n'));
    let matcher = builder
        .build(&options.query)
        .map_err(|error| format!("Invalid search pattern: {error}"))?;
    let include = globs(&root, &options.include)?;
    let exclude = globs(&root, &options.exclude)?;
    let shared = Shared {
        matcher,
        preview: options
            .max_preview_chars
            .unwrap_or(DEFAULT_PREVIEW_CHARS)
            .clamp(20, 10_000),
        max_results: options
            .max_results
            .unwrap_or(DEFAULT_MAX_RESULTS)
            .clamp(1, 100_000),
        deadline: options.timeout.map(|timeout| Instant::now() + timeout),
        cancel,
        found: AtomicUsize::new(0),
        searched: AtomicUsize::new(0),
        truncated: AtomicBool::new(false),
        results: Mutex::new(Vec::new()),
    };

    let mut walker = walk_builder(&root);
    if options.include_ignored {
        walker
            .ignore(false)
            .git_ignore(false)
            .git_global(false)
            .git_exclude(false)
            .parents(false);
    }
    walker.max_filesize(Some(MAX_FILE_SIZE)).threads(
        std::thread::available_parallelism()
            .map_or(2, usize::from)
            .clamp(1, 4),
    );
    let filter_root = root.clone();
    let filter_exclude = exclude.clone();
    walker.filter_entry(move |entry| {
        if entry.file_name() == GIT_DIRECTORY {
            return false;
        }
        let Some(exclude) = &filter_exclude else {
            return true;
        };
        let is_dir = entry.file_type().is_some_and(|kind| kind.is_dir());
        match entry.path().strip_prefix(&filter_root) {
            Ok(relative) if !relative.as_os_str().is_empty() => !exclude
                .matched_path_or_any_parents(relative, is_dir)
                .is_ignore(),
            _ => true,
        }
    });
    walker.build_parallel().run(|| {
        let shared = &shared;
        let root = &root;
        let include = &include;
        let mut searcher = SearcherBuilder::new()
            .line_number(true)
            .binary_detection(BinaryDetection::quit(0))
            .build();
        Box::new(move |result| {
            if shared.should_stop() {
                return WalkState::Quit;
            }
            let Ok(entry) = result else {
                return WalkState::Continue;
            };
            if !entry.file_type().is_some_and(|kind| kind.is_file()) {
                return WalkState::Continue;
            }
            let Some(relative) = relative_slash(root, entry.path()) else {
                return WalkState::Continue;
            };
            if let Some(include) = include
                && !include
                    .matched_path_or_any_parents(Path::new(&relative), false)
                    .is_ignore()
            {
                return WalkState::Continue;
            }
            shared.searched.fetch_add(1, Ordering::Relaxed);
            let mut sink = FileSink {
                shared,
                matches: Vec::new(),
            };
            let _ = searcher.search_path(&shared.matcher, entry.path(), &mut sink);
            if !sink.matches.is_empty() {
                shared
                    .results
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .push(FileMatches {
                        path: relative,
                        matches: sink.matches,
                    });
            }
            if shared.should_stop() {
                WalkState::Quit
            } else {
                WalkState::Continue
            }
        })
    });

    if shared.cancel.load(Ordering::Relaxed) {
        return Err("cancelled".into());
    }
    let mut files = shared
        .results
        .into_inner()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(ContentSearchOutput {
        files,
        truncated: shared.truncated.load(Ordering::Relaxed),
        searched_files: shared.searched.load(Ordering::Relaxed),
    })
}

fn globs(root: &Path, patterns: &[String]) -> Result<Option<Gitignore>, String> {
    let patterns: Vec<_> = patterns
        .iter()
        .map(|pattern| pattern.trim())
        .filter(|pattern| !pattern.is_empty())
        .collect();
    if patterns.is_empty() {
        return Ok(None);
    }
    let mut builder = GitignoreBuilder::new(root);
    for pattern in patterns {
        builder
            .add_line(None, pattern)
            .map_err(|error| format!("Invalid glob '{pattern}': {error}"))?;
    }
    builder
        .build()
        .map(Some)
        .map_err(|error| format!("Invalid glob: {error}"))
}

struct FileSink<'a> {
    shared: &'a Shared,
    matches: Vec<LineMatch>,
}

impl Sink for FileSink<'_> {
    type Error = std::io::Error;

    fn matched(&mut self, _: &Searcher, mat: &SinkMatch<'_>) -> Result<bool, Self::Error> {
        if self.shared.should_stop() {
            return Ok(false);
        }
        if self.shared.found.fetch_add(1, Ordering::Relaxed) >= self.shared.max_results {
            self.shared.truncated.store(true, Ordering::Relaxed);
            return Ok(false);
        }
        let line = String::from_utf8_lossy(mat.bytes());
        let line = line.trim_end_matches(['\n', '\r']);
        let (text, ranges) = preview(&self.shared.matcher, line, self.shared.preview);
        self.matches.push(LineMatch {
            line: mat.line_number().unwrap_or(0),
            text,
            ranges,
        });
        Ok(true)
    }
}

/// Windowed preview of `line` plus UTF-16 match ranges relative to the preview.
fn preview(matcher: &RegexMatcher, line: &str, max_chars: usize) -> (String, Vec<(u32, u32)>) {
    let mut byte_ranges: Vec<(usize, usize)> = Vec::new();
    let _ = matcher.find_iter(line.as_bytes(), |found| {
        if found.end() > found.start() {
            byte_ranges.push((found.start(), found.end()));
        }
        byte_ranges.len() < MAX_RANGES_PER_LINE
    });
    let chars: Vec<(usize, char)> = line.char_indices().collect();
    let char_at = |byte: usize| chars.partition_point(|(offset, _)| *offset < byte);
    let (start, end) = if chars.len() > max_chars {
        let first = byte_ranges.first().map_or(0, |(start, _)| char_at(*start));
        let start = first
            .saturating_sub(max_chars / 4)
            .min(chars.len() - max_chars);
        (start, start + max_chars)
    } else {
        (0, chars.len())
    };
    let window = &chars[start..end];
    let text: String = window.iter().map(|(_, ch)| *ch).collect();
    let mut prefix = Vec::with_capacity(window.len() + 1);
    let mut offset = 0u32;
    for (_, ch) in window {
        prefix.push(offset);
        offset += ch.len_utf16() as u32;
    }
    prefix.push(offset);
    let ranges = byte_ranges
        .into_iter()
        .filter_map(|(from, to)| {
            let (from, to) = (char_at(from).max(start), char_at(to).min(end));
            (from < to).then(|| (prefix[from - start], prefix[to - start]))
        })
        .collect();
    (text, ranges)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::test_support::tempdir;
    use std::fs;

    fn run(
        root: &Path,
        query: &str,
        tweak: impl FnOnce(&mut ContentOptions),
    ) -> ContentSearchOutput {
        let mut options = ContentOptions {
            query: query.into(),
            ..ContentOptions::default()
        };
        tweak(&mut options);
        search_content(root, options, Arc::new(AtomicBool::new(false))).unwrap()
    }

    #[test]
    fn honors_ignore_rules_globs_binary_files_and_utf16_ranges() {
        let root = tempdir("content");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("dist")).unwrap();
        fs::write(root.join(".gitignore"), "dist/\n").unwrap();
        fs::write(
            root.join("src/a.ts"),
            "one\n😀 Needle here\nneedle needle\n",
        )
        .unwrap();
        fs::write(root.join("src/b.md"), "needle in docs\n").unwrap();
        fs::write(root.join("dist/out.js"), "needle\n").unwrap();
        fs::write(root.join("bin.dat"), b"needle\0binary").unwrap();

        let all = run(&root, "needle", |_| {});
        let paths: Vec<_> = all.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, ["src/a.ts", "src/b.md"]);
        let a = &all.files[0].matches;
        assert_eq!(a[0].line, 2);
        assert_eq!(a[0].ranges, [(3, 9)]); // emoji is two UTF-16 units
        assert_eq!(a[1].ranges, [(0, 6), (7, 13)]);

        let ignored = run(&root, "needle", |o| o.include_ignored = true);
        assert!(ignored.files.iter().any(|f| f.path == "dist/out.js"));
        assert!(!ignored.files.iter().any(|f| f.path == "bin.dat"));

        let ts = run(&root, "needle", |o| o.include = vec!["*.ts".into()]);
        assert_eq!(ts.files.len(), 1);
        let no_docs = run(&root, "needle", |o| o.exclude = vec!["*.md".into()]);
        assert_eq!(no_docs.files.len(), 1);

        assert!(
            run(&root, "NEEDLE", |o| o.case_sensitive = true)
                .files
                .is_empty()
        );
        assert_eq!(run(&root, r"ne+dle\b", |o| o.regex = true).files.len(), 2);
        assert!(run(&root, "need", |o| o.whole_word = true).files.is_empty());
        let limited = run(&root, "needle", |o| o.max_results = Some(1));
        assert!(limited.truncated);
        assert!(
            search_content(
                &root,
                ContentOptions {
                    query: "(".into(),
                    regex: true,
                    ..Default::default()
                },
                Arc::new(AtomicBool::new(false))
            )
            .is_err()
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn long_lines_are_windowed_around_the_first_match() {
        let root = tempdir("windowed");
        fs::write(
            root.join("min.js"),
            format!("{}target{}\n", "x".repeat(1000), "y".repeat(1000)),
        )
        .unwrap();
        let out = run(&root, "target", |o| o.max_preview_chars = Some(50));
        let m = &out.files[0].matches[0];
        assert_eq!(m.text.chars().count(), 50);
        let (start, end) = m.ranges[0];
        let units: Vec<u16> = m.text.encode_utf16().collect();
        assert_eq!(
            String::from_utf16(&units[start as usize..end as usize]).unwrap(),
            "target"
        );
        let _ = fs::remove_dir_all(&root);
    }
}
