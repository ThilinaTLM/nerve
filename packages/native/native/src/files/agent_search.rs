//! Deterministic, exactly-capped grep and file-name search for the agent tools.
//! Unlike `content.rs` (interactive UI search, first-come results) the output is
//! ordered by path, total counts are exact and the cap never depends on thread timing.
use super::content::invalid_pattern_error;
use crate::core::ignore_rules::walk_builder;
use globset::GlobBuilder;
use grep_regex::{RegexMatcher, RegexMatcherBuilder};
use grep_searcher::{BinaryDetection, Searcher, SearcherBuilder, Sink, SinkContext, SinkMatch};
use ignore::WalkState;
use ignore::overrides::OverrideBuilder;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Error text for a deadline hit; the TS wrapper maps it to a timeout error.
pub const TIMEOUT_ERROR: &str = "timeout";
pub const CANCELLED_ERROR: &str = "cancelled";

#[derive(Clone, Debug, Default)]
pub struct GrepOptions {
    pub pattern: String,
    pub literal: bool,
    pub ignore_case: bool,
    /// ripgrep `--glob` semantics: a glob without `/` matches the file name at any depth.
    pub glob: Option<String>,
    pub context: usize,
    /// Match lines to return; totals still count every match.
    pub limit: usize,
    /// Longest line text returned, cut at a character boundary.
    pub max_line_bytes: Option<usize>,
    pub timeout: Option<Duration>,
}

#[derive(Debug)]
pub struct GrepLine {
    /// Relative to the display root, "/" separators.
    pub path: String,
    pub line: u64,
    pub text: String,
    pub is_match: bool,
}

#[derive(Debug, Default)]
pub struct GrepOutput {
    pub lines: Vec<GrepLine>,
    pub total_matches: u64,
    pub total_files: usize,
}

struct Budget {
    cancel: Arc<AtomicBool>,
    deadline: Option<Instant>,
    timed_out: AtomicBool,
}

impl Budget {
    fn new(cancel: Arc<AtomicBool>, timeout: Option<Duration>) -> Self {
        Self {
            cancel,
            deadline: timeout.map(|timeout| Instant::now() + timeout),
            timed_out: AtomicBool::new(false),
        }
    }
    fn stop(&self) -> bool {
        if self.cancel.load(Ordering::Relaxed) || self.timed_out.load(Ordering::Relaxed) {
            return true;
        }
        if self
            .deadline
            .is_some_and(|deadline| Instant::now() >= deadline)
        {
            self.timed_out.store(true, Ordering::Relaxed);
            return true;
        }
        false
    }
    fn outcome(&self) -> Result<(), String> {
        if self.cancel.load(Ordering::Relaxed) {
            Err(CANCELLED_ERROR.into())
        } else if self.timed_out.load(Ordering::Relaxed) {
            Err(TIMEOUT_ERROR.into())
        } else {
            Ok(())
        }
    }
}

fn display_path(display_root: &Path, path: &Path) -> String {
    let relative = path.strip_prefix(display_root).unwrap_or(path);
    relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn walker(
    display_root: &Path,
    roots: &[PathBuf],
    glob: Option<&str>,
) -> Result<ignore::WalkBuilder, String> {
    let first = roots
        .first()
        .ok_or("At least one search root is required")?;
    let mut builder = walk_builder(first);
    for root in &roots[1..] {
        builder.add(root);
    }
    if let Some(glob) = glob.filter(|glob| !glob.is_empty()) {
        let mut overrides = OverrideBuilder::new(display_root);
        overrides
            .add(glob)
            .map_err(|error| format!("Invalid glob '{glob}': {error}"))?;
        builder.overrides(
            overrides
                .build()
                .map_err(|error| format!("Invalid glob '{glob}': {error}"))?,
        );
    }
    builder.threads(
        std::thread::available_parallelism()
            .map_or(2, usize::from)
            .clamp(1, 4),
    );
    Ok(builder)
}

struct CountSink<'a> {
    budget: &'a Budget,
    count: u64,
}

impl Sink for CountSink<'_> {
    type Error = std::io::Error;
    fn matched(&mut self, _: &Searcher, _: &SinkMatch<'_>) -> Result<bool, Self::Error> {
        self.count += 1;
        Ok(!self.count.is_multiple_of(1024) || !self.budget.stop())
    }
}

struct LineSink<'a> {
    path: &'a str,
    context: u64,
    max_line_bytes: Option<usize>,
    remaining: &'a mut usize,
    last_match: Option<u64>,
    lines: &'a mut Vec<GrepLine>,
}

impl LineSink<'_> {
    fn push(&mut self, line: u64, bytes: &[u8], is_match: bool) {
        let text = String::from_utf8_lossy(bytes);
        let text = text.trim_end_matches(['\n', '\r']);
        let text = match self.max_line_bytes {
            Some(max) if text.len() > max => {
                let mut end = max;
                while !text.is_char_boundary(end) {
                    end -= 1;
                }
                &text[..end]
            }
            _ => text,
        };
        self.lines.push(GrepLine {
            path: self.path.to_owned(),
            line,
            text: text.to_owned(),
            is_match,
        });
    }
    /// After the quota is spent only trailing context of the final match is kept.
    fn in_trailing_context(&self, line: u64) -> bool {
        *self.remaining == 0
            && self
                .last_match
                .is_some_and(|last| line <= last + self.context)
    }
}

impl Sink for LineSink<'_> {
    type Error = std::io::Error;
    fn matched(&mut self, _: &Searcher, found: &SinkMatch<'_>) -> Result<bool, Self::Error> {
        let line = found.line_number().unwrap_or(0);
        if *self.remaining > 0 {
            *self.remaining -= 1;
            self.last_match = Some(line);
            self.push(line, found.bytes(), true);
            return Ok(true);
        }
        if self.in_trailing_context(line) {
            self.push(line, found.bytes(), false);
            return Ok(true);
        }
        Ok(false)
    }
    fn context(&mut self, _: &Searcher, found: &SinkContext<'_>) -> Result<bool, Self::Error> {
        let line = found.line_number().unwrap_or(0);
        if *self.remaining > 0 || self.in_trailing_context(line) {
            self.push(line, found.bytes(), false);
            return Ok(true);
        }
        // Past the final match's trailing context: nothing more of this file is shown.
        Ok(false)
    }
}

fn build_searcher(context: usize, line_numbers: bool, explicit_file: bool) -> Searcher {
    SearcherBuilder::new()
        .line_number(line_numbers)
        .before_context(context)
        .after_context(context)
        .binary_detection(if explicit_file {
            BinaryDetection::convert(0)
        } else {
            BinaryDetection::quit(0)
        })
        .build()
}

pub fn grep(
    display_root: &Path,
    roots: &[PathBuf],
    options: GrepOptions,
    cancel: Arc<AtomicBool>,
) -> Result<GrepOutput, String> {
    if options.pattern.is_empty() {
        return Err("Search pattern must not be empty".into());
    }
    let matcher: RegexMatcher = RegexMatcherBuilder::new()
        .case_insensitive(options.ignore_case)
        .fixed_strings(options.literal)
        .line_terminator(Some(b'\n'))
        .build(&options.pattern)
        .map_err(|error| invalid_pattern_error(&error.to_string(), &options.pattern))?;
    let budget = Budget::new(cancel, options.timeout);
    let explicit: BTreeSet<&PathBuf> = roots.iter().filter(|root| root.is_file()).collect();
    let counted: Mutex<Vec<(String, PathBuf, u64)>> = Mutex::new(Vec::new());

    // Pass 1: exact counts, parallel. Pass 2 re-reads only the files that are shown.
    walker(display_root, roots, options.glob.as_deref())?
        .build_parallel()
        .run(|| {
            let (matcher, budget, counted, explicit) = (&matcher, &budget, &counted, &explicit);
            let mut searcher = build_searcher(0, false, false);
            let mut explicit_searcher = build_searcher(0, false, true);
            Box::new(move |result| {
                if budget.stop() {
                    return WalkState::Quit;
                }
                let Ok(entry) = result else {
                    return WalkState::Continue;
                };
                if !entry.file_type().is_some_and(|kind| kind.is_file()) {
                    return WalkState::Continue;
                }
                let mut sink = CountSink { budget, count: 0 };
                let active = if entry.depth() == 0 && explicit.contains(&entry.path().to_path_buf())
                {
                    &mut explicit_searcher
                } else {
                    &mut searcher
                };
                let _ = active.search_path(matcher, entry.path(), &mut sink);
                if sink.count > 0 {
                    counted
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .push((
                            display_path(display_root, entry.path()),
                            entry.path().to_path_buf(),
                            sink.count,
                        ));
                }
                WalkState::Continue
            })
        });
    budget.outcome()?;
    let mut files = counted
        .into_inner()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    files.sort_by(|a, b| a.0.cmp(&b.0));
    files.dedup_by(|a, b| a.0 == b.0);

    let mut output = GrepOutput {
        total_matches: files.iter().map(|(_, _, count)| count).sum(),
        total_files: files.len(),
        ..GrepOutput::default()
    };
    let mut remaining = options.limit;
    for (path, absolute, _) in &files {
        if remaining == 0 || budget.stop() {
            break;
        }
        let mut sink = LineSink {
            path,
            context: options.context as u64,
            max_line_bytes: options.max_line_bytes,
            remaining: &mut remaining,
            last_match: None,
            lines: &mut output.lines,
        };
        let is_explicit = explicit.contains(absolute);
        let _ = build_searcher(options.context, true, is_explicit)
            .search_path(&matcher, absolute, &mut sink);
    }
    budget.outcome()?;
    Ok(output)
}

#[derive(Clone, Debug, Default)]
pub struct FindOptions {
    /// fd `--glob`: a pattern with `/` is matched against the full path (a relative one gets a
    /// leading `**/`), any other pattern against the file name.
    pub pattern: String,
    pub limit: usize,
    pub timeout: Option<Duration>,
}

#[derive(Debug, Default)]
pub struct FindOutput {
    /// The first `limit` matches by path, relative to the root.
    pub paths: Vec<String>,
    pub total: u64,
}

pub fn find_files(
    root: &Path,
    options: FindOptions,
    cancel: Arc<AtomicBool>,
) -> Result<FindOutput, String> {
    if options.pattern.is_empty() {
        return Err("Find pattern must not be empty".into());
    }
    let full_path = options.pattern.contains('/');
    let effective =
        if full_path && !options.pattern.starts_with('/') && !options.pattern.starts_with("**/") {
            format!("**/{}", options.pattern)
        } else {
            options.pattern.clone()
        };
    let glob = GlobBuilder::new(&effective)
        .literal_separator(true)
        .build()
        .map_err(|error| format!("Invalid glob '{}': {error}", options.pattern))?
        .compile_matcher();
    let budget = Budget::new(cancel, options.timeout);
    let total = AtomicUsize::new(0);
    let kept: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());
    let mut builder = walk_builder(root);
    builder.threads(
        std::thread::available_parallelism()
            .map_or(2, usize::from)
            .clamp(1, 4),
    );
    builder.build_parallel().run(|| {
        let (budget, total, kept, glob) = (&budget, &total, &kept, &glob);
        Box::new(move |result| {
            if budget.stop() {
                return WalkState::Quit;
            }
            let Ok(entry) = result else {
                return WalkState::Continue;
            };
            if !entry.file_type().is_some_and(|kind| kind.is_file()) {
                return WalkState::Continue;
            }
            let hit = if full_path {
                glob.is_match(entry.path())
            } else {
                glob.is_match(Path::new(entry.file_name()))
            };
            if hit {
                total.fetch_add(1, Ordering::Relaxed);
                let relative = display_path(root, entry.path());
                let mut kept = kept
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                kept.insert(relative);
                if kept.len() > options.limit {
                    kept.pop_last();
                }
            }
            WalkState::Continue
        })
    });
    budget.outcome()?;
    let paths: Vec<String> = kept
        .into_inner()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .into_iter()
        .collect();
    Ok(FindOutput {
        paths,
        total: total.load(Ordering::Relaxed) as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::test_support::tempdir;
    use std::fs;

    fn run_grep(
        root: &Path,
        roots: &[PathBuf],
        tweak: impl FnOnce(&mut GrepOptions),
    ) -> GrepOutput {
        let mut options = GrepOptions {
            pattern: "needle".into(),
            limit: 100,
            ..GrepOptions::default()
        };
        tweak(&mut options);
        grep(root, roots, options, Arc::new(AtomicBool::new(false))).unwrap()
    }

    fn summary(output: &GrepOutput) -> Vec<String> {
        output
            .lines
            .iter()
            .map(|l| format!("{}{}{}", l.path, if l.is_match { ":" } else { "-" }, l.line))
            .collect()
    }

    #[test]
    fn grep_is_ordered_capped_exactly_and_counts_everything() {
        let root = tempdir("agent-grep");
        for name in ["c.txt", "a.txt", "b.txt"] {
            fs::write(root.join(name), "needle\nother\nneedle\n").unwrap();
        }
        let out = run_grep(&root, std::slice::from_ref(&root), |o| o.limit = 3);
        assert_eq!(summary(&out), ["a.txt:1", "a.txt:3", "b.txt:1"]);
        assert_eq!((out.total_matches, out.total_files), (6, 3));
        let none = run_grep(&root, std::slice::from_ref(&root), |o| o.limit = 0);
        assert!(none.lines.is_empty());
        assert_eq!(none.total_matches, 6);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn grep_context_trails_the_final_match_only() {
        let root = tempdir("agent-grep-context");
        fs::write(root.join("a.txt"), "1\nneedle\n3\nneedle\n5\n6\n7\n").unwrap();
        fs::write(root.join("b.txt"), "needle\n").unwrap();
        let out = run_grep(&root, std::slice::from_ref(&root), |o| {
            o.context = 2;
            o.limit = 1;
        });
        // Quota spent on a.txt:2; line 4 is a match but is shown as trailing context.
        assert_eq!(summary(&out), ["a.txt-1", "a.txt:2", "a.txt-3", "a.txt-4"]);
        assert_eq!(out.total_matches, 3);
        assert_eq!(out.total_files, 2);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn grep_scope_hidden_ignore_binary_glob_and_single_files() {
        let root = tempdir("agent-grep-scope");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("dist")).unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join(".gitignore"), "dist/\n").unwrap();
        fs::write(root.join(".hidden.ts"), "needle\n").unwrap();
        fs::write(root.join("src/a.ts"), "NEEDLE\nneedle\n").unwrap();
        fs::write(root.join("src/b.md"), "needle\n").unwrap();
        fs::write(root.join("dist/o.js"), "needle\n").unwrap();
        fs::write(root.join(".git/x"), "needle\n").unwrap();
        fs::write(root.join("bin.dat"), b"needle\0x").unwrap();
        let all = run_grep(&root, std::slice::from_ref(&root), |_| {});
        assert_eq!(summary(&all), [".hidden.ts:1", "src/a.ts:2", "src/b.md:1"]);
        let ci = run_grep(&root, std::slice::from_ref(&root), |o| o.ignore_case = true);
        assert_eq!(ci.total_matches, 4);
        let ts = run_grep(&root, std::slice::from_ref(&root), |o| {
            o.glob = Some("*.ts".into())
        });
        assert_eq!(summary(&ts), [".hidden.ts:1", "src/a.ts:2"]);
        let files = [root.join("src/b.md"), root.join("src/a.ts")];
        let multi = run_grep(&root, &files, |_| {});
        assert_eq!(summary(&multi), ["src/a.ts:2", "src/b.md:1"]);
        // An explicitly named file is searched even when it is ignored.
        let ignored = run_grep(&root, &[root.join("dist/o.js")], |_| {});
        assert_eq!(summary(&ignored), ["dist/o.js:1"]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn grep_cuts_long_lines_at_a_character_boundary_and_reports_bad_patterns() {
        let root = tempdir("agent-grep-long");
        fs::write(root.join("a.txt"), format!("needle{}\n", "é".repeat(100))).unwrap();
        let out = run_grep(&root, std::slice::from_ref(&root), |o| {
            o.max_line_bytes = Some(11)
        });
        assert_eq!(out.lines[0].text, "needleéé");
        let err = grep(
            &root,
            std::slice::from_ref(&root),
            GrepOptions {
                pattern: "(".into(),
                limit: 1,
                ..GrepOptions::default()
            },
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap_err();
        assert!(err.starts_with("INVALID_SEARCH_PATTERN"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn find_matches_names_and_full_paths_in_path_order_with_exact_totals() {
        let root = tempdir("agent-find");
        for file in [
            "a.ts",
            ".hidden/e.ts",
            "src/b.ts",
            "src/b.md",
            "src/deep/c.ts",
            "ignored/z.ts",
        ] {
            let path = root.join(file);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, "x").unwrap();
        }
        fs::write(root.join(".gitignore"), "ignored/\n").unwrap();
        let find = |pattern: &str, limit: usize| {
            find_files(
                &root,
                FindOptions {
                    pattern: pattern.into(),
                    limit,
                    timeout: None,
                },
                Arc::new(AtomicBool::new(false)),
            )
            .unwrap()
        };
        let all = find("*.ts", 100);
        assert_eq!(
            all.paths,
            [".hidden/e.ts", "a.ts", "src/b.ts", "src/deep/c.ts"]
        );
        let capped = find("*.ts", 2);
        assert_eq!(capped.paths, [".hidden/e.ts", "a.ts"]);
        assert_eq!(capped.total, 4);
        assert_eq!(find("src/*.ts", 100).paths, ["src/b.ts"]);
        assert_eq!(
            find("src/**/*.ts", 100).paths,
            ["src/b.ts", "src/deep/c.ts"]
        );
        assert_eq!(find("deep/*.ts", 100).paths, ["src/deep/c.ts"]);
        assert_eq!(find("b.?s", 100).paths, ["src/b.ts"]);
        let _ = fs::remove_dir_all(&root);
    }
}
